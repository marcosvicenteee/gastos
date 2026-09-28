import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/crypto';
import { createSession } from '@/lib/auth';
import { jsonCreated, withErrorHandling, conflict } from '@/lib/api';
import { assertSameOrigin } from '@/lib/csrf';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { readJson } from '@/lib/server/route-helpers';
import { registerSchema } from '@/lib/validation';
import { DEFAULT_CATEGORIES, FALLBACK_CATEGORY_SLUG } from '@/lib/categories';
import { DEFAULT_NOTIFICATION_RULES } from '@/lib/notifications/parse';
import { DEFAULT_TIMEZONE } from '@/lib/datetime';
import { SUGGESTED_RULES } from '@/lib/categorization';

export const runtime = 'nodejs';

/**
 * `POST /api/auth/register`
 *
 * Crea la cuenta y, en la misma operación, su catálogo inicial: categorías
 * predeterminadas, reglas de notificación de ejemplo y sugerencias de reglas
 * de comercio (creadas como desactivadas, para que la categorización
 * automática sea siempre una decisión consciente del usuario).
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  assertSameOrigin(request);
  enforceRateLimit(request, RATE_LIMITS.register, 'register');

  const input = await readJson(request, registerSchema);

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    // Se distingue el conflicto para dar un mensaje útil. Es la única
    // enumeración de cuentas que se permite y es inocua: el atacante necesita
    // además adivinar una contraseña válida.
    throw conflict('Ya existe una cuenta con ese correo.');
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.name,
        timezone: DEFAULT_TIMEZONE,
      },
      select: { id: true, email: true, name: true, currency: true, timezone: true, createdAt: true },
    });

    await tx.category.createMany({
      data: DEFAULT_CATEGORIES.map((category, index) => ({
        userId: created.id,
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        color: category.color,
        position: index,
      })),
    });

    // Categoría "Otros" a la que caen los gastos sin regla que coincida.
    const fallback = await tx.category.findFirst({
      where: { userId: created.id, slug: FALLBACK_CATEGORY_SLUG },
      select: { id: true },
    });

    await tx.notificationRule.createMany({
      data: DEFAULT_NOTIFICATION_RULES.map((rule) => ({
        userId: created.id,
        name: rule.name,
        isEnabled: rule.isEnabled,
        priority: rule.priority,
        match: rule.match,
        matchType: rule.matchType,
        amountGroup: rule.amountGroup,
        merchantGroup: rule.merchantGroup,
        currencyGroup: rule.currencyGroup,
        isExpense: rule.isExpense,
      })),
    });

    const categoryIds = new Map<string, string>();
    const allCategories = await tx.category.findMany({
      where: { userId: created.id },
      select: { id: true, slug: true },
    });
    for (const category of allCategories) {
      categoryIds.set(category.slug, category.id);
    }

    // Sugerencias desactivadas: el usuario las activa desde el panel.
    if (fallback) {
      const suggestions = SUGGESTED_RULES.filter((rule) => categoryIds.has(rule.categorySlug)).map(
        (rule, index) => ({
          userId: created.id,
          pattern: rule.pattern,
          matchType: rule.matchType,
          categoryId: categoryIds.get(rule.categorySlug)!,
          priority: 100 + index,
          isEnabled: false,
        }),
      );
      if (suggestions.length > 0) {
        await tx.merchantRule.createMany({ data: suggestions });
      }
    }

    return created;
  });

  await createSession(user.id);

  return jsonCreated({
    user: { ...user, isDemo: false },
  });
});
