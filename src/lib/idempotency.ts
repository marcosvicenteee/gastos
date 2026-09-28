import { Prisma } from '@prisma/client';
import { hmacSha256 } from './crypto';
import { env } from './env';
import { normaliseText } from './categorization';

/**
 * Prevención de gastos duplicados.
 *
 * El problema real no es "el mismo POST dos veces", sino tres situaciones
 * distintas que hay que tratar por separado:
 *
 *  A) **Reintento de la cola offline del Atajo.** La misma petición se envía
 *     varias veces, minutos o horas después, porque el iPhone no tenía
 *     cobertura. Se resuelve con `client_token`: el Atajo genera un UUID una
 *     sola vez y lo reutiliza en cada reintento.
 *
 *  B) **La misma notificación de Revolut capturada dos veces.** Aquí el
 *     `client_token` NO sirve, porque cada ejecución de la automatización
 *     genera un UUID distinto. Se resuelve con un hash de contenido:
 *     usuario + importe + comercio + minuto + fuente. Como la notificación no
 *     trae fecha propia, se usa el minuto de recepción.
 *
 *  C) **Un pago online que Revolut notifica dos veces** ("pendiente" y luego
 *     "completado"), o una reentrega del sistema de notificaciones con
 *     minutos de diferencia. El hash de contenido no basta porque el minuto
 *     cambia. Se añade una comprobación de proximidad: si ya existe un gasto
 *     del mismo proveedor con el mismo importe y comercio en una ventana de
 *     minutos configurable, se considera duplicado.
 *
 * Los gastos creados a mano en la web (`source: "web"`) nunca se deduplican:
 * comprar dos cafés de 1,20 € el mismo minuto es perfectamente legítimo.
 */

/** Ventana de proximidad para detectar la misma notificación reenviada. */
export const DUPLICATE_WINDOW_MINUTES = 3;

export type IdempotencyInput = {
  userId: string;
  source: 'web' | 'shortcut' | 'revolut';
  amount: Prisma.Decimal;
  currency: string;
  merchant: string | null | undefined;
  expenseDate: Date;
  /** UUID generado por el Atajo, si lo envió. */
  clientToken?: string | null;
  /** Identificador de la transacción en el proveedor, si existe. */
  sourceTransactionId?: string | null;
};

export type IdempotencyResult = {
  idempotencyKey: string;
  /** De dónde salió la clave, útil para trazas y para el panel. */
  strategy: 'client_token' | 'source_transaction_id' | 'content_hash' | 'none';
};

/**
 * Calcula la clave de idempotencia.
 *
 * La prioridad depende del origen, y no es arbitraria:
 *  · `revolut` prioriza el hash de contenido sobre el `client_token`, porque
 *    en una notificación cada ejecución es un evento distinto y su UUID no
 *    sirve para detectar que es el mismo pago.
 *  · `shortcut` prioriza el `client_token`, que es precisamente la señal de
 *    "he reintentado la misma captura".
 *  · `web` no deduplica.
 */
export function computeIdempotencyKey(input: IdempotencyInput): IdempotencyResult {
  const { source } = input;

  if (source === 'revolut') {
    if (input.sourceTransactionId) {
      return {
        idempotencyKey: `st:${input.sourceTransactionId}`,
        strategy: 'source_transaction_id',
      };
    }
    return {
      idempotencyKey: contentHash(input),
      strategy: 'content_hash',
    };
  }

  if (source === 'shortcut') {
    if (input.clientToken) {
      return {
        idempotencyKey: `ct:${input.clientToken}`,
        strategy: 'client_token',
      };
    }
    return { idempotencyKey: contentHash(input), strategy: 'content_hash' };
  }

  // Alta manual en la web: cada clic es una intención distinta.
  return {
    idempotencyKey: `web:${crypto.randomUUID()}`,
    strategy: 'none',
  };
}

/**
 * Hash determinista del contenido del gasto.
 *
 * Se usa HMAC y no un hash simple para que un atacante que consiga leer la
 * tabla no pueda confirmar por fuerza bruta qué combinaciones de importe y
 * comercio existen. La clave sale de `DEVICE_TOKEN_SECRET`, así que el hash
 * tampoco sirve si alguien se lleva la base de datos sin los secretos.
 *
 * El importe se reduce a céntimos enteros: comparar `12.50` como decimal es
 * correcto, pero trabajar en enteros evita cualquier duda de coma flotante.
 */
function contentHash(input: IdempotencyInput): string {
  const cents = input.amount
    .mul(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(0);

  const merchant = normaliseText(input.merchant ?? '');
  // Se trunca el minuto: así una notificación y su reenvía a los 40 segundos
  // caen en el mismo minuto y se consideran el mismo evento.
  const minuteBucket = input.expenseDate.toISOString().slice(0, 16);

  const message = [
    input.userId,
    input.source,
    cents,
    input.currency.toUpperCase(),
    merchant,
    minuteBucket,
  ].join('|');

  return `h:${hmacSha256(env.deviceTokenSecret, message)}`;
}

export type DuplicateLookupResult = {
  isDuplicate: boolean;
  /** Id del gasto ya existente, si lo hay. */
  existingExpenseId?: string;
  reason?: 'idempotency_key' | 'proximity_window';
};

/**
 * Busca un gasto equivalente ya registrado.
 *
 * Se ejecuta justo antes de insertar, dentro de la misma transacción, para
 * cerrar la ventana de carrera entre el SELECT y el INSERT. La restricción
 * `UNIQUE (userId, idempotencyKey)` es la red de seguridad definitiva: si dos
 * peticiones idénticas llegan a la vez, una gana y la otra recibe un error de
 * clave duplicada, que se traduce en "duplicado" en lugar de "error 500".
 */
export async function findDuplicate(
  tx: Prisma.TransactionClient,
  input: IdempotencyInput,
  idempotencyKey: string,
  options: { allowDuplicate: boolean; windowMinutes: number },
): Promise<DuplicateLookupResult> {
  const exact = await tx.expense.findUnique({
    where: {
      userId_idempotencyKey: { userId: input.userId, idempotencyKey },
    },
    select: { id: true },
  });
  if (exact) {
    return { isDuplicate: true, existingExpenseId: exact.id, reason: 'idempotency_key' };
  }

  if (options.allowDuplicate) return { isDuplicate: false };
  // La ventana de proximidad sólo tiene sentido para capturas automáticas.
  if (input.source !== 'revolut') return { isDuplicate: false };

  const windowStart = new Date(
    input.expenseDate.getTime() - options.windowMinutes * 60_000,
  );
  const windowEnd = new Date(
    input.expenseDate.getTime() + options.windowMinutes * 60_000,
  );

  const nearby = await tx.expense.findFirst({
    where: {
      userId: input.userId,
      source: 'revolut',
      amount: input.amount,
      currency: input.currency,
      merchant: input.merchant
        ? { equals: input.merchant, mode: 'insensitive' }
        : null,
      expenseDate: { gte: windowStart, lte: windowEnd },
    },
    orderBy: { expenseDate: 'desc' },
    select: { id: true },
  });

  if (nearby) {
    return { isDuplicate: true, existingExpenseId: nearby.id, reason: 'proximity_window' };
  }
  return { isDuplicate: false };
}

/** Detecta el conflicto de clave única de PostgreSQL (SQLSTATE 23505). */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
