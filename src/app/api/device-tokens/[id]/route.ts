import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonOk, withErrorHandling, ApiError } from '@/lib/api';
import { requireSession } from '@/lib/server/route-helpers';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * `DELETE /api/device-tokens/:id`
 *
 * Revoca un dispositivo. El registro no se borra: se marca `revokedAt` para
 * conservar la traza de qué Atajo existedó y cuándo se usó por última vez. El
 * hash del token deja de coincidir, así que el Atajo recibe 401 a partir de
 * ese momento sin necesidad de tocar nada más.
 *
 * Un token ya revocado responde 200 y no falla: revocar dos veces es lo que
 * hace un cliente que no sabe si su primera petición llegó.
 */
export const DELETE = withErrorHandling(
  async (request: NextRequest, context: Params) => {
    const auth = await requireSession(request, 'device-token-revoke', RATE_LIMITS.write);
    const { id } = await context.params;

    const revoked = await prisma.deviceToken.updateMany({
      where: { id, userId: auth.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (revoked.count === 0) {
      // O no existe, o es de otro usuario, o ya estaba revocado. No se distingue
      // entre los tres casos: responder 404 sólo cuando nunca existió evitaría
      // confirmar que un id pertenece a otra cuenta.
      const exists = await prisma.deviceToken.findFirst({
        where: { id, userId: auth.user.id },
        select: { id: true },
      });
      if (!exists) {
        throw new ApiError(404, 'not_found', 'Ese dispositivo no existe.');
      }
    }

    return jsonOk({ ok: true, id });
  },
);
