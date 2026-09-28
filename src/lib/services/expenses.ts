import { Prisma, type Expense, type Category } from '@prisma/client';
import { prisma } from '../prisma';
import { parseAmount, AmountError } from '../money';
import {
  parseClientDateTime,
  DateTimeError,
  isValidTimezone,
  startOfMonth,
  endOfMonth,
} from '../datetime';
import {
  computeIdempotencyKey,
  findDuplicate,
  isUniqueConstraintError,
  DUPLICATE_WINDOW_MINUTES,
} from '../idempotency';
import { resolveCategoryFromRules, type RuleWithCategory } from '../categorization';
import { FALLBACK_CATEGORY_SLUG } from '../categories';
import { unprocessable, badRequest, notFound } from '../api';
import type { CreateExpenseInput, UpdateExpenseInput, ExpenseFilterInput } from '../validation';

/**
 * Servicio de gastos: toda la lógica de escritura pasa por aquí.
 *
 * Concentrarlo en un sitio garantiza que la captura desde el Atajo, la alta
 * manual en la web y la ingesta desde notificaciones apliquen exactamente las
 * mismas reglas de validación, idempotencia y categorización.
 */

export interface ExpenseWithRelations extends Expense {
  category: Pick<Category, 'id' | 'name' | 'slug' | 'icon' | 'color'> | null;
}

export interface CreateExpenseParams {
  userId: string;
  timezone: string;
  input: CreateExpenseInput;
  /** Token de dispositivo que originó la petición, si aplica. */
  deviceTokenId?: string | null;
  /** Fecha de recepción declarada por un cliente externo (Atajo). */
  receivedAt?: Date | null;
}

export type CreateOutcome =
  | { status: 'created'; expense: ExpenseWithRelations }
  | { status: 'duplicate'; expenseId: string; reason: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convierte un `YYYY-MM` a intervalo [inicio, fin) en la zona del usuario. */
export function monthRange(
  month: string,
  timezone: string,
): { gte: Date; lt: Date } {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
    throw badRequest(`Mes no válido: ${month}. Usa el formato YYYY-MM.`);
  }
  const reference = new Date(Date.UTC(year, monthNumber - 1, 15, 12));
  return {
    gte: startOfMonth(reference, timezone),
    lt: endOfMonth(reference, timezone),
  };
}

function resolveTimezone(candidate: string | null | undefined, fallback: string): string {
  if (candidate && isValidTimezone(candidate)) return candidate;
  return isValidTimezone(fallback) ? fallback : 'Europe/Madrid';
}

/**
 * Resuelve la categoría final de un gasto.
 *
 * Orden de preferencia:
 *  1. La que envía el cliente explícitamente (`categoryId` o `category` por
 *     nombre/slug) — es una decisión del usuario y gana siempre.
 *  2. Una regla de comercio que coincida.
 *  3. La categoría "Otros".
 *
 * Nunca se lanza un error por no encontrar categoría: es un dato opcional y
 * "sin categoría" siempre es un estado válido.
 */
async function resolveCategory(
  tx: Prisma.TransactionClient,
  userId: string,
  input: { categoryId?: string | null; category?: string | null; merchant?: string | null },
  explicit: boolean,
): Promise<{ categoryId: string | null; categorySource: string }> {
  if (explicit) {
    if (input.categoryId) {
      const found = await tx.category.findFirst({
        where: { id: input.categoryId, userId },
        select: { id: true },
      });
      if (!found) throw unprocessable('La categoría indicada no existe.');
      return { categoryId: found.id, categorySource: 'manual' };
    }
    if (input.category) {
      const needle = input.category.trim();
      const found = await tx.category.findFirst({
        where: {
          userId,
          OR: [{ slug: needle }, { name: { equals: needle, mode: 'insensitive' } }],
        },
        select: { id: true },
      });
      if (!found) {
        throw unprocessable(
          `La categoría "${needle}" no existe. Créalo en Categorías o usa una de las existentes.`,
        );
      }
      return { categoryId: found.id, categorySource: 'manual' };
    }
    return { categoryId: null, categorySource: 'manual' };
  }

  const rules = (await tx.merchantRule.findMany({
    where: { userId, isEnabled: true },
    include: {
      category: { select: { id: true, name: true, slug: true, color: true, icon: true } },
    },
  })) as RuleWithCategory[];

  const matched = resolveCategoryFromRules(input.merchant ?? null, rules);
  if (matched) {
    return { categoryId: matched.categoryId, categorySource: 'rule' };
  }

  const fallback = await tx.category.findFirst({
    where: { userId, slug: FALLBACK_CATEGORY_SLUG },
    select: { id: true },
  });
  return { categoryId: fallback?.id ?? null, categorySource: 'fallback' };
}

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

export async function createExpense(
  params: CreateExpenseParams,
): Promise<CreateOutcome> {
  const { userId, input } = params;
  const timezone = resolveTimezone(input.timezone, params.timezone);

  let amount: Prisma.Decimal;
  try {
    amount = parseAmount(input.amount);
  } catch (error) {
    if (error instanceof AmountError) throw unprocessable(error.message);
    throw error;
  }

  let expenseDate: Date;
  try {
    expenseDate = input.created_at
      ? parseClientDateTime(input.created_at, timezone).instant
      : new Date();
  } catch (error) {
    if (error instanceof DateTimeError) throw unprocessable(error.message);
    throw error;
  }

  // Un gasto no puede estar en el futuro ni muy lejos en el pasado: casi
  // siempre es un error del cliente (zona horaria equivocada, reloj mal).
  const now = Date.now();
  if (expenseDate.getTime() > now + 5 * 60_000) {
    throw unprocessable(
      'La fecha del gasto está en el futuro. Revisa la fecha y la zona horaria del dispositivo.',
    );
  }
  if (expenseDate.getTime() < now - 10 * 365 * 86_400_000) {
    throw unprocessable('La fecha del gasto es demasiado antigua.');
  }

  const source = input.source;
  const explicitCategory = Boolean(input.categoryId || input.category);

  const idempotency = computeIdempotencyKey({
    userId,
    source,
    amount,
    currency: input.currency,
    merchant: input.merchant,
    expenseDate,
    clientToken: input.client_token ?? null,
    sourceTransactionId: input.source_transaction_id ?? null,
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const duplicate = await findDuplicate(
        tx,
        {
          userId,
          source,
          amount,
          currency: input.currency,
          merchant: input.merchant,
          expenseDate,
        },
        idempotency.idempotencyKey,
        {
          allowDuplicate: input.allow_duplicate === true,
          windowMinutes: DUPLICATE_WINDOW_MINUTES,
        },
      );

      if (duplicate.isDuplicate) {
        return {
          kind: 'duplicate' as const,
          expenseId: duplicate.existingExpenseId!,
          reason: duplicate.reason ?? 'duplicate',
        };
      }

      const category = await resolveCategory(
        tx,
        userId,
        {
          categoryId: input.categoryId ?? null,
          category: input.category ?? null,
          merchant: input.merchant,
        },
        explicitCategory,
      );

      const expense = await tx.expense.create({
        data: {
          userId,
          amount,
          currency: input.currency,
          merchant: input.merchant,
          description: input.description,
          categoryId: category.categoryId,
          categorySource: category.categorySource,
          source,
          paymentMethod: input.paymentMethod ?? null,
          sourceTransactionId: input.source_transaction_id ?? null,
          idempotencyKey: idempotency.idempotencyKey,
          expenseDate,
          sourceTimezone: timezone,
          receivedAt: params.receivedAt ?? null,
        },
        include: categoryInclude,
      });

      return { kind: 'created' as const, expense };
    });

    if (result.kind === 'duplicate') {
      return {
        status: 'duplicate',
        expenseId: result.expenseId,
        reason: result.reason,
      };
    }
    return { status: 'created', expense: result.expense };
  } catch (error) {
    // Carrera perdida: dos peticiones idénticas llegaron a la vez. La
    // restricción única es la red de seguridad y el resultado honesto es
    // "duplicado", no un error 500.
    if (isUniqueConstraintError(error)) {
      const existing = await prisma.expense.findUnique({
        where: {
          userId_idempotencyKey: {
            userId,
            idempotencyKey: idempotency.idempotencyKey,
          },
        },
        select: { id: true },
      });
      if (existing) {
        return { status: 'duplicate', expenseId: existing.id, reason: 'idempotency_key' };
      }
    }
    throw error;
  }
}

export const categorySelect = {
  id: true,
  name: true,
  slug: true,
  icon: true,
  color: true,
} satisfies Prisma.CategorySelect;

/**
 * `include` y `select` son excluyentes en Prisma: para recortar las columnas
 * de la relación hay que anidar un `select` dentro del `include`, no pasar el
 * `select` plano como valor del `include`.
 */
export const categoryInclude = {
  category: { select: categorySelect },
} satisfies Prisma.ExpenseInclude;

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

/**
 * Traduce los filtros de la interfaz a una cláusula `where` de Prisma.
 *
 * Prisma parametriza todas las consultas, así que aquí no hay concatenación de
 * SQL: la protección frente a inyecciones es estructural, no una —
 * concatenación que haya que auditar.
 */
export function buildExpenseWhere(
  userId: string,
  filters: ExpenseFilterInput,
  timezone: string,
): Prisma.ExpenseWhereInput {
  const where: Prisma.ExpenseWhereInput = { userId };
  const dateRange: Prisma.DateTimeFilter = {};

  if (filters.month) {
    const range = monthRange(filters.month, timezone);
    dateRange.gte = range.gte;
    dateRange.lt = range.lt;
  }
  if (filters.from) {
    try {
      const from = parseClientDateTime(filters.from, timezone).instant;
      dateRange.gte = from;
    } catch (error) {
      if (error instanceof DateTimeError) throw unprocessable(error.message);
      throw error;
    }
  }
  if (filters.to) {
    try {
      const to = parseClientDateTime(filters.to, timezone).instant;
      // Un filtro "hasta el 28/09" debe incluir todo ese día, no sólo las
      // 00:00:00. Si el cliente envía una hora concreta, en cambio, se respeta
      // al minuto: por eso sólo se amplía cuando la entrada es sólo una fecha.
      const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(filters.to.trim());
      dateRange.lt = isDateOnly ? new Date(to.getTime() + 86_400_000) : to;
      if (isDateOnly) dateRange.lte = undefined;
    } catch (error) {
      if (error instanceof DateTimeError) throw unprocessable(error.message);
      throw error;
    }
  }

  if (Object.keys(dateRange).length > 0) {
    where.expenseDate = dateRange;
  }

  if (filters.categoryId?.length) {
    where.categoryId = { in: filters.categoryId };
  }

  if (filters.category?.length) {
    // Se aceptan slugs o nombres, porque el Atajo manda nombres.
    where.category = {
      OR: filters.category.map((value) => ({
        OR: [{ slug: value }, { name: { equals: value, mode: 'insensitive' } }],
      })),
    };
  }

  if (filters.source?.length) {
    where.source = { in: filters.source as Expense['source'][] };
  }

  if (filters.q) {
    // Prisma parametriza la consulta (no hay SQL injection posible). Nota: los
    // comodines `%` y `_` de `contains` no se escapan, así que buscarlos
    // literalmente no es posible; es una limitación del filtro, no un fallo de
    // seguridad, porque el valor viaja como parámetro.
    where.OR = [
      { merchant: { contains: filters.q, mode: 'insensitive' } },
      { description: { contains: filters.q, mode: 'insensitive' } },
      { category: { name: { contains: filters.q, mode: 'insensitive' } } },
    ];
  }

  if (filters.minAmount != null || filters.maxAmount != null) {
    const amount: Prisma.DecimalFilter = {};
    if (filters.minAmount != null) amount.gte = new Prisma.Decimal(filters.minAmount);
    if (filters.maxAmount != null) amount.lte = new Prisma.Decimal(filters.maxAmount);
    where.amount = amount;
  }

  return where;
}

const SORTS: Record<ExpenseFilterInput['sort'], Prisma.ExpenseOrderByWithRelationInput[]> = {
  date_desc: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
  date_asc: [{ expenseDate: 'asc' }, { createdAt: 'asc' }],
  amount_desc: [{ amount: 'desc' }, { expenseDate: 'desc' }],
  amount_asc: [{ amount: 'asc' }, { expenseDate: 'desc' }],
};

export async function listExpenses(
  userId: string,
  filters: ExpenseFilterInput,
  timezone: string,
): Promise<{ items: ExpenseWithRelations[]; total: number }> {
  const where = buildExpenseWhere(userId, filters, timezone);
  const [items, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: categoryInclude,
      orderBy: SORTS[filters.sort],
      take: filters.limit,
      skip: filters.offset,
    }),
    prisma.expense.count({ where }),
  ]);
  return { items: items as ExpenseWithRelations[], total };
}

export async function getExpense(
  userId: string,
  id: string,
): Promise<ExpenseWithRelations> {
  const expense = await prisma.expense.findFirst({
    where: { id, userId },
    include: categoryInclude,
  });
  if (!expense) throw notFound('Ese gasto no existe o no es tuyo.');
  return expense as ExpenseWithRelations;
}

// ---------------------------------------------------------------------------
// Edición
// ---------------------------------------------------------------------------

/**
 * Modifica un gasto.
 *
 * Al editar un gasto que vino de una fuente automática se conserva el
 * `source` original (nunca se reescribe a `web`) y se marca `edited = true`,
 * de modo que el usuario puede ver que un dato fue corregido a mano.
 */
export async function updateExpense(
  userId: string,
  id: string,
  input: UpdateExpenseInput,
  timezoneFallback: string,
): Promise<ExpenseWithRelations> {
  const existing = await prisma.expense.findFirst({
    where: { id, userId },
    select: { id: true, source: true },
  });
  if (!existing) throw notFound('Ese gasto no existe o no es tuyo.');

  const data: Prisma.ExpenseUpdateInput = {};

  if (input.amount !== undefined) {
    try {
      data.amount = parseAmount(input.amount);
    } catch (error) {
      if (error instanceof AmountError) throw unprocessable(error.message);
      throw error;
    }
  }

  if (input.currency !== undefined) data.currency = input.currency;
  if (input.merchant !== undefined) data.merchant = input.merchant;
  if (input.description !== undefined) data.description = input.description;
  if (input.paymentMethod !== undefined) {
    data.paymentMethod = input.paymentMethod ?? null;
  }

  // `!= null` y no `!== undefined`: `optionalText` devuelve `null` cuando el
  // campo llega vacío, y una fecha vacía debe ignorarse, no borrar la fecha.
  if (input.created_at !== null && input.created_at !== undefined) {
    const timezone = resolveTimezone(input.timezone, timezoneFallback);
    try {
      data.expenseDate = parseClientDateTime(input.created_at, timezone).instant;
      data.sourceTimezone = timezone;
    } catch (error) {
      if (error instanceof DateTimeError) throw unprocessable(error.message);
      throw error;
    }
  }

  const categoryTouched = input.categoryId !== undefined || input.category !== undefined;
  if (categoryTouched) {
    const resolved = await prisma.$transaction(async (tx) =>
      resolveCategory(
        tx,
        userId,
        {
          categoryId: input.categoryId ?? null,
          category: input.category ?? null,
          merchant: input.merchant,
        },
        true,
      ),
    );
    data.category = resolved.categoryId
      ? { connect: { id: resolved.categoryId } }
      : { disconnect: true };
    data.categorySource = resolved.categorySource;
  }

  // El origen no se toca nunca, pero sí queda constancia de la edición.
  data.edited = true;

  const updated = await prisma.expense.update({
    where: { id },
    data,
    include: categoryInclude,
  });
  return updated as ExpenseWithRelations;
}

export async function deleteExpense(userId: string, id: string): Promise<void> {
  const { count } = await prisma.expense.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound('Ese gasto no existe o no es tuyo.');
}
