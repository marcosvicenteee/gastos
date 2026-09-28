import type { NextRequest } from 'next/server';
import { jsonCreated, jsonOk, withErrorHandling } from '@/lib/api';
import { requireAnyAuth, parseQuery, readJson, type AuthContext } from '@/lib/server/route-helpers';
import { createExpense, listExpenses } from '@/lib/services/expenses';
import { createExpenseSchema, expenseFilterSchema } from '@/lib/validation';
import { toSerialisableExpense } from '@/lib/serialise';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * `GET /api/expenses`
 *
 * Acepta cookie de sesión (web) o token de dispositivo (Atajo consultando su
 * propio histórico). Todos los filtros se validan con Zod antes de tocar la
 * base de datos.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const context = await requireAnyAuth(request, 'expenses-list', RATE_LIMITS.read);
  const filters = parseQuery(expenseFilterSchema, request);

  const { items, total } = await listExpenses(
    context.user.id,
    filters,
    context.user.timezone,
  );

  return jsonOk({
    // Arrow y no `items.map(toSerialisableExpense)`: al pasar la referencia
    // directa, TypeScript asigna a `timezone` el índice del array y avisa.
    items: items.map((expense) => toSerialisableExpense(expense, context.user.timezone)),
    pagination: {
      total,
      limit: filters.limit,
      offset: filters.offset,
      hasMore: filters.offset + items.length < total,
    },
  });
});

/**
 * `POST /api/expenses`
 *
 * Alta de gasto desde la web o desde el Atajo.
 *
 * Respuestas:
 *  · `201` con `{ status: "created", expense }`  → gasto nuevo.
 *  · `200` con `{ status: "duplicate", ... }`   → ya existía, no se duplica.
 *
 * Devolver 200 en vez de 201 para el duplicado es intencionado: para el Atajo
 * un reintento de la cola offline es un **éxito**, no un fallo. Así el Atajo
 * puede vaciar su cola sin alarmar al usuario.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const context: AuthContext = await requireAnyAuth(
    request,
    'expenses-create',
    RATE_LIMITS.write,
  );
  const input = await readJson(request, createExpenseSchema);

  // Si la petición llega con un token de dispositivo y no declara origen, se
  // deduce `shortcut`: una escritura autenticada con token que no viene de la
  // ingesta de notificaciones es, por definición, el Atajo manual. Así un
  // Atajo construido a mano sin el campo `source` sigue clasificando bien.
  const source =
    context.via === 'device_token' && input.source === 'web'
      ? 'shortcut'
      : input.source;

  const outcome = await createExpense({
    userId: context.user.id,
    timezone: context.user.timezone,
    input: { ...input, source },
    deviceTokenId: context.deviceTokenId,
    receivedAt: null,
  });

  if (outcome.status === 'duplicate') {
    return jsonOk({
      status: 'duplicate' as const,
      expenseId: outcome.expenseId,
      reason: outcome.reason,
      message: 'Este gasto ya estaba registrado; no se ha creado otro.',
    });
  }

  return jsonCreated({
    status: 'created' as const,
    expense: toSerialisableExpense(outcome.expense, context.user.timezone),
  });
});
