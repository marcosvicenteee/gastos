import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonOk, unprocessable, withErrorHandling, notFound } from '@/lib/api';
import { readJson, requireAnyAuth } from '@/lib/server/route-helpers';
import { updateMerchantRuleSchema } from '@/lib/validation';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** `PATCH /api/merchant-rules/:id` */
export const PATCH = withErrorHandling(async (request: NextRequest, context: Params) => {
  const auth = await requireAnyAuth(request, 'merchant-rule-update', RATE_LIMITS.write);
  const { id } = await context.params;
  const input = await readJson(request, updateMerchantRuleSchema);

  if (input.categoryId !== undefined) {
    const category = await prisma.category.findFirst({
      where: { id: input.categoryId, userId: auth.user.id },
      select: { id: true },
    });
    if (!category) {
      throw unprocessable('La categoría indicada no existe o no es tuya.', {
        categoryId: 'Elige una categoría de la lista.',
      });
    }
  }

  const { count } = await prisma.merchantRule.updateMany({
    where: { id, userId: auth.user.id },
    data: {
      ...(input.pattern !== undefined ? { pattern: input.pattern } : {}),
      ...(input.matchType !== undefined ? { matchType: input.matchType } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
    },
  });
  if (count === 0) throw notFound('Esa regla no existe o no es tuya.');

  const rule = await prisma.merchantRule.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true, slug: true, color: true, icon: true } },
    },
  });
  return jsonOk({ rule });
});

/** `DELETE /api/merchant-rules/:id` */
export const DELETE = withErrorHandling(async (request: NextRequest, context: Params) => {
  const auth = await requireAnyAuth(request, 'merchant-rule-delete', RATE_LIMITS.write);
  const { id } = await context.params;

  const { count } = await prisma.merchantRule.deleteMany({
    where: { id, userId: auth.user.id },
  });
  if (count === 0) throw notFound('Esa regla no existe o no es tuya.');

  return jsonOk({ ok: true, id });
});
