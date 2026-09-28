import type { ReactNode, SVGProps } from 'react';

/**
 * Iconos de categoría.
 *
 * `Category.icon` guarda una clave (`Utensils`, `Car`…), no un SVG: así el
 * icono viaja en la base de datos, se puede cambiar desde la interfaz y el
 * cliente no arrastra miles de bytes de SVG que usaría un puñado de veces.
 *
 * El trazo sigue la misma receta que `icons.tsx` (2 px, `currentColor`, sin
 * relleno) para que una fila con icono no se vea de otra familia. Una clave
 * desconocida —una categoría creada a mano con un nombre raro, o una eliminada
 * de este mapa en el futuro— cae en `Wallet`: nunca se dibuja un hueco.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

const SHAPES: Record<string, ReactNode> = {
  Utensils: (
    <>
      <path d="M5 3v6a3 3 0 0 0 6 0V3" />
      <path d="M8 12v9" />
      <path d="M17 3c-1.4 1.7-2 3.7-2 6h2" />
      <path d="M17 9v12" />
    </>
  ),
  ShoppingCart: (
    <>
      <circle cx="9" cy="20" r="1" />
      <circle cx="19" cy="20" r="1" />
      <path d="M2 4h2.5l2.2 9.6a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L20.5 8H6" />
    </>
  ),
  Car: (
    <>
      <path d="M5 17h14" />
      <path d="M6.5 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" />
      <path d="M21.5 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" />
      <path d="M3 13.5 4.4 8a2 2 0 0 1 2-1.5h11.2a2 2 0 0 1 2 1.5L21 13.5V16H3z" />
      <path d="M6 10.5h2M16 10.5h2" />
    </>
  ),
  Clapperboard: (
    <>
      <path d="M20 6H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1Z" />
      <path d="m4.5 6-1 4.5" />
      <path d="m9 6-1 4.5" />
      <path d="m13.5 6-1 4.5" />
      <path d="m18 6-1 4.5" />
    </>
  ),
  Shirt: (
    <>
      <path d="M20 5.5 16 3a4 4 0 0 1-8 0L4 5.5a2 2 0 0 0-1.3 2.3l.6 3.2A1 1 0 0 0 4.3 12H6v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8h1.7a1 1 0 0 0 1-1l.6-3.2A2 2 0 0 0 20 5.5Z" />
    </>
  ),
  Laptop: (
    <>
      <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9" />
      <path d="M2.5 16h19l.8 2.2a1 1 0 0 1-.9 1.3H2.6a1 1 0 0 1-.9-1.3z" />
    </>
  ),
  House: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  Repeat: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>
  ),
  HeartPulse: (
    <>
      <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />
      <path d="M3.5 12H8l1.5-2.5L12 15l2-5 1.5 2h5" />
    </>
  ),
  Plane: (
    <>
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
    </>
  ),
  ShoppingBag: (
    <>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </>
  ),
  Dumbbell: (
    <>
      <path d="m6.5 6.5 11 11" />
      <path d="m21 21-1-1M3 3l1 1" />
      <path d="m18 22 4-4M2 6l4-4" />
      <path d="m3 10 7-7M14 21l7-7" />
    </>
  ),
  Zap: (
    <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
  ),
  Wallet: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M16 12h5" />
    </>
  ),
};

const FALLBACK = 'Wallet';

export function CategoryIcon({
  name,
  ...props
}: { name?: string | null } & IconProps) {
  const shape = (name && SHAPES[name]) || SHAPES[FALLBACK]!;
  return <Icon {...props}>{shape}</Icon>;
}
