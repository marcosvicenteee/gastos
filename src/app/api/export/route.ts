import type { NextRequest } from 'next/server';
import { withErrorHandling } from '@/lib/api';
import { parseQuery, requireSession, timestampedFilename } from '@/lib/server/route-helpers';
import { exportQuerySchema, type ExpenseFilterInput } from '@/lib/validation';
import { buildCsv, buildJson, buildXlsx, MIME_TYPES } from '@/lib/export';
import { listExpenses } from '@/lib/services/expenses';
import { toExportRow } from '@/lib/serialise';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/export?format=csv&month=2026-09`
 *
 * Acepta los mismos filtros que la lista, de modo que lo que se ve en pantalla
 * es exactamente lo que se descarga. La paginación se ignora a propósito: una
 * exportación parcial surprisearía al usuario, y el rango máximo acotado por
 * `MAX_EXPORT_ROWS` protege la memoria.
 */
const MAX_EXPORT_ROWS = 10_000;

export const GET = withErrorHandling(async (request: NextRequest) => {
  // La exportación sólo por cookie: es una descarga del navegador, no una
  // operación que vaya a hacer un Atajo.
  const auth = await requireSession(request, 'export', RATE_LIMITS.export);
  const query = parseQuery(exportQuerySchema, request);

  const filters: ExpenseFilterInput = {
    ...query,
    // Se ignoran `limit`/`offset`/`sort`: se exporta todo el rango filtrado.
    limit: MAX_EXPORT_ROWS,
    offset: 0,
    sort: 'date_desc',
  };

  const { items, total } = await listExpenses(
    auth.user.id,
    filters,
    auth.user.timezone,
  );

  if (total > MAX_EXPORT_ROWS) {
    // Se exporta el máximo y se avisa en una cabecera: truncar en silencio
    // haría creer al usuario que tiene todos sus datos.
    return exportResponse(
      Buffer.from(
        `# AVISO: se exportaron los primeros ${MAX_EXPORT_ROWS} de ${total} gastos. ` +
          'Acota el rango por fechas para exportar el resto.\n',
        'utf8',
      ),
      'text/plain; charset=utf-8',
      'aviso',
    );
  }

  const rows = items.map(toExportRow);
  const options = {
    timezone: auth.user.timezone,
    locale: 'es-ES',
    currency: auth.user.currency,
  };

  if (query.format === 'json') {
    return exportResponse(
      buildJson(rows, options),
      MIME_TYPES.json,
      timestampedFilename('gastos', 'json'),
    );
  }
  if (query.format === 'xlsx') {
    return exportResponse(
      await buildXlsx(rows, options),
      MIME_TYPES.xlsx,
      timestampedFilename('gastos', 'xlsx'),
    );
  }
  return exportResponse(
    buildCsv(rows, options),
    MIME_TYPES.csv,
    timestampedFilename('gastos', 'csv'),
  );
});

/**
 * Construye la respuesta de descarga.
 *
 * `Content-Disposition: attachment` con un nombre en `filename*` codificado en
 * UTF-8: los nombres con acentos (que no los tiene, pero el futuro sí) se
 * rompen con la forma ASCII.
 */
function exportResponse(body: Buffer, mime: string, filename: string): Response {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(body.byteLength),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
