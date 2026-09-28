import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { hashPassword } from '../crypto';
import { DEFAULT_CATEGORIES } from '../categories';
import { SUGGESTED_RULES } from '../categorization';
import { DEFAULT_NOTIFICATION_RULES } from '../notifications/parse';
import { computeIdempotencyKey } from '../idempotency';

export const DEMO_EMAIL = 'demo@example.com';
// El dominio debe ser valido: `loginSchema` comprueba el correo con Zod, y un
// `demo@localhost` pasaba el seed pero era rechazado al iniciar sesion, dejando
// la cuenta de demostracion inutilizable.
export const DEMO_PASSWORD = 'DemoLocal2026!';

/**
 * Genera un conjunto de datos de ejemplo.
 *
 * Sirve para tres cosas:
 *  1. Evaluar la interfaz sin tener que teclear 200 gastos a mano.
 *  2. Comprobar que los gráficos, el filtro por mes y la exportación funcionan
 *     con un volumen y una distribución razonables.
 *  3. Alimentar las pruebas de extremo a extremo con datos deterministas.
 *
 * Los gastos se generan hacia atrás desde hoy, así que el conjunto siempre
 * "parece reciente" sin importar cuándo se ejecute.
 */

interface DemoExpense {
  merchant: string;
  amount: string;
  categorySlug: string;
  source: 'web' | 'shortcut' | 'revolut';
  paymentMethod: 'card' | 'cash' | 'transfer' | 'other' | null;
  dayOfMonth: number;
  /** Sólo en algunos días: salta la semana para que el gráfico no sea plano. */
  weekdayOnly?: number[];
}

/**
 * Plantilla de gastos. Los importes no son redondos ni uniformes a propósito:
 * los datos de la vida real no lo son, y una demo con todo en 10,00 € no
 * permite juzgar si las gráficas y los agregados se leen bien.
 */
const TEMPLATE: DemoExpense[] = [
  { merchant: 'Mercadona', amount: '48,73', categorySlug: 'supermercado', source: 'revolut', paymentMethod: 'card', dayOfMonth: 2 },
  { merchant: 'Mercadona', amount: '31,20', categorySlug: 'supermercado', source: 'revolut', paymentMethod: 'card', dayOfMonth: 9 },
  { merchant: 'Mercadona', amount: '52,41', categorySlug: 'supermercado', source: 'revolut', paymentMethod: 'card', dayOfMonth: 16 },
  { merchant: 'Mercadona', amount: '27,88', categorySlug: 'supermercado', source: 'revolut', paymentMethod: 'card', dayOfMonth: 23 },
  { merchant: 'Lidl', amount: '22,15', categorySlug: 'supermercado', source: 'revolut', paymentMethod: 'card', dayOfMonth: 6 },
  { merchant: 'Lidl', amount: '19,40', categorySlug: 'supermercado', source: 'revolut', paymentMethod: 'card', dayOfMonth: 20 },
  { merchant: 'Panadería La Espiga', amount: '3,80', categorySlug: 'supermercado', source: 'shortcut', paymentMethod: 'cash', dayOfMonth: 4, weekdayOnly: [1, 2, 3, 4, 5, 6] },
  { merchant: 'Café del Ángel', amount: '1,60', categorySlug: 'comida', source: 'shortcut', paymentMethod: 'card', dayOfMonth: 5, weekdayOnly: [1, 2, 3, 4, 5] },
  { merchant: 'Café del Ángel', amount: '1,60', categorySlug: 'comida', source: 'shortcut', paymentMethod: 'card', dayOfMonth: 12, weekdayOnly: [1, 2, 3, 4, 5] },
  { merchant: 'Café del Ángel', amount: '2,10', categorySlug: 'comida', source: 'shortcut', paymentMethod: 'card', dayOfMonth: 19, weekdayOnly: [1, 2, 3, 4, 5] },
  { merchant: 'Café del Ángel', amount: '1,60', categorySlug: 'comida', source: 'shortcut', paymentMethod: 'card', dayOfMonth: 26, weekdayOnly: [1, 2, 3, 4, 5] },
  { merchant: 'Telepizza', amount: '18,90', categorySlug: 'comida', source: 'revolut', paymentMethod: 'card', dayOfMonth: 11 },
  { merchant: 'Telepizza', amount: '24,50', categorySlug: 'comida', source: 'revolut', paymentMethod: 'card', dayOfMonth: 25 },
  { merchant: 'Sushi Bar', amount: '32,00', categorySlug: 'comida', source: 'revolut', paymentMethod: 'card', dayOfMonth: 18 },
  { merchant: 'Uber', amount: '11,35', categorySlug: 'transporte', source: 'revolut', paymentMethod: 'card', dayOfMonth: 7 },
  { merchant: 'Uber', amount: '9,80', categorySlug: 'transporte', source: 'revolut', paymentMethod: 'card', dayOfMonth: 14 },
  { merchant: 'Uber', amount: '14,20', categorySlug: 'transporte', source: 'revolut', paymentMethod: 'card', dayOfMonth: 21 },
  { merchant: 'Cabify', amount: '8,45', categorySlug: 'transporte', source: 'revolut', paymentMethod: 'card', dayOfMonth: 10 },
  { merchant: 'Metro de Madrid', amount: '20,00', categorySlug: 'transporte', source: 'web', paymentMethod: 'other', dayOfMonth: 1 },
  { merchant: 'Renfe', amount: '45,20', categorySlug: 'transporte', source: 'web', paymentMethod: 'card', dayOfMonth: 15 },
  { merchant: 'Iberdrola', amount: '54,18', categorySlug: 'suministros', source: 'web', paymentMethod: 'transfer', dayOfMonth: 3 },
  { merchant: 'Movistar', amount: '39,90', categorySlug: 'suministros', source: 'web', paymentMethod: 'transfer', dayOfMonth: 3 },
  { merchant: 'Agua', amount: '19,44', categorySlug: 'suministros', source: 'web', paymentMethod: 'transfer', dayOfMonth: 3 },
  { merchant: 'Netflix', amount: '12,99', categorySlug: 'suscripciones', source: 'web', paymentMethod: 'card', dayOfMonth: 8 },
  { merchant: 'Spotify', amount: '10,99', categorySlug: 'suscripciones', source: 'web', paymentMethod: 'card', dayOfMonth: 8 },
  { merchant: 'iCloud+', amount: '2,99', categorySlug: 'suscripciones', source: 'web', paymentMethod: 'card', dayOfMonth: 8 },
  { merchant: 'Farmacia', amount: '14,75', categorySlug: 'salud', source: 'revolut', paymentMethod: 'card', dayOfMonth: 13 },
  { merchant: 'Clínica dental', amount: '80,00', categorySlug: 'salud', source: 'web', paymentMethod: 'card', dayOfMonth: 17 },
  { merchant: 'Amazon', amount: '35,99', categorySlug: 'compras', source: 'revolut', paymentMethod: 'card', dayOfMonth: 22 },
  { merchant: 'Zara', amount: '49,90', categorySlug: 'ropa', source: 'revolut', paymentMethod: 'card', dayOfMonth: 24 },
  { merchant: 'Decathlon', amount: '62,15', categorySlug: 'deportes', source: 'revolut', paymentMethod: 'card', dayOfMonth: 27 },
  { merchant: 'Gimnasio Basic', amount: '34,90', categorySlug: 'deportes', source: 'web', paymentMethod: 'transfer', dayOfMonth: 1 },
  { merchant: 'Cine', amount: '9,50', categorySlug: 'ocio', source: 'shortcut', paymentMethod: 'card', dayOfMonth: 28 },
  { merchant: 'Caja de efectivo', amount: '60,00', categorySlug: 'otros', source: 'web', paymentMethod: 'cash', dayOfMonth: 12 },
];

export interface SeedResult {
  userId: string;
  credentials: { email: string; password: string };
  categories: number;
  expenses: number;
  months: number;
  created: boolean;
}

/**
 * Crea (o reutiliza) la cuenta de demostración.
 *
 * `reset` borra y regenera los gastos. Por defecto no toca nada si ya existe,
 * para que pulsar el botón dos veces en la interfaz no duplique los datos.
 */
export async function seedDemoData(
  options: { months?: number; reset?: boolean; timezone?: string } = {},
): Promise<SeedResult> {
  const months = Math.min(Math.max(options.months ?? 4, 1), 12);
  const timezone = options.timezone ?? 'Europe/Madrid';

  const existing = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: { id: true },
  });

  if (existing && !options.reset) {
    const [categories, expenses] = await Promise.all([
      prisma.category.count({ where: { userId: existing.id } }),
      prisma.expense.count({ where: { userId: existing.id } }),
    ]);
    return {
      userId: existing.id,
      credentials: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
      categories,
      expenses,
      months,
      created: false,
    };
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const userId = await prisma.$transaction(async (tx) => {
    if (existing) {
      // Sólo se regenera lo que es dato de ejemplo. La cuenta y sus sesiones
      // se conservan: quien esté usando la demo no se queda fuera.
      await tx.expense.deleteMany({ where: { userId: existing.id } });
    }

    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: { passwordHash, name: 'Cuenta de demostración', isDemo: true },
          select: { id: true },
        })
      : await tx.user.create({
          data: {
            email: DEMO_EMAIL,
            passwordHash,
            name: 'Cuenta de demostración',
            timezone,
            isDemo: true,
          },
          select: { id: true },
        });

    // Se llama siempre, también con la cuenta ya creada: `createBaseData` es
    // idempotente, así que no duplica nada y sí añade lo que falte. La versión
    // anterior sólo creaba el catálogo si el usuario no tenía ninguna
    // categoría, y por eso una cuenta vieja se quedaba con categorías
    // desaparecidas al Actualizar la aplicación.
    await createBaseData(tx, user.id, true);

    await insertExpenses(tx, user.id, timezone, months);

    return user.id;
  });

  const [categories, expenses] = await Promise.all([
    prisma.category.count({ where: { userId } }),
    prisma.expense.count({ where: { userId } }),
  ]);

  return {
    userId,
    credentials: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
    categories,
    expenses,
    months,
    created: true,
  };
}

type Tx = Prisma.TransactionClient;

/**
 * Catálogo base para una cuenta: categorías, reglas de notificación y —si se
 * pide— reglas de comercio de ejemplo.
 *
 * Lo expone el módulo para que `prisma/seed.ts` pueda preparar una base recién
 * creada sin arrastrar el histórico de la demo. Es idempotente.
 */
export async function seedBaseData(
  userId: string,
  options: { withSuggestedRules?: boolean } = {},
): Promise<void> {
  await createBaseData(prisma, userId, options.withSuggestedRules ?? false);
}

/**
 * Crea lo que falte del catálogo y de las reglas.
 *
 * Es idempotente a propósito: se ejecuta en cada regeneración, también sobre
 * una cuenta existente, y nunca duplica filas. La clave es comprobar por
 * `slug` en lugar de contar: contar respondería "¿tienes alguna categoría?" y
 * eso no detecta que falte una concreta.
 */
async function createBaseData(tx: Tx, userId: string, withSuggestions: boolean) {
  const existing = await tx.category.findMany({
    where: { userId },
    select: { id: true, slug: true },
  });
  const byslug = new Map(existing.map((category) => [category.slug, category.id]));

  const missing = DEFAULT_CATEGORIES.filter((category) => !byslug.has(category.slug));
  if (missing.length > 0) {
    await tx.category.createMany({
      data: missing.map((category, index) => ({
        userId,
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        color: category.color,
        position: existing.length + index,
      })),
    });
    for (const category of missing) byslug.set(category.slug, '');
  }

  // Las reglas de notificación son genéricas y sólo aplican si el usuario no
  // tiene ninguna propia.
  const notificationRules = await tx.notificationRule.count({ where: { userId } });
  if (notificationRules === 0) {
    await tx.notificationRule.createMany({
      data: DEFAULT_NOTIFICATION_RULES.map((rule) => ({
        userId,
        name: rule.name,
        isEnabled: rule.isEnabled,
        priority: rule.priority,
        match: rule.match,
        matchType: rule.matchType,
        amountGroup: rule.amountGroup,
        merchantGroup: rule.merchantGroup,
        currencyGroup: rule.currencyGroup,
        isExpense: rule.isExpense,
      })),
    });
  }

  if (!withSuggestions) return;

  const merchantRules = await tx.merchantRule.count({ where: { userId } });
  if (merchantRules > 0) return;

  // Tras crear las categorías que faltaban, `byslug` necesita los ids nuevos.
  let ids = byslug;
  if (missing.length > 0) {
    const fresh = await tx.category.findMany({
      where: { userId },
      select: { id: true, slug: true },
    });
    ids = new Map(fresh.map((category) => [category.slug, category.id]));
  }

  const rules = SUGGESTED_RULES.filter((rule) => ids.has(rule.categorySlug)).map(
    (rule, index) => ({
      userId,
      pattern: rule.pattern,
      matchType: rule.matchType,
      // En la demo sí se activan: así el conjunto de ejemplo muestra la
      // categorización automática funcionando.
      categoryId: ids.get(rule.categorySlug)!,
      priority: 100 + index,
      isEnabled: true,
    }),
  );
  if (rules.length > 0) await tx.merchantRule.createMany({ data: rules });
}

/**
 * Inserta los gastos del histórico.
 *
 * Se construye una fila por fecha y se insertan en bloque con `createMany`:
 * miles de inserts individuales serían minutos de espera en local.
 */
async function insertExpenses(tx: Tx, userId: string, timezone: string, months: number) {
  const categories = await tx.category.findMany({
    where: { userId },
    select: { id: true, slug: true },
  });
  const byslug = new Map(categories.map((c) => [c.slug, c.id]));

  const now = new Date();
  const rows: Prisma.ExpenseCreateManyInput[] = [];

  for (let monthOffset = months - 1; monthOffset >= 0; monthOffset -= 1) {
    // Se anclan al mismo día del mes que el actual y luego se retrocede, para
    // que el mes en curso quede incompleto de forma realista.
    const anchor = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset, 1),
    );

    for (const item of TEMPLATE) {
      const year = anchor.getUTCFullYear();
      const month = anchor.getUTCMonth();
      const day = Math.min(item.dayOfMonth, daysInMonth(year, month));

      const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
      const weekday = date.getUTCDay();
      if (item.weekdayOnly && !item.weekdayOnly.includes(weekday)) continue;

      // En el mes en curso no se generan gastos con fecha futura.
      if (date.getTime() > now.getTime()) continue;

      const amount = jitter(item.amount, monthOffset, item.merchant);
      const timezoneOffset = new Date(date).getTimezoneOffset();
      const instant = new Date(date.getTime() - timezoneOffset * 60_000);
      // Los datos demo no se reenvían, así que basta una clave estable por
      // fila. El hash de contenido lo es: dos ejecuciones producen el mismo
      // conjunto, y por eso `skipDuplicates` funciona.
      const { idempotencyKey } = computeIdempotencyKey({
        userId,
        source: item.source,
        amount: new Prisma.Decimal(amount),
        currency: 'EUR',
        merchant: item.merchant,
        expenseDate: instant,
      });

      rows.push({
        userId,
        amount: new Prisma.Decimal(amount),
        currency: 'EUR',
        merchant: item.merchant,
        description: null,
        categoryId: byslug.get(item.categorySlug) ?? null,
        // `categorySource` describe de donde salio la categoria que se guardo.
        // Si el slug no existia y el gasto queda sin categorizar, decir 'rule'
        // seria mentira, y el panel lo contaria como reclasificado.
        categorySource: byslug.has(item.categorySlug) ? 'rule' : 'none',
        source: item.source,
        paymentMethod: item.paymentMethod,
        sourceTimezone: timezone,
        expenseDate: instant,
        receivedAt: item.source === 'revolut' ? instant : null,
        idempotencyKey,
      });
    }
  }

  if (rows.length > 0) {
    await tx.expense.createMany({ data: rows, skipDuplicates: true });
  }
}

/**
 * Varía ligeramente el importe entre meses.
 *
 * Sin esto, los 4 meses de la demo tendrían exactamente las mismas cifras y
 * cualquier error en la agregación por periodo pasaría desapercibido.
 */
function jitter(base: string, monthOffset: number, merchant: string): string {
  const value = Number(base.replace(',', '.'));
  if (!Number.isFinite(value)) return base;
  // Semilla estable a partir del comercio: los datos son reproducibles.
  const seed = [...merchant].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) + monthOffset;
  const factor = 0.88 + ((seed % 23) / 100);
  return (value * factor).toFixed(2);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
