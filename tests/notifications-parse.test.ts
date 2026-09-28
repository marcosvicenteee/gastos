import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchType } from '@prisma/client';
import {
  DEFAULT_NOTIFICATION_RULES,
  findAmountToken,
  findMerchant,
  joinNotification,
  parseNotification,
  type RuleLike,
} from '../src/lib/notifications/parse';

/**
 * Parser de notificaciones.
 *
 * Es la pieza que decide si un aviso de Revolut se convierte en gasto, se
 * descarta o se da por no entendido. Se comprueba con las reglas por defecto,
 * que son las que instala el registro: si estas fallan, la primera
 * notificación real del usuario falla igual.
 */

const DEFAULT_RULES: RuleLike[] = DEFAULT_NOTIFICATION_RULES.map((rule, index) => ({
  ...rule,
  id: `rule-${index}`,
}));

function run(body: string, rules: RuleLike[] = DEFAULT_RULES) {
  return parseNotification({ app: 'Revolut', body }, rules);
}

test('una notificación de pago se convierte en gasto con la regla', () => {
  const outcome = run('Pago de 12,50 € en Mercadona');
  assert.equal(outcome.kind, 'expense');
  if (outcome.kind !== 'expense') return;
  assert.equal(outcome.amount, '12,50');
  assert.equal(outcome.currency, 'EUR');
  assert.equal(outcome.merchant, 'Mercadona');
  assert.equal(outcome.extraction, 'rule');
  assert.equal(outcome.ruleName, 'Pago con tarjeta: "Pago de 12,50 € en Mercadona"');
});

test('un ingreso se descarta: no es un gasto', () => {
  const outcome = run('Has recibido 100,00 € de Ana');
  assert.equal(outcome.kind, 'not_an_expense');
  if (outcome.kind !== 'not_an_expense') return;
  assert.match(outcome.reason, /no es un gasto/);
});

test('un aviso de pago pendiente se descarta antes que el de gasto', () => {
  const outcome = run('Pago pendiente de 25,00 € en Tienda X');
  assert.equal(outcome.kind, 'not_an_expense');
});

test('un texto sin importe y sin regla se da por no entendido', () => {
  const outcome = run('Buenas tardes, ¿te apetece un café?');
  assert.equal(outcome.kind, 'unparsed');
});

test('una notificación vacía no genera error', () => {
  assert.equal(run('').kind, 'unparsed');
  assert.equal(joinNotification({ title: null, subtitle: null, body: null }), '');
});

test('sin reglas, el extractor genérico sigue entendiendo un pago', () => {
  const outcome = run('Pagaste 7,25 GBP en Tesco', []);
  assert.equal(outcome.kind, 'expense');
  if (outcome.kind !== 'expense') return;
  assert.equal(outcome.amount, '7,25');
  assert.equal(outcome.currency, 'GBP');
  assert.equal(outcome.merchant, 'Tesco');
  assert.equal(outcome.extraction, 'heuristic');
  assert.equal(outcome.ruleId, null);
});

test('una regla desactivada no se aplica', () => {
  const disabled = DEFAULT_RULES.map((rule) => ({ ...rule, isEnabled: false }));
  const outcome = run('Pago de 12,50 € en Mercadona', disabled);
  // Sin reglas activas manda el extractor genérico: sigue siendo un gasto,
  // pero ya no se atribuye a ninguna regla.
  assert.equal(outcome.kind, 'expense');
  if (outcome.kind !== 'expense') return;
  assert.equal(outcome.extraction, 'heuristic');
});

test('una regex rota no tumba el parser', () => {
  const broken: RuleLike = {
    id: 'broken',
    name: 'Rota',
    isEnabled: true,
    priority: 1,
    match: 'pago de (',
    matchType: MatchType.regex,
    amountGroup: 1,
    merchantGroup: 2,
    currencyGroup: 3,
    isExpense: true,
  };
  const outcome = run('Pago de 12,50 € en Mercadona', [broken, ...DEFAULT_RULES]);
  assert.equal(outcome.kind, 'expense');
});

test('findAmountToken prefiere el candidato con moneda explícita', () => {
  // "Hace 3 días" no es un importe: no lleva moneda ni decimales.
  assert.equal(findAmountToken('Tu pedido llegará en 3 días'), null);
  const token = findAmountToken('Gastaste 10 hoy y 4,50 € ayer');
  assert.ok(token?.includes('4,50'), `inesperado: ${token}`);
});

test('el símbolo de moneda no se cuela en el comercio', () => {
  const merchant = findMerchant('Pago de 12,50 € en Mercadona', '12,50 €');
  assert.equal(merchant, 'Mercadona');
  assert.ok(!/[€$£¥]/.test(merchant ?? ''), 'el símbolo de moneda se coló en el comercio');
});
