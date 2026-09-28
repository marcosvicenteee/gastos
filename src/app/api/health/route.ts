import { jsonOk, withErrorHandling } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * `GET /api/health`
 *
 * Ping público baratísimo (sin BD ni sesión) para:
 *  - el keep-alive de Render: un pinger externo o el propio iPhone le manda
 *    una petición cada X minutos y el servicio free no se duerme;
 *  - comprobar desde el Atajo que la web está viva antes de intentar guardar.
 *
 * No autentica a propósito: sólo devuelve la hora.
 */
export const GET = withErrorHandling(async () => {
  return jsonOk({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});
