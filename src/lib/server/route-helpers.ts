import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  authenticateDeviceToken,
  getCurrentUser,
  readBearerToken,
  type SessionUser,
} from '../auth';
import { assertSameOrigin } from '../csrf';
import { enforceRateLimit, RATE_LIMITS } from '../rate-limit';
import { unprocessable, badRequest, unauthorized } from '../api';

/**
 * Utilidades compartidas por las rutas de la API.
 *
 * Concentran las tres comprobaciones que TODA ruta debe hacer —autenticación,
 * origen y límite de peticiones— para que ninguna se olvide por descuido en un
 * endpoint nuevo.
 */

export interface AuthContext {
  user: SessionUser;
  via: 'session' | 'device_token';
  /** Presente sólo si la petición usa token de dispositivo. */
  deviceTokenId: string | null;
}

/**
 * Autentica por cookie de sesión (navegador).
 *
 * Aplica la comprobación de origen en las mutaciones. Los GET no la necesitan
 * porque no cambian estado.
 */
export async function requireSession(
  request: NextRequest,
  scope: string,
  limit: { capacity: number; refillPerMinute: number } = RATE_LIMITS.read,
): Promise<AuthContext> {
  assertSameOrigin(request);
  const user = await getCurrentUser();
  if (!user) throw unauthorized('Necesitas iniciar sesión.');
  // El límite se indexa por usuario y no sólo por IP: un atacante que rote
  // direcciones desde una red amplia no gana cupos extra.
  enforceRateLimit(request, limit, scope, user.id);
  return { user, via: 'session', deviceTokenId: null };
}

/**
 * Autentica por token de dispositivo (Atajo de iPhone).
 *
 * No se comprueba el origen: un Atajo no es un navegador y no envía cookies, de
 * modo que el CSRF no aplica. El token es el factor de autenticación.
 */
export async function requireDeviceToken(
  request: NextRequest,
  scope: string,
  limit: { capacity: number; refillPerMinute: number } = RATE_LIMITS.ingest,
): Promise<AuthContext> {
  const token = readBearerToken(request);
  if (!token) {
    throw unauthorized(
      'Falta el token del dispositivo. Envíalo en la cabecera Authorization: Bearer <token>.',
    );
  }

  const principal = await authenticateDeviceToken(token);
  if (!principal) {
    throw unauthorized('Token de dispositivo no válido o revocado.');
  }

  // El límite se indexa por token: un token robado queda acotado aunque se
  // aplique desde direcciones distintas.
  enforceRateLimit(request, limit, scope, principal.tokenId);
  return {
    user: principal.user,
    via: 'device_token',
    deviceTokenId: principal.tokenId,
  };
}

/** Acepta cualquiera de los dos mecanismos. Lo usan los endpoints de lectura. */
export async function requireAnyAuth(
  request: NextRequest,
  scope: string,
  limit: { capacity: number; refillPerMinute: number } = RATE_LIMITS.read,
): Promise<AuthContext> {
  const token = readBearerToken(request);
  if (token) return requireDeviceToken(request, scope, limit);
  return requireSession(request, scope, limit);
}

/** Valida y devuelve los parámetros de consulta. */
export function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  request: NextRequest,
): z.infer<T> {
  const result = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!result.success) {
    throw badRequest('Los filtros no son válidos.', formatZodIssues(result.error));
  }
  return result.data;
}

/** Valida y devuelve el cuerpo JSON. Un cuerpo inválido da 422, no 500. */
export async function readJson<T extends z.ZodTypeAny>(
  request: NextRequest,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest('El cuerpo de la petición no es JSON válido.');
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('El cuerpo de la petición debe ser un objeto JSON.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw unprocessable('Revisa los datos enviados.', formatZodIssues(result.error));
  }
  return result.data;
}

/** Convierte los errores de Zod en algo legible en la interfaz. */
export function formatZodIssues(error: z.ZodError): Record<string, string> {
  const issues: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'general';
    // Se conserva el primer error por campo: son los que se muestran.
    if (!(key in issues)) issues[key] = issue.message;
  }
  return issues;
}

/** Nombre de fichero con marca temporal para las descargas. */
export function timestampedFilename(prefix: string, extension: string): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    '-',
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
  ].join('');
  return `${prefix}-${stamp}.${extension}`;
}

export { NextResponse };
