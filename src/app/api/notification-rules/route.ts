import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonCreated, jsonOk, unprocessable, withErrorHandling } from '@/lib/api';
import { readJson, requireAnyAuth } from '@/lib/server/route-helpers';
import { createNotificationRuleSchema } from '@/lib/validation';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reglas de notificación: el motor que interpreta el texto que llega de Revolut.
 *
 * Sólo se guardan aquí las reglas **del usuario**. Las genéricas viven en
 * `notifications/parse.ts` como `DEFAULT_NOTIFICATION_RULES` y se crean
 * desactivadas en el registro; así una regla mal ajustada nunca puede romper la
 * ingesta de otra cuenta.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAnyAuth(request, 'notification-rules-list', RATE_LIMITS.read);
  const rules = await prisma.notificationRule.findMany({
    where: { userId: auth.user.id },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
  return jsonOk({ rules });
});

/**
 * `POST /api/notification-rules`
 *
 * Al crear una regla se valida que la expresión regular compile. Sin esta
 * comprobación, una regla con un `(` sin cerrar se guardaría y la ingesta la
 * saltaría en silencio: el usuario creería que tiene una regla y no tendría
 * ninguna.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAnyAuth(request, 'notification-rules-create', RATE_LIMITS.write);
  const input = await readJson(request, createNotificationRuleSchema);

  if (input.matchType === 'regex') {
    try {
      new RegExp(input.match, 'i');
    } catch (error) {
      // 422 y no 500: es un error de los datos, no del servidor.
      const detail = error instanceof Error ? error.message : 'expresión no válida';
      throw unprocessable(`La expresión regular no es válida: ${detail}`, { match: detail });
    }
  }

  const maxPriority = await prisma.notificationRule.aggregate({
    where: { userId: auth.user.id },
    _max: { priority: true },
  });

  const rule = await prisma.notificationRule.create({
    data: {
      userId: auth.user.id,
      name: input.name,
      match: input.match,
      matchType: input.matchType,
      amountGroup: input.amountGroup ?? null,
      merchantGroup: input.merchantGroup ?? null,
      currencyGroup: input.currencyGroup ?? null,
      isExpense: input.isExpense,
      isEnabled: input.isEnabled ?? true,
      notes: input.notes,
      priority: input.priority ?? (maxPriority._max.priority ?? 0) + 1,
    },
  });

  return jsonCreated({ rule });
});
