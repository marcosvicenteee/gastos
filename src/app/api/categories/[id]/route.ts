import type { NextRequest } from 'next/server';
import { jsonOk, withErrorHandling } from '@/lib/api';
import { readJson, requireAnyAuth } from '@/lib/server/route-helpers';
import { deleteCategory, updateCategory } from '@/lib/services/categories';
import { deleteCategorySchema, updateCategorySchema } from '@/lib/validation';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** `PATCH /api/categories/:id` */
export const PATCH = withErrorHandling(async (request: NextRequest, context: Params) => {
  const auth = await requireAnyAuth(request, 'category-update', RATE_LIMITS.write);
  const { id } = await context.params;
  const input = await readJson(request, updateCategorySchema);
  return jsonOk({ category: await updateCategory(auth.user.id, id, input) });
});

/**
 * `DELETE /api/categories/:id`
 *
 * Si la categoría tiene gastos, hay que indicar explícitamente a cuál se
 * reasignan. Si no, se responde 409 en vez de destruir historial en silencio.
 *
 * No se reasigna a "otros" por defecto: el usuario tiene que ver adónde
 * va su dinero. `getFallbackCategoryId` sigue existiendo para que el
 * formulario de la interfaz pueda preseleccionar ese destino.
 */
export const DELETE = withErrorHandling(async (request: NextRequest, context: Params) => {
  const auth = await requireAnyAuth(request, 'category-delete', RATE_LIMITS.write);
  const { id } = await context.params;
  const input = await readJson(request, deleteCategorySchema);

  const result = await deleteCategory(auth.user.id, id, input.moveExpensesTo ?? null);
  return jsonOk({ ...result, id });
});
