import { toNumber } from './money';
import { formatDateTime, formatRelativeDay } from './datetime';
import type { ExpenseWithRelations } from './services/expenses';
import type { ExportRow } from './export';

/**
 * Conversión de entidades Prisma a JSON.
 *
 * Existe por una razón concreta: `Prisma.Decimal` y `Date` no son tipos que
 * `JSON.stringify` maneje de forma útil. Un `Date` se serializa como cadena
 * ISO en UTC (correcto), pero un `Decimal` se serializaría con una
 * implementación propia que puede perder precisión o filtrar al cliente estados internos
 * Aquí se fijan de forma explícita:
 *
 *  · `amount` → número con 2 decimales, ya redondeado.
 *  · `expenseDate` → ISO en UTC **y** la versión formateada en la zona del
 *    usuario, para que el frontend no tenga que recalcularla y todos los
 *    clientes muestren exactamente la misma hora.
 */

export interface SerialisedExpense {
  id: string;
  amount: number;
  amountFormatted: string;
  currency: string;
  merchant: string | null;
  description: string | null;
  category: {
    id: string;
    name: string;
    slug: string;
    icon: string;
    color: string;
  } | null;
  source: 'web' | 'shortcut' | 'revolut';
  paymentMethod: string | null;
  expenseDate: string;
  expenseDateLocal: string;
  expenseDateRelative: string;
  sourceTimezone: string | null;
  receivedAt: string | null;
  edited: boolean;
  categorySource: string | null;
  createdAt: string;
  updatedAt: string;
}

const LOCALE = 'es-ES';

export function toSerialisableExpense(
  expense: ExpenseWithRelations,
  timezone: string,
): SerialisedExpense {
  return {
    id: expense.id,
    amount: toNumber(expense.amount),
    amountFormatted: formatAmount(expense.amount, expense.currency),
    currency: expense.currency,
    merchant: expense.merchant,
    description: expense.description,
    category: expense.category,
    source: expense.source,
    paymentMethod: expense.paymentMethod,
    expenseDate: expense.expenseDate.toISOString(),
    expenseDateLocal: formatDateTime(expense.expenseDate, timezone, LOCALE),
    expenseDateRelative: formatRelativeDay(expense.expenseDate, timezone, new Date(), LOCALE),
    sourceTimezone: expense.sourceTimezone,
    receivedAt: expense.receivedAt?.toISOString() ?? null,
    edited: expense.edited,
    categorySource: expense.categorySource,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}

/** Formato monetario en español, con el símbolo detrás: `12,50 €`. */
function formatAmount(amount: unknown, currency: string): string {
  const value = typeof amount === 'number' ? amount : toNumber(amount as never);
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Divisa desconocida: se muestra el número con el código, no se rompe.
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function toExportRow(expense: ExpenseWithRelations): ExportRow {
  return {
    id: expense.id,
    amount: expense.amount,
    currency: expense.currency,
    merchant: expense.merchant,
    categoryName: expense.category?.name ?? null,
    description: expense.description,
    source: expense.source,
    paymentMethod: expense.paymentMethod,
    expenseDate: expense.expenseDate,
    sourceTimezone: expense.sourceTimezone,
    receivedAt: expense.receivedAt,
    edited: expense.edited,
    createdAt: expense.createdAt,
  };
}
