'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './icons';

/**
 * Interruptor de tema claro/oscuro.
 *
 * El atributo `dark` se escribe en el `<script>` del `layout.tsx` antes del
 * primer pintado. Este botón sólo lo cambia después, cuando ya se ve algo, y
 * por eso no puede provocar un parpadeo.
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
      // Antes del efecto no se sabe qué tema hay, y pintar el icono equivocado
      // y cambiarlo un instante después se ve como un parpadeo.
      aria-label={ready && dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      title={ready && dark ? 'Tema claro' : 'Tema oscuro'}
      className="btn btn-secondary px-2 py-2 text-base"
    >
      {ready && dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
