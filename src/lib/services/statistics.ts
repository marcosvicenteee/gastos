import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { toNumber } from '../money';
import { startOfMonth, endOfMonth, startOfDay, startOfWeek } from '../datetime';
import { monthRange } from './expenses';

/**
 * Estadísticas del dashboard.
 *
 * Dos decisiones importantes:
 *
 *  1. **Los importes se suman en PostgreSQL, no en JavaScript.** `SUM()` sobre
 *     `numeric` es exacto. Si se trajeran todas las filas y se sumaran con
 *     `number`, un mes con miles de gastos acumularía error de coma flotante
 *     y los totales no cuadrarían con la lista.
 *
 *  2. **Los cortes de día, semana y mes se calculan con la zona horaria del
 *     usuario**, no en UTC. "Hoy" a las 00:30 en Madrid tiene que incluir los
 *     gastos de esas 00:30, no los de ayer. Se hace con
 *     `expense_date AT TIME ZONE $tz` dentro de la consulta, y todos los
 *     valores viajan como parámetros de Prisma: no hay concatenación de SQL.
 */

export interface CategoryTotal {
  categoryId: string | null;
  categoryName: string;
  color: string;
  icon: string;
  total: number;
  count: number;
}

export interface TimeBucket {
  /** Etiqueta de eje, ya formateada en la zona del usuario. */
  key: string;
  /** Inicio del intervalo como ISO, para ordenar y para el tooltip. */
  start: string;
  total: number;
  count: number;
}

export interface MerchantTotal {
  merchant: string;
  total: number;
  count: number;
}

export interface StatisticsResult {
  totals: {
    today: number;
    week: number;
    month: number;
    previousMonth: number;
    monthCount: number;
    monthTransactions: number;
    averagePerDay: number;
    averagePerPayment: number;
    /** Variación respecto al mes anterior, en porcentaje. `null` si no hay base. */
    monthOverMonth: number | null;
  };
  byCategory: CategoryTotal[];
  byDay: TimeBucket[];
  byWeek: TimeBucket[];
  byMonth: TimeBucket[];
  topMerchants: MerchantTotal[];
  topCategory: CategoryTotal | null;
  topMerchant: MerchantTotal | null;
  bySource: { source: string; total: number; count: number }[];
}

interface AggregatedRow {
  key: string;
  total: Prisma.Decimal | null;
  count: bigint;
}

const CATEGORY_FALLBACK = { name: 'Sin categoría', color: '#94A3B8', icon: 'Wallet' };

export async function computeStatistics(
  userId: string,
  timezone: string,
  locale = 'es-ES',
  now: Date = new Date(),
): Promise<StatisticsResult> {
  const monthStart = startOfMonth(now, timezone);
  const monthEnd = endOfMonth(now, timezone);
  const previousMonthStart = startOfMonth(
    new Date(monthStart.getTime() - 86_400_000),
    timezone,
  );
  const dayStart = startOfDay(now, timezone);
  const weekStart = startOfWeek(now, timezone);
  // Ventana de 365 días para los gráficos de evolución.
  const yearBack = new Date(monthStart.getTime() - 365 * 86_400_000);

  const [monthTotal, previousMonthTotal, todayTotal, weekTotal, monthCount] =
    await Promise.all([
      prisma.expense.aggregate({
        where: { userId, expenseDate: { gte: monthStart, lt: monthEnd } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.expense.aggregate({
        where: { userId, expenseDate: { gte: previousMonthStart, lt: monthStart } },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { userId, expenseDate: { gte: dayStart } },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { userId, expenseDate: { gte: weekStart } },
        _sum: { amount: true },
      }),
      prisma.expense.count({ where: { userId, expenseDate: { gte: monthStart, lt: monthEnd } } }),
    ]);

  // --- Por categoría (mes en curso) ---
  const categoryRows = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: { userId, expenseDate: { gte: monthStart, lt: monthEnd } },
    _sum: { amount: true },
    _count: true,
  });

  const categoryIds = categoryRows
    .map((row) => row.categoryId)
    .filter((id): id is string => id !== null);

  const categoryMeta = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true, color: true, icon: true },
  });
  const metaById = new Map(categoryMeta.map((c) => [c.id, c]));

  const byCategory: CategoryTotal[] = categoryRows
    .map((row) => {
      const meta = row.categoryId ? metaById.get(row.categoryId) : undefined;
      return {
        categoryId: row.categoryId,
        categoryName: meta?.name ?? CATEGORY_FALLBACK.name,
        color: meta?.color ?? CATEGORY_FALLBACK.color,
        icon: meta?.icon ?? CATEGORY_FALLBACK.icon,
        total: toNumber(row._sum.amount ?? 0),
        count: row._count,
      };
    })
    .sort((a, b) => b.total - a.total);

  // --- Series temporales, agrupadas en SQL ---
  const [dailyRows, weeklyRows, monthlyRows] = await Promise.all([
    prisma.$queryRaw<AggregatedRow[]>`
      SELECT
        to_char(date_trunc('day', "expenseDate" AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS key,
        SUM(amount) AS total,
        COUNT(*)::bigint AS count
      FROM "Expense"
      WHERE "userId" = ${userId}
        AND "expenseDate" >= ${yearBack}
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT 400
    `,
    prisma.$queryRaw<AggregatedRow[]>`
      SELECT
        to_char(date_trunc('week', "expenseDate" AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS key,
        SUM(amount) AS total,
        COUNT(*)::bigint AS count
      FROM "Expense"
      WHERE "userId" = ${userId}
        AND "expenseDate" >= ${yearBack}
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT 120
    `,
    prisma.$queryRaw<AggregatedRow[]>`
      SELECT
        to_char(date_trunc('month', "expenseDate" AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS key,
        SUM(amount) AS total,
        COUNT(*)::bigint AS count
      FROM "Expense"
      WHERE "userId" = ${userId}
        AND "expenseDate" >= ${yearBack}
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT 36
    `,
  ]);

  // --- Comercios con más gasto (mes en curso) ---
  const merchantRows = await prisma.expense.groupBy({
    by: ['merchant'],
    where: {
      userId,
      expenseDate: { gte: monthStart, lt: monthEnd },
      merchant: { not: null },
    },
    _sum: { amount: true },
    _count: true,
    orderBy: { _sum: { amount: 'desc' } },
    take: 10,
  });

  const topMerchants: MerchantTotal[] = merchantRows
    .filter((row): row is typeof row & { merchant: string } => row.merchant !== null)
    .map((row) => ({
      merchant: row.merchant,
      total: toNumber(row._sum.amount ?? 0),
      count: row._count,
    }));

  // --- Reparto por origen ---
  const sourceRows = await prisma.expense.groupBy({
    by: ['source'],
    where: { userId, expenseDate: { gte: monthStart, lt: monthEnd } },
    _sum: { amount: true },
    _count: true,
  });

  const monthAmount = toNumber(monthTotal._sum.amount ?? 0);
  const previousAmount = toNumber(previousMonthTotal._sum.amount ?? 0);
  const dayOfMonth = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone, day: 'numeric' }).format(now),
  );

  return {
    totals: {
      today: toNumber(todayTotal._sum.amount ?? 0),
      week: toNumber(weekTotal._sum.amount ?? 0),
      month: monthAmount,
      previousMonth: previousAmount,
      monthCount,
      monthTransactions: monthTotal._count,
      averagePerDay: monthAmount / Math.max(1, dayOfMonth),
      averagePerPayment: monthCount > 0 ? monthAmount / monthCount : 0,
      monthOverMonth:
        previousAmount > 0
          ? ((monthAmount - previousAmount) / previousAmount) * 100
          : null,
    },
    byCategory,
    byDay: toBuckets(dailyRows, 'day', timezone, locale, 30),
    byWeek: toBuckets(weeklyRows, 'week', timezone, locale, 12),
    byMonth: toBuckets(monthlyRows, 'month', timezone, locale, 12),
    topMerchants,
    topCategory: byCategory[0] ?? null,
    topMerchant: topMerchants[0] ?? null,
    bySource: sourceRows.map((row) => ({
      source: row.source,
      total: toNumber(row._sum.amount ?? 0),
      count: row._count,
    })),
  };
}

/**
 * Convierte filas agregadas en buckets con etiqueta legible, y rellena los
 * huecos con cero.
 *
 * Rellenar importa: un gráfico de "gasto por día" con un hueco el día que no
 * gastaste debe mostrar 0, no saltarse ese día. Un eje temporal con huecos se
 * interpreta fatalistically como "no hay datos".
 */
function toBuckets(
  rows: AggregatedRow[],
  granularity: 'day' | 'week' | 'month',
  timezone: string,
  locale: string,
  keep: number,
): TimeBucket[] {
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    ...(granularity === 'month'
      ? { month: 'short', year: '2-digit' }
      : { day: 'numeric', month: 'short' }),
  });

  const byKey = new Map(rows.map((row) => [row.key, row]));

  /**
   * Las claves son `YYYY-MM-DD` en la zona horaria del usuario, no instantes.
   * No se pueden pasar por `new Date()` directamente: eso lo interpretaría en
   * la zona del servidor y en un día volaría de fecha. Se recorre como texto
   * usando un instante UTC fijo al mediodía, que sólo sirve para formatear la
   * etiqueta.
   */
  function labelFor(key: string): string {
    const [year, month, day] = key.split('-').map(Number);
    const anchor = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12));
    return formatter.format(anchor).replace('.', '');
  }

  function empty(key: string): TimeBucket {
    return { key: labelFor(key), start: key, total: 0, count: 0 };
  }

  function fromRow(key: string, row: AggregatedRow): TimeBucket {
    return {
      key: labelFor(key),
      start: key,
      total: toNumber(row.total ?? 0),
      count: Number(row.count ?? 0),
    };
  }

  function withData(key: string): TimeBucket {
    const row = byKey.get(key);
    return row ? fromRow(key, row) : empty(key);
  }

  const sorted = [...byKey.keys()].sort((a, b) => a.localeCompare(b));
  const lastKey = sorted[sorted.length - 1];
  if (!lastKey) return [];

  /**
   * Se rellenan los huecos con ceros en lugar de devolver sólo los periodos con
   * gasto. No es un detalle cosmético: un gráfico de líneas une los puntos que
   * le dan, así que omitir un día sin gasto dibuja una recta entre dos días con
   * dinero y sugiere un reparto que no ocurrió. Con los ceros insertados, la
   * línea baja a cero y el salto se ve de verdad.
   *
   * El relleno empieza en el primer periodo con gasto, no en `keep` periodos
   * antes: alargar la serie hacia atrás con ceros sólo añade una línea plana
   * que ocupa media gráfica sin información.
   */
  if (granularity === 'month') {
    const out: TimeBucket[] = [];
    // La clave mensual ya viene como fecha completa (`2026-09-01`), porque
    // `date_trunc` devuelve el primer día del mes.
    const last = new Date(`${lastKey}T00:00:00Z`);
    const anchorYear = last.getUTCFullYear();
    const anchorMonth = last.getUTCMonth();
    for (let step = keep - 1; step >= 0; step -= 1) {
      // Cada clave se calcula desde el mismo ancla, nunca desde la anterior.
      // Restar en bucle sobre un cursor que ya se movió acumula los saltos y
      // producía una serie desordenada y con meses repetidos.
      // `Date.UTC` normaliza solo los meses fuera de 0-11 hacia el año
      // correcto, que es justo lo que hace falta al retroceder años.
      const date = new Date(Date.UTC(anchorYear, anchorMonth - step, 1));
      out.push(withData(date.toISOString().slice(0, 10)));
    }
    return trimLeadingEmpty(out);
  }

  const stepMs = granularity === 'week' ? 7 * 86_400_000 : 86_400_000;
  const out: TimeBucket[] = [];
  const last = new Date(`${lastKey}T00:00:00Z`);
  for (let step = keep - 1; step >= 0; step -= 1) {
    const date = new Date(last.getTime() - step * stepMs);
    out.push(withData(date.toISOString().slice(0, 10)));
  }
  return trimLeadingEmpty(out);
}

/**
 * Quita los periodos vacíos del principio de la serie.
 *
 * Se rellenan huecos para que la línea no mienta, pero al revés no: alargar
 * la serie hacia el pasado con meses en cero añade una línea plana que ocupa
 * media gráfica sin información. Los huecos intermedios sí se conservan, que es
 * justo lo que los hace visibles.
 *
 * Nunca deja la serie vacía: si no hay ningún gasto, se conserva un periodo
 * para que el gráfico no desaparezca.
 */
function trimLeadingEmpty(buckets: TimeBucket[]): TimeBucket[] {
  let start = 0;
  while (start < buckets.length - 1 && buckets[start]!.count === 0) start += 1;
  return start === 0 ? buckets : buckets.slice(start);
}

/**
 * Comparativa mes a mes de los últimos `months` meses, para el gráfico de
 * evolución. Es puramente descriptivo: no hace proyecciones ni recomendaciones
 * financieras.
 */
export async function monthlyComparison(
  userId: string,
  timezone: string,
  locale = 'es-ES',
  months = 12,
  now: Date = new Date(),
): Promise<TimeBucket[]> {
  const from = new Date(startOfMonth(now, timezone).getTime() - (months - 1) * 31 * 86_400_000);

  const rows = await prisma.$queryRaw<AggregatedRow[]>`
    SELECT
      to_char(date_trunc('month', "expenseDate" AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS key,
      SUM(amount) AS total,
      COUNT(*)::bigint AS count
    FROM "Expense"
    WHERE "userId" = ${userId}
      AND "expenseDate" >= ${from}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return toBuckets(rows, 'month', timezone, locale, months);
}

export { monthRange };
