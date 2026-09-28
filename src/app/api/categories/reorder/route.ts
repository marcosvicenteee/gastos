import type { NextRequest } from 'next/server';
import { jsonOk, withErrorHandling } from '@/lib/api';
import { readJson, requireAnyAuth } from '@/lib/server/route-helpers';
import { reorderCategories } from '@/lib/services/categories';
import { reorderCategoriesSchema } from '@/lib/validation';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/** `POST /api/categories/reorder` — fija el orden del menú del Atajo. */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAnyAuth(request, 'categories-reorder', RATE_LIMITS.write);
  const { ids } = await readJson(request, reorderCategoriesSchema);
  return jsonOk({ categories: await reorderCategories(auth.user.id, ids) });
});
