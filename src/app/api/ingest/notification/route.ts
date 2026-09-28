import type { NextRequest } from 'next/server';
import { IngestStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { jsonCreated, jsonOk, withErrorHandling } from '@/lib/api';
import { readJson, requireDeviceToken } from '@/lib/server/route-helpers';
import { createExpense } from '@/lib/services/expenses';
import {
  joinNotification,
  parseNotification,
  toRuleLike,
  type ParseOutcome,
} from '@/lib/notifications/parse';
import { ingestNotificationSchema, type IngestNotificationInput } from '@/lib/validation';
import { parseAmount, AmountError } from '@/lib/money';
import { parseClientDateTime } from '@/lib/datetime';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/ingest/notification`
 *
 * Vía de captura. La llama el Atajo de iOS 27 con el texto crudo de la
 * notificación ("Pago de 12,50 € en Mercadona"). El servidor decide qué hacer;
 * el Atajo no interpreta nada. Esa separación es deliberada: las reglas se
 * pueden corregir sin volver a tocar el Atajo, y viceversa.
 *
 * **Siempre responde 200**, incluso si la notificación no se entiende. Un 4xx
 * obligaría al Atajo a reintentar algo que no va a funcionar nunca, y la cola
 * offline se llenaría de basura irrecuperable. El resultado va en `status`.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  // Token de dispositivo, no cookie: un Atajo no tiene sesión de navegador.
  const auth = await requireDeviceToken(request, 'ingest', RATE_LIMITS.ingest);
  const payload = await readJson(request, ingestNotificationSchema);
  const receivedAt = parseReceivedAt(payload.received_at ?? null);

  // Camino 1: el usuario rellenó el formulario del Atajo. Lo que escribió una
  // persona siempre gana a lo que adivine un parser.
  if (payload.amount !== null && payload.amount !== undefined && payload.amount !== '') {
    return recordManualEntry(auth, payload, receivedAt);
  }

  // Camino 2: notificación pura.
  const notification = {
    app: payload.app ?? null,
    title: payload.title ?? null,
    subtitle: payload.subtitle ?? null,
    body: payload.body ?? null,
  };
  const text = joinNotification(notification);

  if (text === '') {
    return logAndReport(auth, payload, receivedAt, {
      status: IngestStatus.ignored,
      errorCode: 'empty',
      errorMessage: 'La notificación no traía texto.',
    });
  }

  const rules = await prisma.notificationRule.findMany({
    where: { userId: auth.user.id, isEnabled: true },
    orderBy: { priority: 'asc' },
  });

  const outcome: ParseOutcome = parseNotification(
    notification,
    rules.map(toRuleLike),
  );

  if (outcome.kind === 'not_an_expense') {
    // Regla de exclusión: un abono o una devolución no es un gasto. Se
    // descarta con traza, para poder explicar después por qué no aparece.
    return logAndReport(auth, payload, receivedAt, {
      status: IngestStatus.ignored,
      errorCode: 'not_an_expense',
      errorMessage: outcome.reason,
      matchedRuleId: outcome.ruleId,
    });
  }

  if (outcome.kind === 'unparsed') {
    return logAndReport(auth, payload, receivedAt, {
      status: IngestStatus.failed,
      errorCode: 'unparsed',
      errorMessage: outcome.reason,
    });
  }

  let amount;
  try {
    amount = parseAmount(outcome.amount);
  } catch (error) {
    // El regex acertó el token pero no es un importe válido ("12,50,50"). Se
    // registra el fallo con el texto exacto para poder corregir la regla.
    return logAndReport(auth, payload, receivedAt, {
      status: IngestStatus.failed,
      errorCode: 'bad_amount',
      errorMessage:
        error instanceof AmountError ? error.message : 'El importe no se pudo interpretar.',
      parsedAmount: outcome.amount,
      parsedCurrency: outcome.currency,
      parsedMerchant: outcome.merchant,
      matchedRuleId: outcome.ruleId,
    });
  }

  const result = await createExpense({
    userId: auth.user.id,
    timezone: auth.user.timezone,
    input: {
      amount: amount.toString(),
      currency: outcome.currency ?? 'EUR',
      merchant: outcome.merchant,
      description: text.slice(0, 500),
      category: null,
      source: 'revolut',
      // El texto de la notificación no dice con qué se pagó (tarjeta,
      // efectivo, Apple Pay...): se deja vacío en lugar de suponer "tarjeta".
      paymentMethod: null,
      created_at: receivedAt.toISOString(),
      timezone: payload.timezone ?? auth.user.timezone,
    },
    deviceTokenId: auth.deviceTokenId,
    receivedAt,
  });

  if (result.status === 'duplicate') {
    return logAndReport(
      auth,
      payload,
      receivedAt,
      {
        status: IngestStatus.duplicate,
        errorCode: result.reason,
        errorMessage: 'Ya existía un gasto equivalente.',
        parsedAmount: amount.toString(),
        parsedCurrency: outcome.currency,
        parsedMerchant: outcome.merchant,
        matchedRuleId: outcome.ruleId,
        expenseId: result.expenseId,
      },
      {
        status: 'duplicate',
        expenseId: result.expenseId,
        reason: result.reason,
        text,
      },
    );
  }

  return logAndReport(
    auth,
    payload,
    receivedAt,
    {
      status: IngestStatus.created,
      errorCode: null,
      errorMessage: null,
      parsedAmount: amount.toString(),
      parsedCurrency: outcome.currency,
      parsedMerchant: outcome.merchant,
      matchedRuleId: outcome.ruleId,
      expenseId: result.expense.id,
    },
    {
      status: 'created',
      expenseId: result.expense.id,
      amount: amount.toString(),
      currency: outcome.currency,
      merchant: outcome.merchant,
      rule: outcome.ruleName,
      ruleId: outcome.ruleId,
      extraction: outcome.extraction,
      text,
    },
  );
});

// ---------------------------------------------------------------------------
// Atajo manual
// ---------------------------------------------------------------------------

/**
 * Alta manual desde el Atajo (importe, comercio y categoría elegido a mano).
 *
 * El `client_token` es lo que hace que un reintento de la cola offline sea
 * seguro: si el Atajo reenvía la misma entrada, el servidor la reconoce y
 * responde `duplicate` en lugar de crear un gasto repetido.
 */
async function recordManualEntry(
  auth: { user: { id: string; timezone: string }; deviceTokenId: string | null },
  payload: IngestNotificationInput,
  receivedAt: Date,
) {
  const result = await createExpense({
    userId: auth.user.id,
    timezone: auth.user.timezone,
    input: {
      amount: payload.amount as string,
      currency: 'EUR',
      merchant: payload.merchant,
      description: payload.text,
      category: payload.category,
      source: 'shortcut',
      // El Atajo manual no sabe el método de pago; se deja vacío en lugar de
      // suponer "tarjeta", que sería inventar un dato.
      paymentMethod: null,
      created_at: receivedAt.toISOString(),
      timezone: payload.timezone ?? auth.user.timezone,
      client_token: payload.client_token,
    },
    deviceTokenId: auth.deviceTokenId,
    receivedAt,
  });

  if (result.status === 'duplicate') {
    return jsonOk({
      status: 'duplicate',
      expenseId: result.expenseId,
      reason: result.reason,
    });
  }
  return jsonCreated({ status: 'created', expenseId: result.expense.id });
}

// ---------------------------------------------------------------------------
// Traza de ingesta
// ---------------------------------------------------------------------------

/**
 * Sin este registro no habría forma de saber por qué un pago no aparece: el
 * usuario vería simplemente "no pasa nada" y el Atajo no tendría dónde mirar.
 */
async function logAndReport(
  auth: { user: { id: string }; deviceTokenId: string | null },
  payload: IngestNotificationInput,
  receivedAt: Date,
  row: {
    status: IngestStatus;
    errorCode: string | null;
    errorMessage: string | null;
    parsedAmount?: string | null;
    parsedCurrency?: string | null;
    parsedMerchant?: string | null;
    matchedRuleId?: string | null;
    expenseId?: string | null;
  },
  response?: Record<string, unknown>,
) {
  await prisma.ingestionEvent.create({
    data: {
      userId: auth.user.id,
      deviceTokenId: auth.deviceTokenId,
      source: payload.app ?? 'desconocida',
      appName: payload.app ?? null,
      rawTitle: payload.title ?? null,
      rawSubtitle: payload.subtitle ?? null,
      rawBody: payload.body ?? null,
      receivedAt,
      parsedAmount: row.parsedAmount ?? null,
      parsedCurrency: row.parsedCurrency ?? null,
      parsedMerchant: row.parsedMerchant ?? null,
      matchedRuleId: row.matchedRuleId ?? null,
      expenseId: row.expenseId ?? null,
      status: row.status,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
    },
  });

  if (response) return jsonOk(response);
  if (row.status === IngestStatus.ignored) {
    return jsonOk({
      status: 'ignored',
      reason: row.errorMessage ?? 'La notificación se ha descartado.',
      text: joinNotification({
        app: payload.app ?? null,
        title: payload.title ?? null,
        subtitle: payload.subtitle ?? null,
        body: payload.body ?? null,
      }),
    });
  }
  return jsonOk({
    status: 'failed',
    reason: row.errorMessage ?? 'No se ha podido registrar el gasto.',
    text: joinNotification({
      app: payload.app ?? null,
      title: payload.title ?? null,
      subtitle: payload.subtitle ?? null,
      body: payload.body ?? null,
    }),
  });
}

/**
 * Convierte la marca de tiempo de la notificación en un instante.
 *
 * Si no se puede interpretar se usa la hora de recepción: es preferible un
 * gasto con la hora aproximada que un gasto descartado, porque el usuario ve
 * el importe y puede corregir la fecha.
 */
function parseReceivedAt(value: string | null): Date {
  if (!value) return new Date();
  try {
    return parseClientDateTime(value, 'UTC').instant;
  } catch {
    return new Date();
  }
}
