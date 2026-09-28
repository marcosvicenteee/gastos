import { MatchType, type MerchantRule, type Category } from '@prisma/client';

/**
 * Motor de categorización por reglas de comercio.
 *
 * Se evaluan ordenadas por `priority` ascendente y gana la primera que
 * coincide, de forma que una regla específica ("Mercadona Bar") puede ir por
 * delante de una genérica ("Mercadona") sin campos adicionales.
 *
 * Si nada coincide se devuelve `null` y quien llama usa la categoría "Otros".
 * Nunca se inventa una categoría: si el usuario no ha configurado reglas, el
 * gasto se queda en "Otros" y se puede cambiar a mano.
 */

export interface RuleWithCategory extends MerchantRule {
  category: Pick<Category, 'id' | 'name' | 'slug' | 'color' | 'icon'>;
}

/** Normaliza un texto para comparar: minúsculas y sin espacios extra. */
export function normaliseText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Devuelve la categoría de la primera regla que coincide con el comercio, o
 * `null`. Una regex inválida no rompe el flujo: se salta la regla.
 */
export function resolveCategoryFromRules(
  merchant: string | null | undefined,
  rules: RuleWithCategory[],
): { categoryId: string; categoryName: string; ruleId: string } | null {
  if (!merchant || merchant.trim() === '') return null;

  const needle = normaliseText(merchant);
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of ordered) {
    if (!rule.isEnabled) continue;

    if (rule.matchType === MatchType.exact) {
      if (needle === normaliseText(rule.pattern)) {
        return {
          categoryId: rule.categoryId,
          categoryName: rule.category.name,
          ruleId: rule.id,
        };
      }
      continue;
    }

    if (rule.matchType === MatchType.regex) {
      try {
        // Sin banderas globales: `lastIndex` haría que el resultado dependiera
        // del orden de ejecución.
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(merchant)) {
          return {
            categoryId: rule.categoryId,
            categoryName: rule.category.name,
            ruleId: rule.id,
          };
        }
      } catch {
        continue;
      }
      continue;
    }

    if (needle.includes(normaliseText(rule.pattern))) {
      return {
        categoryId: rule.categoryId,
        categoryName: rule.category.name,
        ruleId: rule.id,
      };
    }
  }

  return null;
}

/**
 * Reglas de ejemplo que se ofrecen al usuario. No se aplican solas: se crean
 * desde el panel, para que la categorización automática sea una decisión
 * explícita y no una sorpresa.
 */
export interface SuggestedRule {
  pattern: string;
  matchType: MatchType;
  categorySlug: string;
  note: string;
}

export const SUGGESTED_RULES: SuggestedRule[] = [
  { pattern: 'Mercadona', matchType: MatchType.contains, categorySlug: 'supermercado', note: 'Supermercado' },
  { pattern: 'Carrefour', matchType: MatchType.contains, categorySlug: 'supermercado', note: 'Supermercado' },
  { pattern: 'Lidl', matchType: MatchType.contains, categorySlug: 'supermercado', note: 'Supermercado' },
  { pattern: 'Aldi', matchType: MatchType.contains, categorySlug: 'supermercado', note: 'Supermercado' },
  { pattern: 'DIA', matchType: MatchType.contains, categorySlug: 'supermercado', note: 'Supermercado' },
  { pattern: 'McDonald', matchType: MatchType.contains, categorySlug: 'comida', note: 'Comida' },
  { pattern: "Burger King", matchType: MatchType.contains, categorySlug: 'comida', note: 'Comida' },
  { pattern: 'Uber', matchType: MatchType.contains, categorySlug: 'transporte', note: 'Transporte' },
  { pattern: 'Cabify', matchType: MatchType.contains, categorySlug: 'transporte', note: 'Transporte' },
  { pattern: 'Renfe', matchType: MatchType.contains, categorySlug: 'transporte', note: 'Transporte' },
  { pattern: 'Netflix', matchType: MatchType.contains, categorySlug: 'suscripciones', note: 'Suscripciones' },
  { pattern: 'Spotify', matchType: MatchType.contains, categorySlug: 'suscripciones', note: 'Suscripciones' },
  { pattern: 'Amazon', matchType: MatchType.contains, categorySlug: 'compras', note: 'Compras' },
  { pattern: 'Zara', matchType: MatchType.contains, categorySlug: 'ropa', note: 'Ropa' },
  { pattern: 'H&M', matchType: MatchType.contains, categorySlug: 'ropa', note: 'Ropa' },
  { pattern: 'Apple', matchType: MatchType.contains, categorySlug: 'tecnologia', note: 'Tecnología' },
  { pattern: 'Ikea', matchType: MatchType.contains, categorySlug: 'casa', note: 'Casa' },
];
