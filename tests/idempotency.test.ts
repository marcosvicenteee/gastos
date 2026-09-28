import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { computeIdempotencyKey, DUPLICATE_WINDOW_MINUTES } from '../src/lib/idempotency';

/**
 * Idempotencia.
 *
 * Sin esto, un Atajo que reintenta en la cola offline o una notificación
 * reenviada por iOS crea gastos repetidos, que es el fallo que más rápido
 * destruye la confianza en una app de gastos.
 */

const AMOUNT = new Prisma.Decimal('12.50');
const DATE = new Date('2026-09-28T10:15:00.000Z');

const base = {
  userId: 'user-1',
  source: 'revolut' as const,
  amount: AMOUNT,
  currency: 'EUR',
  merchant: 'Mercadona',
  expenseDate: DATE,
};

test('una notificación de Revolut usa hash de contenido', () => {
  const first = computeIdempotencyKey(base);
  const second = computeIdempotencyKey({ ...base });
  assert.equal(first.strategy, 'content_hash');
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.ok(first.idempotencyKey.startsWith('h:'));
});

test('el mismo pago en otro minuto no es el mismo evento', () => {
  const first = computeIdempotencyKey(base);
  const otherMinute = computeIdempotencyKey({
    ...base,
    expenseDate: new Date('2026-09-28T10:16:00.000Z'),
  });
  assert.notEqual(first.idempotencyKey, otherMinute.idempotencyKey);
});

test('cambia el comercio o el importe y cambia la clave', () => {
  const original = computeIdempotencyKey(base);
  assert.notEqual(
    original.idempotencyKey,
    computeIdempotencyKey({ ...base, merchant: 'Lidl' }).idempotencyKey,
  );
  assert.notEqual(
    original.idempotencyKey,
    computeIdempotencyKey({ ...base, amount: new Prisma.Decimal('12.51') }).idempotencyKey,
  );
  assert.notEqual(
    original.idempotencyKey,
    computeIdempotencyKey({ ...base, userId: 'user-2' }).idempotencyKey,
  );
});

test('la normalización del comercio evita falsos negativos', () => {
  const plain = computeIdempotencyKey(base);
  const accented = computeIdempotencyKey({ ...base, merchant: '  MERCADONA ' });
  const withoutAccents = computeIdempotencyKey({ ...base, merchant: 'Mercadona' });
  assert.equal(plain.idempotencyKey, accented.idempotencyKey);
  assert.equal(plain.idempotencyKey, withoutAccents.idempotencyKey);
});

test('un identificador de transacción del proveedor gana al hash', () => {
  const result = computeIdempotencyKey({ ...base, sourceTransactionId: 'tx-123' });
  assert.equal(result.strategy, 'source_transaction_id');
  assert.equal(result.idempotencyKey, 'st:tx-123');
});

test('el Atajo prioriza el client_token para reintentos', () => {
  const token = '11111111-2222-4333-8444-555555555555';
  const result = computeIdempotencyKey({ ...base, source: 'shortcut', clientToken: token });
  assert.equal(result.strategy, 'client_token');
  assert.equal(result.idempotencyKey, `ct:${token}`);
});

test('un Atajo sin client_token cae en el hash de contenido', () => {
  const result = computeIdempotencyKey({ ...base, source: 'shortcut' });
  assert.equal(result.strategy, 'content_hash');
});

test('los gastos de la web nunca se deduplican', () => {
  const first = computeIdempotencyKey({ ...base, source: 'web' });
  const second = computeIdempotencyKey({ ...base, source: 'web' });
  assert.equal(first.strategy, 'none');
  assert.equal(second.strategy, 'none');
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
  assert.ok(first.idempotencyKey.startsWith('web:'));
});

test('la ventana de proximidad es la esperada', () => {
  assert.equal(DUPLICATE_WINDOW_MINUTES, 3);
});
