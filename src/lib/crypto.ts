import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './validators-constants';

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Parámetros de scrypt. N=2^15 con r=8 y p=1 cuesta ~32 MB y ~100 ms por
 * verificación en hardware de usuario, que es el rango recomendado por
 * OWASP para contraseñas interactivas. Se sube `maxmem` porque el valor por
 * defecto de Node (32 MB) queda justo y puede fallar.
 */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 } as const;
const SCRYPT_MAXMEM = 128 * SCRYPT.N * SCRYPT.r * 2;


/**
 * Deriva una contraseña con scrypt. Formato almacenado:
 * `scrypt$N$r$p$saltBase64$hashBase64`
 * Guardar los parámetros permite subirlos en el futuro sin invalidar las
 * contraseñas ya derivadas.
 */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    );
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, {
    ...SCRYPT,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Verifica una contraseña en tiempo constante. Devuelve `false` (nunca lanza)
 * ante hashes malformados para no filtrar información por diferencia de
 * tiempos.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
      return false;
    }
    if (N < 2 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;

    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (salt.length === 0 || expected.length === 0) return false;

    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** SHA-256 en hexadecimal. Para valores de alta entropía, no para contraseñas. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** HMAC-SHA256 con clave, en hexadecimal. */
export function hmacSha256(key: string, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

/**
 * Genera un token de alta entropía en base64url.
 * 32 bytes = 256 bits, suficiente para tokens de sesión y de dispositivo.
 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Compara dos cadenas en tiempo constante. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Se comprueba igualmente el tiempo para no filtrar la longitud.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
