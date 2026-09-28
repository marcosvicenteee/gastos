import type { NextRequest } from 'next/server';
import { jsonOk, withErrorHandling } from '@/lib/api';
import { requireAnyAuth } from '@/lib/server/route-helpers';
import { listCategories } from '@/lib/services/categories';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/categories/options`
 *
 * Lista mínima para elegir categoría, pensada para el Atajo: sólo los campos
 * que un selector necesita, sin los contadores ni las marcas de tiempo que
 *ocratizan la respuesta de `GET /api/categories`. Un Atajo que descarga
 * opciones para un menú paga por cada byte en cellular.
 *
 * Acepta sesión o token de dispositivo, porque el Atajo no tiene cookie.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAnyAuth(request, 'category-options', RATE_LIMITS.read);
  const categories = await listCategories(auth.user.id);

  return jsonOk({
    options: categories
      .filter((category) => !category.isArchived)
      .map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        color: category.color,
      })),
  });
});
