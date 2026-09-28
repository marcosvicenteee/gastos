import { NextResponse } from 'next/server';

/**
 * Error de API con código estable para el cliente.
 *
 * El `code` es lo que consumen el frontend y el Atajo; el `message` está en
 * español y es apto para mostrar al usuario final. Nunca se devuelve la
 * traza ni el mensaje original de una excepción interna.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'bad_request', message, details);

export const unauthorized = (message = 'No autenticado.') =>
  new ApiError(401, 'unauthorized', message);

export const forbidden = (message = 'Acceso denegado.') =>
  new ApiError(403, 'forbidden', message);

export const notFound = (message = 'Recurso no encontrado.') =>
  new ApiError(404, 'not_found', message);

export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, 'conflict', message, details);

export const unprocessable = (message: string, details?: unknown) =>
  new ApiError(422, 'unprocessable', message, details);

export const tooManyRequests = (message: string, retryAfterSeconds?: number) =>
  new ApiError(429, 'rate_limited', message, { retryAfterSeconds });

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, {
    ...init,
    status: init?.status ?? 200,
  });
}

export function jsonCreated<T>(data: T): NextResponse {
  return NextResponse.json(data as object, { status: 201 });
}

export function jsonError(error: ApiError): NextResponse {
  const headers: Record<string, string> = {};
  if (error.status === 429) {
    const retry = (error.details as { retryAfterSeconds?: number })?.retryAfterSeconds;
    if (retry) headers['Retry-After'] = String(retry);
  }
  return NextResponse.json(
    { error: { code: error.code, message: error.message, details: error.details ?? null } },
    { status: error.status, headers },
  );
}

/**
 * Envuelve un handler y traduce cualquier excepción a una respuesta JSON.
 * Los errores inesperados se registran en el servidor pero su detalle nunca
 * sale hacia el cliente.
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonError(error);
      }
      if (error instanceof Error) {
        // Registro en servidor. Deliberadamente sin detalle en la respuesta:
        // una traza en el cuerpo revelaría rutas, consultas y estructura.
        console.error('[api] error no controlado:', {
          name: error.name,
          message: error.message,
        });
      } else {
        console.error('[api] error no controlado (valor no Error)');
      }
      return jsonError(
        new ApiError(500, 'internal_error', 'Se ha producido un error inesperado.'),
      );
    }
  };
}
