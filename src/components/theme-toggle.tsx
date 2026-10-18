'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './icons';

/**
 * Interruptor de tema claro/oscuro.
 *
 * El atributo `dark` se escribe en el `<script>` del `layout.tsx` antes del
 * primer pintado. Este botón sólo lo cambia después, cuando ya se ve algo, y
 * por eso no puede provocar un parpadeo.
 *
 * Estilo Apple: control compacto sin caja, con icono monocromo.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    setReady(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      window.localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // Modo privado sin almacenamiento: el tema durará lo que la pestaña,
      // que es mejor que romper la página.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={ready && dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      title={ready && dark ? 'Tema claro' : 'Tema oscuro'}
      className="flex h-9 w-9 items-center justify-center rounded-full text-slate transition-colors hover:bg-studio-mist hover:text-ink"
    >
      {ready && dark ? <SunIcon width={18} height={18} /> : <MoonIcon width={18} height={18} />}
    </button>
  );
}
