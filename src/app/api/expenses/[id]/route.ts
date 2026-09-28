import type { NextRequest } from 'next/server';
import { jsonOk, withErrorHandling } from '@/lib/api';
import { requireAnyAuth, readJson } from '@/lib/server/route-helpers';
import {
  deleteExpense,
  getExpense,
  updateExpense,
} from '@/lib/services/expenses';
import { updateExpenseSchema } from '@/lib/validation';
import { toSerialisableExpense } from '@/lib/serialise';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** `GET /api/expenses/:id` */
export const GET = withErrorHandling(async (request: NextRequest, context: Params) => {
  const auth = await requireAnyAuth(request, 'expense-read', RATE_LIMITS.read);
  const { id } = await context.params;
  const expense = await getExpense(auth.user.id, id);
  return jsonOk({ expense: toSerialisableExpense(expense, auth.user.timezone) });
});

/**
 * `PATCH /api/expenses/:id`
 *
 * Editar un gasto que vino de una fuente automática **no cambia su origen**:
 * sigue siendo `revolut` o `shortcut` y se marca `edited = true`. Así se
 * distingue "el sistema lo registró así" de "yo lo corregí".
 */
export const PATCH = withErrorHandling(async (request: NextRequest, context: Params) => {
  const auth = await requireAnyAuth(request, 'expense-update', RATE_LIMITS.write);
  const { id } = await context.params;
  const input = await readJson(request, updateExpenseSchema);

  const expense = await updateExpense(auth.user.id, id, input, auth.user.timezone);
  return jsonOk({ expense: toSerialisableExpense(expense, auth.user.timezone) });
});

/** `DELETE /api/expenses/:id` */
export const DELETE = withErrorHandling(async (request: NextRequest, context: Params) => {
  const auth = await requireAnyAuth(request, 'expense-delete', RATE_LIMITS.write);
  const { id } = await context.params;
  await deleteExpense(auth.user.id, id);
  return jsonOk({ ok: true, id });
});
