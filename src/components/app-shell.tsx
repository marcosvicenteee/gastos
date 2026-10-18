'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import type { SessionResponse } from '@/lib/types';
import {
  ChartIcon,
  HomeIcon,
  ListIcon,
  LogoutIcon,
  PhoneIcon,
  TagIcon,
  WandIcon,
} from './icons';
import { ThemeToggle } from './theme-toggle';
import { useToast } from './toast';

/**
 * Estructura de la aplicación: barra lateral en escritorio y barra inferior en
 * móvil.
 *
 * Se optó por una barra inferior en lugar de un menú desplegable porque la
 * mano que usa la app sostiene el teléfono por abajo: llega a la barra inferior
 * con el pulgar, y abrir un menú para después elegir es un paso de más.
 *
 * Estilo Apple: barra blanca con borde sutil #d6d6d6, tipografía compacta
 * con tracking negativo, y controles sin caja.
 */

const LINKS = [
  { href: '/', label: 'Resumen', Icon: HomeIcon },
  { href: '/gastos', label: 'Gastos', Icon: ListIcon },
  { href: '/categorias', label: 'Categorías', Icon: TagIcon },
  { href: '/reglas', label: 'Reglas', Icon: WandIcon },
  { href: '/ajustes', label: 'Ajustes', Icon: PhoneIcon },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [session, setSession] = useState<SessionResponse | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<SessionResponse>('/api/auth/me')
      .then((data) => {
        if (alive) setSession(data);
      })
      .catch(() => {
        // Un 401 aquí sólo significa "todavía no ha entrado". La redirección
        // la hace el propio servidor en el layout, así que no se avisa.
      });
    return () => {
      alive = false;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
      router.replace('/entrar');
      router.refresh();
    } catch {
      toast.error('No se pudo cerrar la sesión. Inténtalo de nuevo.');
    }
  }, [router, toast]);

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Barra lateral: sólo en pantallas grandes. */}
      <aside className="hidden w-60 shrink-0 border-r border-hairline-silver bg-gallery-white lg:flex lg:flex-col">
        <div className="px-6 py-6">
          <Link href="/" className="flex items-center gap-2.5 text-label text-ink">
            <span className="text-accent">
              <ChartIcon width={22} height={22} />
            </span>
            Gastos
          </Link>
        </div>
        <nav className="flex-1 px-3">
          <ul className="space-y-0.5">
            {LINKS.map(({ href, label, Icon }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-body transition-colors ${
                      active
                        ? 'font-medium text-accent bg-accent-soft'
                        : 'text-slate hover:bg-studio-mist hover:text-ink'
                    }`}
                  >
                    <span className="text-base">
                      <Icon width={18} height={18} />
                    </span>
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="space-y-4 border-t border-hairline-silver p-4">
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <p className="truncate text-body font-medium text-ink">
                {session?.user.name ?? '—'}
              </p>
              <p className="truncate text-caption text-steel">
                {session?.user.email ?? ''}
              </p>
            </div>
            <ThemeToggle />
          </div>
          <button type="button" onClick={logout} className="btn btn-secondary w-full text-sm">
            <LogoutIcon width={16} height={16} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Cabecera móvil: incluye el tema, que en móvil no cabe en la barra. */}
        <header className="flex items-center justify-between border-b border-hairline-silver bg-gallery-white px-5 py-3.5 lg:hidden">
          <Link href="/" className="flex items-center gap-2 text-label text-ink">
            <span className="text-accent">
              <ChartIcon width={20} height={20} />
            </span>
            Gastos
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={logout}
              className="btn btn-ghost px-2 py-2"
              aria-label="Cerrar sesión"
            >
              <LogoutIcon width={18} height={18} />
            </button>
          </div>
        </header>

        <main className="flex-1 px-5 py-6 pb-28 lg:px-10 lg:py-8 lg:pb-10">{children}</main>
      </div>

      {/* Barra inferior: sólo en móvil. `env(safe-area-inset-*)` deja el botón
          de inicio del iPhone por encima. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline-silver bg-paper-frost lg:hidden">
        <ul className="grid grid-cols-5">
          {LINKS.map(({ href, label, Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex flex-col items-center gap-0.5 py-2 text-caption transition-colors ${
                    active ? 'text-accent' : 'text-steel'
                  }`}
                  style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
                >
                  <Icon width={22} height={22} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
