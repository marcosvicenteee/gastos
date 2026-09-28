import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/crypto';
import { createSession } from '@/lib/auth';
import { jsonOk, withErrorHandling, unauthorized } from '@/lib/api';
import { assertSameOrigin } from '@/lib/csrf';
import { enforceRateLimit, clientKey, RATE_LIMITS } from '@/lib/rate-limit';
import { readJson } from '@/lib/server/route-helpers';
import { loginSchema } from '@/lib/validation';

export const runtime = 'nodejs';

/**
 * `POST /api/auth/login`
 *
 * Dos capas de límite: una por IP y otra por correo. La segunda es la que de
 * verdad protege la contraseña, porque un atacante puede rotar direcciones
 * pero no puede probar millones de correos distintos.
 *
 * El mensaje de error es idéntico tanto si el correo no existe como si la
 * contraseña falla, para no permitir enumerar cuentas. El coste es el mismo en
 * ambos casos porque se ejecuta igualmente la derivación scrypt.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  assertSameOrigin(request);
  enforceRateLimit(request, RATE_LIMITS.login, 'login-ip', clientKey(request));

  const input = await readJson(request, loginSchema);
  enforceRateLimit(request, RATE_LIMITS.login, 'login-email', input.email);

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, passwordHash: true, email: true, name: true, currency: true, timezone: true, isDemo: true, createdAt: true },
  });

  // Se deriva igualmente sin usuario encontrado, con un hash señuelo, para que
  // el tiempo de respuesta no delate si la cuenta existe.
  const storedHash =
    user?.passwordHash ??
    'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
  const valid = await verifyPassword(input.password, storedHash);

  if (!user || !valid) {
    throw unauthorized('Correo o contraseña incorrectos.');
  }

  await createSession(user.id);

  return jsonOk({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      currency: user.currency,
      timezone: user.timezone,
      isDemo: user.isDemo,
      createdAt: user.createdAt,
    },
  });
});
