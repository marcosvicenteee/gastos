/**
 * Limitación de peticiones en memoria del proceso.
 *
 * Implementación: cubo de tokens por clave con recarga continua. Es exacta y
 * sin dependencias, pero vive en la memoria del proceso: con varias
 * instancias (Vercel serverless, Railway con N réplicas) cada una lleva su
 * propio contador. Para despliegue multi-instancia, sustituye el backing store
 * por Redis/Upstash manteniendo la misma interfaz; ver `docs/SEGURIDAD.md`.
 *
 * Un ataque distribuido desde N direcciones queda limitado a N * rate por
 * instancia, que es exactamente el comportamiento que se quiere en un
 * despliegue pequeño. La protección crítica (comparación en tiempo constante,
 * scrypt, tokens con hash) no depende de este módulo.
 */
import { tooManyRequests } from './api';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

/** Evita que el Map crezca sin límite por IPs aleatorias. */
const MAX_BUCKETS = 10_000;
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.updatedAt > 10 * 60_000) buckets.delete(key);
  }
  if (buckets.size > MAX_BUCKETS) {
    const sorted = [...buckets.entries()].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    for (let i = 0; i < sorted.length - MAX_BUCKETS; i += 1) {
      buckets.delete(sorted[i][0]);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Segundos que hay que esperar si no se permite la petición. */
  retryAfterSeconds: number;
}

/** Consume un token del cubo. Devuelve si se permite y cuánto queda. */
export function rateLimit(
  key: string,
  capacity: number,
  refillPerMinute: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  const refillRate = refillPerMinute / 60_000;
  const elapsed = now - bucket.updatedAt;

  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillRate);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    const missing = 1 - bucket.tokens;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(missing / refillRate)),
    };
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return {
    allowed: true,
    remaining: Math.floor(bucket.tokens),
    retryAfterSeconds: 0,
  };
}

/**
 * Límites por defecto. Son deliberadamente distintos según el endpoint: un
 * login se limita mucho más que una lectura, porque un login es el objetivo
 * interesante para un atacante.
 */
export const RATE_LIMITS = {
  login: { capacity: 8, refillPerMinute: 8 },
  register: { capacity: 5, refillPerMinute: 5 },
  write: { capacity: 60, refillPerMinute: 60 },
  /** El Atajo crea gastos de forma legítima en ráfaga (cola offline). */
  ingest: { capacity: 120, refillPerMinute: 120 },
  read: { capacity: 300, refillPerMinute: 300 },
  export: { capacity: 10, refillPerMinute: 10 },
} as const;

/** Identificador de cliente para dimensionar el cubo. */
export function clientKey(request: { headers: Headers }): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]!.trim();
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Aplica un límite y lanza `ApiError` 429 si seAgota.
 * Se ejecuta tras autenticar cuando sea posible, para poder usar el
 * identificador del usuario en lugar de la IP.
 */
export function enforceRateLimit(
  request: { headers: Headers },
  limit: { capacity: number; refillPerMinute: number },
  scope: string,
  identity?: string,
): void {
  const identityPart = identity ?? clientKey(request);
  const result = rateLimit(`${scope}:${identityPart}`, limit.capacity, limit.refillPerMinute);
  if (!result.allowed) {
    throw tooManyRequests(
      'Demasiadas peticiones. Espera unos segundos e inténtalo de nuevo.',
      result.retryAfterSeconds,
    );
  }
}
