import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExpenseSchema,
  expenseFilterSchema,
  exportQuerySchema,
  loginSchema,
  registerSchema,
  updateExpenseSchema,
} from '../src/lib/validation';
import { parseAmount, AmountError } from '../src/lib/money';

/**
 * Validación de entrada.
 *
 * Cada endpoint pasa por aquí antes de tocar la base de datos, así que estas
 * pruebas son la primera línea de defensa: si un caso aquí se cuela, se cuela
 * también en producción.
 */

test('acepta un gasto válido con coma decimal', () => {
  const parsed = createExpenseSchema.safeParse({
    amount: '12,50',
    merchant: 'Mercadona',
    source: 'web',
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.source, 'web');
});

test('el importe vacío o ausente se rechaza en validación', () => {
  assert.equal(createExpenseSchema.safeParse({ amount: '' }).success, false);
  assert.equal(createExpenseSchema.safeParse({ merchant: 'Sin importe' }).success, false);
});

test('la forma numérica no se valida aquí, se valida al interpretar', () => {
  // La capa de entrada sólo comprueba la forma: el texto lo tradice `money.ts`
  // (probado en tests/money.test.ts). Un texto no numérico por tanto pasa esta
  // barrera y debe rechazarse en el servicio, nunca convertirse en 0.
  assert.equal(createExpenseSchema.safeParse({ amount: 'mucho' }).success, true);
  assert.throws(() => parseAmount('mucho'), AmountError);
});

test('rechaza métodos de pago y orígenes inventados', () => {
  assert.equal(
    createExpenseSchema.safeParse({ amount: '1,00', paymentMethod: 'paypal' }).success,
    false,
  );
  assert.equal(createExpenseSchema.safeParse({ amount: '1,00', source: 'banco' }).success, false);
});

test('admite método de pago desconocido como nulo, no como "tarjeta"', () => {
  const parsed = createExpenseSchema.safeParse({ amount: '1,00', paymentMethod: null });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.paymentMethod, null);
});

test('la edición exige al menos un campo', () => {
  assert.equal(updateExpenseSchema.safeParse({}).success, false);
  assert.equal(updateExpenseSchema.safeParse({ merchant: 'Otro nombre' }).success, true);
});

test('los filtros rechazan meses y orígenes inválidos', () => {
  assert.equal(expenseFilterSchema.safeParse({ month: '2026-13' }).success, false);
  assert.equal(expenseFilterSchema.safeParse({ month: '2026-09' }).success, true);
  assert.equal(expenseFilterSchema.safeParse({ source: 'inventado' }).success, false);
  assert.equal(expenseFilterSchema.safeParse({ source: 'web,revolut' }).success, true);
});

test('los importes de filtro se convierten a número', () => {
  const parsed = expenseFilterSchema.safeParse({ minAmount: '12,50' });
  // Zod usa `Number()`, que no entiende la coma: por eso la interfaz la
  // sustituye por punto antes de montar la query.
  assert.equal(parsed.success, false);
  const ok = expenseFilterSchema.safeParse({ minAmount: '12.50' });
  assert.equal(ok.success, true);
  if (ok.success) assert.equal(ok.data.minAmount, 12.5);
});

test('la exportación sólo admite los tres formatos', () => {
  assert.equal(exportQuerySchema.safeParse({ format: 'pdf' }).success, false);
  assert.equal(exportQuerySchema.safeParse({ format: 'json' }).success, true);
  assert.equal(exportQuerySchema.safeParse({}).success, true);
  if (exportQuerySchema.safeParse({}).success) {
    const parsed = exportQuerySchema.parse({});
    assert.equal(parsed.format, 'csv');
  }
});

test('el registro exige contraseña larga y correo válido', () => {
  assert.equal(registerSchema.safeParse({ email: 'a@b.com', password: 'corta' }).success, false);
  assert.equal(registerSchema.safeParse({ email: 'no-es-correo', password: '2026Segura!' }).success, false);
  assert.equal(registerSchema.safeParse({ email: 'a@b.com', password: '2026Segura!' }).success, true);
});

test('el login no filtra si la contraseña es incorrecta, sólo valida el formato', () => {
  assert.equal(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success, false);
  assert.equal(loginSchema.safeParse({ email: 'a@b.com', password: 'x' }).success, true);
});
