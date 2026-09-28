import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonOk, withErrorHandling } from '@/lib/api';
import { readJson, requireAnyAuth } from '@/lib/server/route-helpers';
import { testNotificationSchema } from '@/lib/validation';
import { joinNotification, parseNotification, toRuleLike } from '@/lib/notifications/parse';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/notification-rules/test`
 *
 * Probador de texto: se pega una notificación tal cual llega del iPhone y se
 * ve exactamente qué regla casaría y qué se registraría.
 *
 * Es la pieza que hace manejable el problema de fondo. El texto de Revolut no es
 * un contrato estable: cambia con la versión de la app, con el idioma y a
 * veces por experimentación del propio banco. Sin un probador, el usuario
 * tendría que adivinar expresiones regulares a ciegas.
 *
 * No escribe nada: es una simulación.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAnyAuth(request, 'notification-rules-test', RATE_LIMITS.read);
  const payload = await readJson(request, testNotificationSchema);

  const notification = {
    app: payload.app,
    title: payload.title,
    subtitle: payload.subtitle,
    body: payload.body,
  };
  const text = joinNotification(notification);

  if (text === '') {
    return jsonOk({
      text: '',
      outcome: { kind: 'unparsed', reason: 'No se ha enviado ningún texto.' },
    });
  }

  const rules = await prisma.notificationRule.findMany({
    where: { userId: auth.user.id },
    orderBy: { priority: 'asc' },
  });

  // Se prueban todas las reglas, no sólo las activas: así el probador puede
  // decir "esta regla casaría pero está desactivada", que es justo lo que un
  // usuario con un problema necesita ver.
  const active = rules.filter((rule) => rule.isEnabled).map(toRuleLike);
  const outcome = parseNotification(notification, active);

  // Segunda pasada con todas las reglas, sólo para el diagnóstico.
  const withAll = parseNotification(notification, rules.map(toRuleLike));
  const wouldMatchDisabled = withAll.kind !== outcome.kind;

  return jsonOk({
    text,
    outcome,
    diagnostics: {
      ruleCount: rules.length,
      activeRuleCount: active.length,
      wouldMatchDifferentRule: wouldMatchDisabled,
      rulesEvaluated: rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        isEnabled: rule.isEnabled,
        priority: rule.priority,
        matchType: rule.matchType,
        match: rule.match,
        amountGroup: rule.amountGroup,
        merchantGroup: rule.merchantGroup,
        currencyGroup: rule.currencyGroup,
        isExpense: rule.isExpense,
      })),
    },
  });
});
