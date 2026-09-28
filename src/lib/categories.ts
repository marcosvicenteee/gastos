/**
 * Categorías predeterminadas.
 *
 * Se copian a cada usuario en el momento del registro, de modo que:
 *  · el Atajo siempre puede pedir la lista a `GET /api/categories/options`
 *    y no lleva categorías incrustadas que se quedarían obsoletas;
 *  · cada usuario puede renombrarlas, reordenarlas o borrarlas sin afectar a
 *    nadie más.
 *
 * `icon` es una clave del set de iconos SVG de `src/components/category-icon.tsx`.
 * Nunca emojis: se ven distintos en cada sistema y rompen el diseño.
 */

export interface DefaultCategory {
  name: string;
  slug: string;
  icon: string;
  color: string;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: 'Comida', slug: 'comida', icon: 'Utensils', color: '#F97316' },
  { name: 'Supermercado', slug: 'supermercado', icon: 'ShoppingCart', color: '#22C55E' },
  { name: 'Transporte', slug: 'transporte', icon: 'Car', color: '#0EA5E9' },
  { name: 'Ocio', slug: 'ocio', icon: 'Clapperboard', color: '#A855F7' },
  { name: 'Ropa', slug: 'ropa', icon: 'Shirt', color: '#EC4899' },
  { name: 'Tecnología', slug: 'tecnologia', icon: 'Laptop', color: '#3B82F6' },
  { name: 'Casa', slug: 'casa', icon: 'House', color: '#14B8A6' },
  { name: 'Suscripciones', slug: 'suscripciones', icon: 'Repeat', color: '#6366F1' },
  { name: 'Salud', slug: 'salud', icon: 'HeartPulse', color: '#EF4444' },
  { name: 'Viajes', slug: 'viajes', icon: 'Plane', color: '#8B5CF6' },
  { name: 'Compras', slug: 'compras', icon: 'ShoppingBag', color: '#EAB308' },
  { name: 'Deportes', slug: 'deportes', icon: 'Dumbbell', color: '#84CC16' },
  { name: 'Suministros', slug: 'suministros', icon: 'Zap', color: '#0D9488' },
  { name: 'Otros', slug: 'otros', icon: 'Wallet', color: '#64748B' },
];

/** Slug de la categoría a la que cae todo lo que no coincide con ninguna regla. */
export const FALLBACK_CATEGORY_SLUG = 'otros';

/**
 * Normaliza un nombre de categoría a slug estable: sin acentos, en minúsculas
 * y con guiones. "Tecnología" y "tecnologia" producen el mismo slug, así que
 * crear "tecnología" cuando ya existe "Tecnología" no rompe nada.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Paleta sobria para los colores de categoría, por si el usuario elige uno. */
export const CATEGORY_COLOR_PALETTE = [
  '#F97316',
  '#22C55E',
  '#0EA5E9',
  '#A855F7',
  '#EC4899',
  '#3B82F6',
  '#14B8A6',
  '#6366F1',
  '#EF4444',
  '#8B5CF6',
  '#EAB308',
  '#64748B',
] as const;
