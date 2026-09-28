/**
 * Configuración de entorno.
 *
 * Se valida al importar el módulo y falla rápido: es preferible que la app no
 * arranque con un secreto ausente o débil a que falle en producción con un
 * error confuso a las 3 de la mañana.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Falta la variable de entorno ${name}. Copia .env.example a .env y complétala.`,
    );
  }
  return value;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

const MIN_SECRET_LENGTH = 32;

function secret(name: string): string {
  const value = required(name);
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} es demasiado corto. Necesita al menos ${MIN_SECRET_LENGTH} caracteres. ` +
        `Genera uno con: openssl rand -base64 48`,
    );
  }
  return value;
}

function clientEnv() {
  return {
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  };
}

export const env = {
  isProduction: isProduction(),
  get databaseUrl() {
    return required('DATABASE_URL');
  },
  get authSecret() {
    return secret('AUTH_SECRET');
  },
  get deviceTokenSecret() {
    // Se puede reutilizar AUTH_SECRET, pero mantenerlos separados permite
    // rotar los tokens de los Atajos sin invalidar las sesiones de navegador.
    return process.env.DEVICE_TOKEN_SECRET ?? secret('AUTH_SECRET');
  },
  get appUrl() {
    return clientEnv().appUrl;
  },
  get nodeEnv() {
    return process.env.NODE_ENV ?? 'development';
  },
} as const;
