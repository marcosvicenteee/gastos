import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonCreated, jsonOk, withErrorHandling, conflict } from '@/lib/api';
import { readJson, requireSession } from '@/lib/server/route-helpers';
import { createDeviceTokenSchema } from '@/lib/validation';
import { createDeviceToken, DEVICE_TOKEN_PREFIX } from '@/lib/auth';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** M\u00e1ximo de tokens activos por cuenta. Ver POST para el motivo. */
const MAX_ACTIVE_DEVICES = 10;

/**
 * `GET /api/device-tokens`
 *
 * Sólo devuelve la *pista* del token (`gk_a1b2c3…9x8y`), nunca el token
 * completo. El valor real sólo existe en el momento de crearlo: si se perdiera,
 * se revoca ese token y se crea otro. Sin esta regla, un volcado de la base de
 * datos daría acceso completo a la cuenta desde el Atajo.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireSession(request, 'device-tokens-list', RATE_LIMITS.read);
  const tokens = await prisma.deviceToken.findMany({
    where: { userId: auth.user.id, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      label: true,
      displayHint: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return jsonOk({
    tokens: tokens.map((token) => ({
      id: token.id,
      label: token.label,
      // Pista visual (`gk_a1b2c3…9x8y`), no el token. Basta para distinguir
      // "el iPhone" de "el iPad" sin exponer el secreto.
      hint: token.displayHint,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    })),
  });
});

/**
 * `POST /api/device-tokens`
 *
 * Devuelve el token **una única vez**. A partir de ahí sólo se puede ver su
 * prefijo. Es el mismo modelo que las claves de API de GitHub.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireSession(request, 'device-tokens-create', RATE_LIMITS.write);
  const { label } = await readJson(request, createDeviceTokenSchema);

  // Límite de Devices por cuenta: evita que un atacante que ya tenga sesión
  // validecrear cientos de tokens y olvide revocarlos.
  const active = await prisma.deviceToken.count({
    where: { userId: auth.user.id, revokedAt: null },
  });
  if (active >= MAX_ACTIVE_DEVICES) {
    throw conflict('Ya tienes el m\u00e1ximo de dispositivos activos. Revoca alguno antes de crear otro.');
  }

  const { token, displayHint } = await createDeviceToken(auth.user.id, label);

  return jsonCreated({
    token,
    tokenPrefix: DEVICE_TOKEN_PREFIX,
    hint: displayHint,
    warning:
      'Copia el token ahora: no se volverá a mostrar. Si lo pierdes, revoca el dispositivo y genera otro.',
  });
});
