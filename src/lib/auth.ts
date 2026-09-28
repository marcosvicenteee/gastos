import { cookies, headers } from 'next/headers';
import { prisma } from './prisma';
import { randomToken, sha256 } from './crypto';
import { unauthorized } from './api';

/**
 * Autenticación propia, sin dependencias externas.
 *
 * Dos mecanismos, con tokens separados:
 *
 *  1. **Sesión de navegador** — cookie `HttpOnly; Secure; SameSite=Lax`
 *     con un token aleatorio de 256 bits. En la base de datos sólo se guarda
 *     su SHA-256, de modo que leer la tabla `Session` no permite suplantar a
 *     nadie. Además se exige que las mutaciones declaren un origen legítimo
 *     (ver `csrf.ts`).
 *
 *  2. **Token de dispositivo** — para los Atajos. Vive en el
 *     llavero de iCloud del usuario, viaja en la cabecera
 *     `Authorization: Bearer`, es revocable y se puede auditar.
 *
 * En ningún caso se guardan credenciales bancarias ni de Revolut.
 */

export const SESSION_COOKIE = 'gi_session';
const SESSION_TTL_DAYS = 30;
const SESSION_RENEW_THRESHOLD_DAYS = 7;

export const DEVICE_TOKEN_PREFIX = 'gk_';
const DEVICE_TOKEN_SECRET_BYTES = 32;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}

export async function createSession(userId: string): Promise<void> {
  const headerList = await headers();
  const userAgent = headerList.get('user-agent');

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      userAgent: userAgent?.slice(0, 400) ?? null,
      expiresAt,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions());
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: sha256(token) } })
      .catch(() => undefined);
  }
  store.delete(SESSION_COOKIE);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  currency: string;
  timezone: string;
  isDemo: boolean;
  createdAt: Date;
}

type UserWithRelations = SessionUser;

/** Devuelve el usuario de la sesión actual, o `null`. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session
      .delete({ where: { id: session.id } })
      .catch(() => undefined);
    return null;
  }

  // Sesión deslizante: se renueva cuando queda cerca de caducar, para no
  // expulsar al usuario en mitad de una sesión larga.
  const remainingDays = (session.expiresAt.getTime() - Date.now()) / 86_400_000;
  if (remainingDays < SESSION_RENEW_THRESHOLD_DAYS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt, lastUsedAt: new Date() },
    });
    store.set(SESSION_COOKIE, token, cookieOptions());
  }

  return toSessionUser(session.user);
}

/** Igual que `getCurrentUser` pero lanza 401. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized('Necesitas iniciar sesión.');
  return user;
}

function toSessionUser(user: UserWithRelations): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    currency: user.currency,
    timezone: user.timezone,
    isDemo: user.isDemo,
    createdAt: user.createdAt,
  };
}

/** Borra las sesiones caducadas. Lo llama el cron opcional de mantenimiento. */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

// ---------------------------------------------------------------------------
// Tokens de dispositivo (Atajos de iPhone)
// ---------------------------------------------------------------------------

/**
 * Crea un token de dispositivo. El valor en claro sólo se devuelve aquí, una
 * única vez: es lo que el usuario pega en el Atajo. A partir de ese momento
 * la base de datos sólo conoce el hash.
 */
export async function createDeviceToken(
  userId: string,
  label: string,
): Promise<{ id: string; token: string; displayHint: string }> {
  const secret = randomToken(DEVICE_TOKEN_SECRET_BYTES);
  const token = `${DEVICE_TOKEN_PREFIX}${secret}`;
  const deviceToken = await prisma.deviceToken.create({
    data: {
      userId,
      label,
      tokenHash: sha256(token),
      displayHint: `${DEVICE_TOKEN_PREFIX}${secret.slice(0, 6)}…${secret.slice(-4)}`,
    },
  });
  return { id: deviceToken.id, token, displayHint: deviceToken.displayHint };
}

export interface DeviceTokenPrincipal {
  tokenId: string;
  user: SessionUser;
}

/**
 * Valida un token de dispositivo y registra su uso.
 *
 * El hash se busca directamente en la base de datos (índice único), así que
 * el coste de un token inválido es el de una consulta que no encuentra nada;
 * no hay ningún bucle de comparación.
 */
export async function authenticateDeviceToken(
  token: string,
): Promise<DeviceTokenPrincipal | null> {
  if (!token || !token.startsWith(DEVICE_TOKEN_PREFIX)) return null;
  // Un token de dispositivo tiene una forma concreta; descartar lo demás
  // antes de tocar la base de datos reduce la superficie.
  if (!/^gk_[A-Za-z0-9_-]{40,64}$/.test(token)) return null;

  const record = await prisma.deviceToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });

  if (!record || record.revokedAt) return null;

  await prisma.deviceToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date(), useCount: { increment: 1 } },
  });

  return { tokenId: record.id, user: toSessionUser(record.user) };
}

/** Extrae el token del encabezado `Authorization: Bearer ...`. */
export function readBearerToken(request: { headers: Headers }): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;
  return value.trim();
}
