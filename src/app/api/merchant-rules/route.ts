import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonCreated, jsonOk, unprocessable, withErrorHandling } from '@/lib/api';
import { readJson, requireAnyAuth } from '@/lib/server/route-helpers';
import { createMerchantRuleSchema } from '@/lib/validation';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reglas de comercio: el motor que decide la categoría de un gasto.
 *
 * Se evalúan por `priority` ascendente y gana la primera que casa, así que una
 * regla específica ("Mercadona Bar") puede ir por delante de una genérica
 * ("Mercadona") sin ningún campo extra.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAnyAuth(request, 'merchant-rules-list', RATE_LIMITS.read);
  const rules = await prisma.merchantRule.findMany({
    where: { userId: auth.user.id },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    include: {
      category: { select: { id: true, name: true, slug: true, color: true, icon: true } },
    },
  });
  return jsonOk({ rules });
});

/**
 * `POST /api/merchant-rules`
 *
 * Se comprueba que la categoría exista y sea del usuario antes de crear la
 * regla: una regla apuntando a una categoría ajena no debe poder existir.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAnyAuth(request, 'merchant-rules-create', RATE_LIMITS.write);
  const input = await readJson(request, createMerchantRuleSchema);

  const category = await prisma.category.findFirst({
    where: { id: input.categoryId, userId: auth.user.id },
    select: { id: true },
  });
  if (!category) {
    throw unprocessable('La categoría indicada no existe o no es tuya.', {
      categoryId: 'Elige una categoría de la lista.',
    });
  }

  const maxPriority = await prisma.merchantRule.aggregate({
    where: { userId: auth.user.id },
    _max: { priority: true },
  });

  const rule = await prisma.merchantRule.create({
    data: {
      userId: auth.user.id,
      pattern: input.pattern,
      matchType: input.matchType,
      categoryId: input.categoryId,
      isEnabled: input.isEnabled ?? true,
      priority: input.priority ?? (maxPriority._max.priority ?? 0) + 1,
    },
    include: {
      category: { select: { id: true, name: true, slug: true, color: true, icon: true } },
    },
  });

  return jsonCreated({ rule });
});
