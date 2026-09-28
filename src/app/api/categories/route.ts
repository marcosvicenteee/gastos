import type { NextRequest } from 'next/server';
import { jsonCreated, jsonOk, withErrorHandling } from '@/lib/api';
import { parseQuery, readJson, requireAnyAuth } from '@/lib/server/route-helpers';
import { createCategory, listCategories } from '@/lib/services/categories';
import { categoryFilterSchema, createCategorySchema } from '@/lib/validation';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/** `GET /api/categories` — `?includeArchived=1` para ver también las archivadas. */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAnyAuth(request, 'categories-list', RATE_LIMITS.read);
  const query = parseQuery(categoryFilterSchema, request);
  const categories = await listCategories(auth.user.id, {
    includeArchived: query.includeArchived,
  });
  return jsonOk({ categories });
});

/** `POST /api/categories` */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAnyAuth(request, 'categories-create', RATE_LIMITS.write);
  const input = await readJson(request, createCategorySchema);
  return jsonCreated({ category: await createCategory(auth.user.id, input) });
});
