import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonOk, withErrorHandling } from '@/lib/api';
import { readJson, requireSession } from '@/lib/server/route-helpers';
import { updateProfileSchema } from '@/lib/validation';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `GET /api/profile` */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireSession(request, 'profile-read', RATE_LIMITS.read);
  return jsonOk({ user: auth.user });
});

/**
 * `PATCH /api/profile`
 *
 * Cambiar la zona horaria o la moneda no reescribe los gastos ya guardados:
 * sólo afecta a cómo se presentan a partir de ahora. Reescribir el histórico
 * sería destructivo y además imposible: un gasto registrado en Madrid no es
 * necesariamente el mismo instante que uno registrado en Tokio.
 */
export const PATCH = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireSession(request, 'profile-update', RATE_LIMITS.write);
  const input = await readJson(request, updateProfileSchema);

  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      currency: true,
      timezone: true,
      isDemo: true,
      createdAt: true,
    },
  });

  return jsonOk({
    user: { ...user, createdAt: user.createdAt.toISOString() },
    note: 'Los gastos ya registrados no se han reasignado de zona horaria.',
  });
});
