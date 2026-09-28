import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchType, type MerchantRule } from '@prisma/client';
import {
  normaliseText,
  resolveCategoryFromRules,
  type RuleWithCategory,
} from '../src/lib/categorization';

/**
 * Motor de categorización por reglas de comercio.
 */

const CATEGORY = { id: 'cat-1', name: 'Supermercado', slug: 'supermercado', color: '#22C55E', icon: 'ShoppingCart' };
const OTHERS = { id: 'cat-2', name: 'Otros', slug: 'otros', color: '#64748B', icon: 'Wallet' };

function rule(overrides: Partial<MerchantRule> & { pattern: string }): RuleWithCategory {
  return {
    id: overrides.id ?? `rule-${overrides.pattern}`,
    userId: 'user-1',
    matchType: overrides.matchType ?? MatchType.contains,
    categoryId: overrides.categoryId ?? CATEGORY.id,
    priority: overrides.priority ?? 100,
    isEnabled: overrides.isEnabled ?? true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    category: overrides.categoryId === OTHERS.id ? OTHERS : CATEGORY,
    pattern: overrides.pattern,
  } as RuleWithCategory;
}

test('normaliseText quita tildes y minúsculas', () => {
  assert.equal(normaliseText('  Café   del Ángel '), 'cafe del angel');
  assert.equal(normaliseText('MERCADONA'), 'mercadona');
});

test('una regla contains casa con acentos y mayúsculas distintas', () => {
  const found = resolveCategoryFromRules('Panadería LA ESPIGA', [rule({ pattern: 'la espiga' })]);
  assert.equal(found?.categoryId, CATEGORY.id);
  assert.equal(found?.categoryName, 'Supermercado');
});

test('una regla exact no casa con un texto que sólo contiene el patrón', () => {
  const exact = rule({ pattern: 'Mercadona', matchType: MatchType.exact });
  assert.ok(resolveCategoryFromRules('Mercadona', [exact]));
  assert.equal(resolveCategoryFromRules('Mercadona Centro', [exact]), null);
});

test('gana la regla de menor prioridad, no la primera de la lista', () => {
  const generic = rule({ pattern: 'Mercadona', priority: 200 });
  const specific = rule({ pattern: 'Mercadona Bar', priority: 10 });
  const found = resolveCategoryFromRules('Mercadona Bar Centro', [generic, specific]);
  assert.equal(found?.ruleId, specific.id);
});

test('las reglas desactivadas se ignoran', () => {
  const disabled = rule({ pattern: 'Mercadona', isEnabled: false });
  assert.equal(resolveCategoryFromRules('Mercadona', [disabled]), null);
});

test('una regex inválida se salta sin tumbar el proceso', () => {
  const broken = rule({ pattern: '[unclosed', matchType: MatchType.regex, priority: 1 });
  const valid = rule({ pattern: 'Mercadona', priority: 2 });
  const found = resolveCategoryFromRules('Mercadona', [broken, valid]);
  assert.equal(found?.ruleId, valid.id);
});

test('sin coincidencias devuelve null (nunca inventa categoría)', () => {
  assert.equal(resolveCategoryFromRules('Sitio sin regla', [rule({ pattern: 'Mercadona' })]), null);
  assert.equal(resolveCategoryFromRules('', [rule({ pattern: 'Mercadona' })]), null);
  assert.equal(resolveCategoryFromRules(null, [rule({ pattern: 'Mercadona' })]), null);
  assert.equal(resolveCategoryFromRules('Mercadona', []), null);
});
