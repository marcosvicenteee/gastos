'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError, NetworkError } from '@/lib/client';

/**
 * Formularios de acceso y registro.
 *
 * Comparten casi todo: mismos campos, mismo manejo de error, mismo envío. La
 * diferencia real son dos líneas (la ruta y el cuerpo), así que se resuelve
 * con una bandera en lugar de con dos componentes que se desincronizarían en
 * cuanto uno de los dos necesitara un cambio.
 */

type Mode = 'login' | 'register';

const COPY = {
  login: {
    title: 'Entrar',
    subtitle: 'Accede a tus gastos.',
    submit: 'Entrar',
    footer: '¿No tienes cuenta?',
    footerLink: 'Crear una',
    footerHref: '/registro',
  },
  register: {
    title: 'Crear cuenta',
    subtitle: 'Empieza a registrar tus gastos.',
    submit: 'Crear cuenta',
    footer: '¿Ya tienes cuenta?',
    footerLink: 'Entrar',
    footerHref: '/entrar',
  },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const copy = COPY[mode];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setErrors({});
    setFormError(null);

    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body =
        mode === 'login' ? { email, password } : { email, password, name: name || undefined };
      await api.post(path, body);
      // `refresh` es necesario además de `replace`: el layout del servidor
      // decide a dónde va, y sin revalidar seguiría viendo la sesión vacía.
      router.replace('/');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.fieldErrors;
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(error.message);
      } else if (error instanceof NetworkError) {
        setFormError(error.message);
      } else {
        setFormError('Algo ha ido mal. Inténtalo de nuevo.');
      }
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="card p-6">
          <h1 className="text-xl font-semibold">{copy.title}</h1>
          <p className="mt-1 text-sm text-text-muted">{copy.subtitle}</p>

          {formError && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative"
            >
              {formError}
            </p>
          )}

          <form className="mt-5 space-y-4" onSubmit={onSubmit} noValidate>
            {mode === 'register' && (
              <div>
                <label htmlFor="name" className="mb-1 block text-sm font-medium">
                  Nombre <span className="text-text-subtle">(opcional)</span>
                </label>
                <input
                  id="name"
                  name="name"
                  className="field"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  maxLength={80}
                />
                {errors.name && (
                  <p className="mt-1 text-xs text-negative">{errors.name}</p>
                )}
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium">
                Correo electrónico
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="field"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                inputMode="email"
                required
              />
              {errors.email && <p className="mt-1 text-xs text-negative">{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium">
                Contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                className="field"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
              {errors.password && (
                <p className="mt-1 text-xs text-negative">{errors.password}</p>
              )}
              {mode === 'register' && (
                <p className="mt-1 text-xs text-text-subtle">Mínimo 10 caracteres.</p>
              )}
            </div>

            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy && <span className="spinner" />}
              {copy.submit}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-sm text-text-muted">
          {copy.footer}{' '}
          <Link href={copy.footerHref} className="font-medium text-accent hover:underline">
            {copy.footerLink}
          </Link>
        </p>

        {mode === 'login' && <DemoAccess />}
      </div>
    </main>
  );
}

/**
 * Atajo para probar la aplicación con datos de ejemplo.
 *
 * El botón pide al servidor que cree la cuenta y luego entra con ella. Es
 * deliberadamente una llamada aparte en vez de rellenar el formulario: así el
 * camino de prueba no depende de que la contraseña se haya escrito bien, que
 * es el error más probable al pulsar un botón que se supone que funciona.
 */
function DemoAccess() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enter() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/demo/seed', { months: 4 });
      await api.post('/api/auth/login', {
        email: 'demo@example.com',
        password: 'DemoLocal2026!',
      });
      router.replace('/');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'No se pudo preparar la demostración.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="card mt-4 p-4">
      <p className="text-sm font-medium">¿Quieres ver datos de ejemplo?</p>
      <p className="mt-1 text-xs text-text-muted">
        Crea una cuenta con gastos inventados de los últimos meses. Puedes borrarla
        después desde Ajustes.
      </p>
      {error && <p className="mt-2 text-xs text-negative">{error}</p>}
      <button
        type="button"
        onClick={enter}
        disabled={busy}
        className="btn btn-secondary mt-3 w-full"
      >
        {busy && <span className="spinner" />}
        Entrar con datos de ejemplo
      </button>
    </div>
  );
}
