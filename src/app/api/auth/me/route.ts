import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonOk, withErrorHandling, unauthorized } from '@/lib/api';
import { readBearerToken, authenticateDeviceToken } from '@/lib/auth';
import { requireAnyAuth } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

/**
 * `GET /api/auth/me`
 *
 * Acepta cookie de sesión o token de dispositivo, para que el propio Atajo
 * pueda comprobar si su token sigue siendo válido sin abrir la web.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const context = await requireAnyAuth(request, 'auth-me');
  return jsonOk({ user: context.user, via: context.via });
});

/**
 * `POST /api/auth/verify-device-token`
 *
 * Comprobación ligera para el Atajo: responde 200 si el token es válido y 401
 * si no. Sin cuerpo, para que sea barato.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const token = readBearerToken(request);
  if (!token) throw unauthorized('Falta el token del dispositivo.');

  const principal = await authenticateDeviceToken(token);
  if (!principal) throw unauthorized('Token no válido o revocado.');

  const count = await prisma.expense.count({ where: { userId: principal.user.id } });
  return jsonOk({ ok: true, deviceTokenId: principal.tokenId, expenses: count });
});
