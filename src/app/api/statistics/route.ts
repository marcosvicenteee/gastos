import type { NextRequest } from 'next/server';
import { jsonOk, withErrorHandling } from '@/lib/api';
import { requireAnyAuth } from '@/lib/server/route-helpers';
import { computeStatistics } from '@/lib/services/statistics';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * `GET /api/statistics`
 *
 * Fuerza el renderizado dinámico: los totales dependen del momento actual y de
 * la zona horaria del usuario, así que no deben cachearse.
 */
export const dynamic = 'force-dynamic';

/** `GET /api/statistics` — todo lo que pinta el dashboard, en una llamada. */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAnyAuth(request, 'statistics', RATE_LIMITS.read);
  const statistics = await computeStatistics(auth.user.id, auth.user.timezone);
  return jsonOk({ statistics, timezone: auth.user.timezone, currency: auth.user.currency });
});
