/**
 * Protección CSRF para peticiones que se autentican con la cookie de sesión.
 *
 * Estrategia (sin librerías):
 *  1. La cookie de sesión es `SameSite=Lax`, por lo que un formulario
 *     cross-site POST no la envía. Eso ya neutraliza el caso clásico.
 *  2. Además, toda mutación con cookie debe traer una cabecera `Origin` (o
 *     `Referer`) que coincida con el origen de la app. Una petición hecha con
 *     `fetch()` desde otra web siempre incluye `Origin` y sería rechazada.
 *  3. Se rechaza además cualquier `Content-Type` que no sea JSON o vacío, lo
 *     que impide enviar formularios HTML classicos (que no pueden fijar
 *     cabeceras personalizadas).
 *
 * Las peticiones autenticadas con token de dispositivo (el Atajo) no pasan por
 * aquí: no dependen de cookies, así que no son susceptibles a CSRF.
 */
import { NextRequest } from 'next/server';
import { forbidden } from './api';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Orígenes aceptados: el configurado y, en desarrollo, localhost. */
function allowedOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>();
  const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) origins.add(new URL(configured).origin);

  if (process.env.NODE_ENV !== 'production') {
    const host = request.headers.get('host');
    if (host) {
      origins.add(`http://${host}`);
      origins.add(`https://${host}`);
    }
  }
  return origins;
}

export function assertSameOrigin(request: NextRequest): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const contentType = request.headers.get('content-type');
  // Un envío de formulario HTML siempre trae uno de estos.
  if (
    contentType &&
    !contentType.includes('application/json') &&
    !contentType.includes('text/plain')
  ) {
    throw forbidden('Tipo de contenido no permitido.');
  }

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const allowed = allowedOrigins(request);

  if (origin) {
    if (!allowed.has(origin)) {
      throw forbidden('Origen de la petición no permitido.');
    }
    return;
  }

  if (referer) {
    try {
      if (!allowed.has(new URL(referer).origin)) {
        throw forbidden('Origen de la petición no permitido.');
      }
      return;
    } catch (error) {
      if (error instanceof Error && error.name === 'ApiError') throw error;
      throw forbidden('Referer no válido.');
    }
  }

  // Sin Origin ni Referer: lo rechaza todo el tráfico legítimo del navegador
  // (fetch/XHR siempre los envían en mutaciones), salvo clientes no
  // navegador, que no dependen de la cookie y usan token.
  throw forbidden('Falta el encabezado de origen.');
}
