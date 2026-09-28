import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { parseAmount, toNumber, formatMoney, AmountError } from '../src/lib/money';

/**
 * Importes.
 *
 * La regla del proyecto es que el dinero viaje como `Decimal`, y aquí se
 * comprueba justo eso: no sólo que "12,50" se entienda, sino que la suma de
 * formatos europeos e ingleses no produzca números redondeados por el camino.
 */

test('acepta coma y punto decimal', () => {
  assert.equal(parseAmount('12,50').toNumber(), 12.5);
  assert.equal(parseAmount('12.50').toNumber(), 12.5);
  assert.equal(parseAmount('1250').toNumber(), 1250);
});

test('interpreta separadores de millares en las dos convenciones', () => {
  assert.equal(parseAmount('1.250,00').toNumber(), 1250);
  assert.equal(parseAmount('1,250.00').toNumber(), 1250);
  // Un solo separador con tres dígitos detrás es de millares, no decimal.
  assert.equal(parseAmount('1.250').toNumber(), 1250);
});

test('quita el símbolo de moneda pegado', () => {
  assert.equal(parseAmount('12,50 €').toNumber(), 12.5);
  assert.equal(parseAmount('12,50€').toNumber(), 12.5);
  assert.equal(parseAmount('8,99 $').toNumber(), 8.99);
});

test('redondea mitad hacia arriba y no con el redondeo bancario', () => {
  // 1.005 → 1.01, no 1.00: es el fallo clásico de `Math.round`/`toFixed`.
  assert.equal(toNumber(new Prisma.Decimal('1.005')), 1.01);
  assert.equal(parseAmount(new Prisma.Decimal('1.005')).toNumber(), 1.01);
});

test('rechaza entradas inválidas en vez de adivinar', () => {
  assert.throws(() => parseAmount(''), AmountError);
  assert.throws(() => parseAmount('mucho'), AmountError);
  assert.throws(() => parseAmount('abc'), AmountError);
  assert.throws(() => parseAmount('12,50 € al día'), AmountError);
});

test('rechaza importes no positivos y fuera de rango', () => {
  assert.throws(() => parseAmount('0'), AmountError);
  assert.throws(() => parseAmount('-5,00'), AmountError);
  assert.throws(() => parseAmount('99999999999999'), AmountError);
});

test('tocaNumber conserva dos decimales', () => {
  assert.equal(toNumber(new Prisma.Decimal('3')), 3);
  assert.equal(toNumber(new Prisma.Decimal('3.1')), 3.1);
  assert.equal(toNumber('7,5'.replace(',', '.')), 7.5);
});

test('formatMoney usa el locale y muestra siempre los céntimos', () => {
  const euros = formatMoney(12.5, 'EUR', 'es-ES');
  // El espacio antes del símbolo es no separable y varía según la versión de
  // ICU, así que se comprueba el contenido, no los bytes exactos.
  assert.match(euros, /12,50/);
  assert.ok(euros.trim().endsWith('€'), `inesperado: ${euros}`);
  assert.match(formatMoney(4, 'EUR', 'es-ES'), /4,00/);
  assert.equal(formatMoney(12.5, 'USD', 'en-US'), '$12.50');
});
