import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonOk, unprocessable, withErrorHandling, notFound } from '@/lib/api';
import { readJson, requireAnyAuth } from '@/lib/server/route-helpers';
import { updateNotificationRuleSchema } from '@/lib/validation';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** `PATCH /api/notification-rules/:id` */
export const PATCH = withErrorHandling(async (request: NextRequest, context: Params) => {
  const auth = await requireAnyAuth(request, 'notification-rule-update', RATE_LIMITS.write);
  const { id } = await context.params;
  const input = await readJson(request, updateNotificationRuleSchema);

  if (input.matchType === 'regex' || (input.match !== undefined && input.matchType === undefined)) {
    const pattern = input.match;
    if (pattern !== undefined) {
      try {
        new RegExp(pattern, 'i');
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'expresión no válida';
        throw unprocessable(`La expresión regular no es válida: ${detail}`, { match: detail });
      }
    }
  }

  const { count } = await prisma.notificationRule.updateMany({
    where: { id, userId: auth.user.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.match !== undefined ? { match: input.match } : {}),
      ...(input.matchType !== undefined ? { matchType: input.matchType } : {}),
      ...(input.amountGroup !== undefined ? { amountGroup: input.amountGroup } : {}),
      ...(input.merchantGroup !== undefined ? { merchantGroup: input.merchantGroup } : {}),
      ...(input.currencyGroup !== undefined ? { currencyGroup: input.currencyGroup } : {}),
      ...(input.isExpense !== undefined ? { isExpense: input.isExpense } : {}),
      ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
  if (count === 0) throw notFound('Esa regla no existe o no es tuya.');

  const rule = await prisma.notificationRule.findUnique({ where: { id } });
  return jsonOk({ rule });
});

/** `DELETE /api/notification-rules/:id` */
export const DELETE = withErrorHandling(async (request: NextRequest, context: Params) => {
  const auth = await requireAnyAuth(request, 'notification-rule-delete', RATE_LIMITS.write);
  const { id } = await context.params;

  // `deleteMany` con el `userId` en el filtro: si sólo se borrara por id, otro
  // usuario podría eliminar reglas ajenas sabiendo sus ids (cuid, adivinables
  // sólo en teoría, pero la defence no cuesta nada).
  const { count } = await prisma.notificationRule.deleteMany({
    where: { id, userId: auth.user.id },
  });
  if (count === 0) throw notFound('Esa regla no existe o no es tuya.');

  return jsonOk({ ok: true, id });
});
