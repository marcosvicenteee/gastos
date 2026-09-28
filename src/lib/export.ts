import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { formatDate, formatDateTime } from './datetime';
import { toNumber } from './money';

/**
 * Exportación de gastos en CSV, Excel y JSON.
 *
 * Todos los formatos parten del mismo conjunto de filas, de modo que un
 * filtro aplicado en la interfaz produce exactamente la misma selección en los
 * tres formatos.
 *
 * Consideraciones:
 *  · **CSV con BOM UTF-8**: sin él, Excel en Windows interpreta `Comida` y
 *    `ñ` mal. Con el BOM, el fichero se abre bien a doble clic.
 *  · **Separador `;`**: es lo que Excel espera por defecto en configuraciones
 *    regionales españolas, donde la coma es separador decimal.
 *  · **Importes como número, no como texto**: en la columna `Importe` se
 *    escribe un número real con formato de moneda, para que se pueda sumar.
 *  · **CSV con fórmulas**: los valores que empiezan por `=`, `+`, `-` o `@`
 *    se prefijan con apóstrofo. Sin eso, un comercio llamado
 *    `=IMPORTXML(...)` se ejecutaría al abrir el fichero. Es una inyección de
 *    fórmulas y se cierra aquí, no en el fichero descargado.
 */

export interface ExportRow {
  id: string;
  amount: Prisma.Decimal;
  currency: string;
  merchant: string | null;
  categoryName: string | null;
  description: string | null;
  source: string;
  paymentMethod: string | null;
  expenseDate: Date;
  sourceTimezone: string | null;
  receivedAt: Date | null;
  edited: boolean;
  createdAt: Date;
}

export interface ExportOptions {
  timezone: string;
  locale: string;
  currency: string;
}

/** Content-Type de cada formato, con el charset donde importa. */
export const MIME_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json; charset=utf-8',
} as const;

const CSV_HEADERS = [
  'ID',
  'Fecha',
  'Hora',
  'Importe',
  'Moneda',
  'Comercio',
  'Categoría',
  'Descripción',
  'Origen',
  'Método de pago',
  'Editado',
  'Zona horaria',
  'Recibido',
  'Registrado',
] as const;

const SOURCE_LABELS: Record<string, string> = {
  web: 'Web (manual)',
  shortcut: 'Atajo de iPhone',
  revolut: 'Notificación (Revolut)',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: 'Tarjeta',
  cash: 'Efectivo',
  transfer: 'Transferencia',
  other: 'Otro',
};

/** Escapa un valor para CSV, incluyendo la defensa frente a fórmulas. */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  let text = String(value);
  // Neutraliza fórmulas de hoja de cálculo.
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[";\n\r]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsv(rows: ExportRow[], options: ExportOptions): Buffer {
  const header = CSV_HEADERS.join(';');
  const lines = rows.map((row) => {
    const datePart = formatDate(row.expenseDate, options.timezone, options.locale);
    const full = formatDateTime(row.expenseDate, options.timezone, options.locale);
    // `formatDateTime` devuelve "dd/mm/aaaa · hh:mm"; se separa la hora.
    const timePart = full.split('·')[1]?.trim() ?? '';

    return [
      csvCell(row.id),
      csvCell(datePart),
      csvCell(timePart),
      csvCell(toNumber(row.amount).toFixed(2)),
      csvCell(row.currency),
      csvCell(row.merchant),
      csvCell(row.categoryName),
      csvCell(row.description),
      csvCell(SOURCE_LABELS[row.source] ?? row.source),
      csvCell(row.paymentMethod ? PAYMENT_METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod : null),
      csvCell(row.edited ? 'Sí' : 'No'),
      csvCell(row.sourceTimezone),
      csvCell(row.receivedAt ? formatDateTime(row.receivedAt, options.timezone, options.locale) : null),
      csvCell(formatDateTime(row.createdAt, options.timezone, options.locale)),
    ].join(';');
  });

  // BOM para que Excel en Windows detecte UTF-8.
  return Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from([header, ...lines].join('\r\n'), 'utf8'),
  ]);
}

export async function buildXlsx(
  rows: ExportRow[],
  options: ExportOptions,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gastos iPhone';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Gastos', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'ID', key: 'id', width: 26 },
    { header: 'Fecha', key: 'date', width: 13 },
    { header: 'Hora', key: 'time', width: 9 },
    { header: 'Importe', key: 'amount', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Moneda', key: 'currency', width: 9 },
    { header: 'Comercio', key: 'merchant', width: 26 },
    { header: 'Categoría', key: 'category', width: 18 },
    { header: 'Descripción', key: 'description', width: 32 },
    { header: 'Origen', key: 'source', width: 22 },
    { header: 'Método de pago', key: 'paymentMethod', width: 16 },
    { header: 'Editado', key: 'edited', width: 9 },
    { header: 'Zona horaria', key: 'timezone', width: 16 },
    { header: 'Recibido', key: 'receivedAt', width: 20 },
    { header: 'Registrado', key: 'createdAt', width: 20 },
  ];

  for (const row of rows) {
    const full = formatDateTime(row.expenseDate, options.timezone, options.locale);
    const [datePart, timePart] = full.split('·').map((part) => part.trim());

    sheet.addRow({
      id: row.id,
      date: datePart,
      time: timePart,
      // Se escribe el Decimal como número: así Excel lo puede sumar.
      amount: Number(row.amount),
      currency: row.currency,
      merchant: row.merchant,
      category: row.categoryName,
      description: row.description,
      source: SOURCE_LABELS[row.source] ?? row.source,
      paymentMethod: row.paymentMethod
        ? PAYMENT_METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod
        : null,
      edited: row.edited ? 'Sí' : 'No',
      timezone: row.sourceTimezone,
      receivedAt: row.receivedAt
        ? formatDateTime(row.receivedAt, options.timezone, options.locale)
        : null,
      createdAt: formatDateTime(row.createdAt, options.timezone, options.locale),
    });
  }

  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columnCount } };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function buildJson(rows: ExportRow[], options: ExportOptions): Buffer {
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    timezone: options.timezone,
    count: rows.length,
    expenses: rows.map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      currency: row.currency,
      merchant: row.merchant,
      category: row.categoryName,
      description: row.description,
      source: row.source,
      paymentMethod: row.paymentMethod,
      expenseDate: row.expenseDate.toISOString(),
      expenseDateLocal: formatDateTime(row.expenseDate, options.timezone, options.locale),
      sourceTimezone: row.sourceTimezone,
      receivedAt: row.receivedAt?.toISOString() ?? null,
      edited: row.edited,
      createdAt: row.createdAt.toISOString(),
    })),
  };
  return Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
}
