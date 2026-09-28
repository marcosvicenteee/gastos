import { prisma } from '../prisma';
import { slugify } from '../categories';
import { ApiError } from '../api';

/**
 * Servicio de categorías.
 *
 * Vive fuera de `route.ts` porque Next.js sólo permite exportar los métodos HTTP
 * y un puñado de campos de configuración desde un archivo de ruta: cualquier
 * otro `export` rompe el build.
 */

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  icon: string;
  color: string;
  position: number;
  isArchived: boolean;
  expenseCount: number;
  createdAt: string;
  updatedAt: string;
}

function toDto(
  category: {
    id: string;
    name: string;
    slug: string;
    icon: string;
    color: string;
    position: number;
    isArchived: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count?: { expenses: number };
  },
): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    icon: category.icon,
    color: category.color,
    position: category.position,
    isArchived: category.isArchived,
    expenseCount: category._count?.expenses ?? 0,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

export async function listCategories(
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<CategoryDto[]> {
  const categories = await prisma.category.findMany({
    where: { userId, ...(options.includeArchived ? {} : { isArchived: false }) },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { expenses: true } } },
  });
  return categories.map(toDto);
}

export interface CreateCategoryInput {
  name: string;
  icon?: string | null;
  color?: string | null;
  position?: number | null;
}

/**
 * Resuelve colisiones de slug añadiendo un sufijo numérico, para que
 * "Tecnología" y "tecnología" puedan existir como categorías distintas.
 */
async function resolveSlug(userId: string, name: string): Promise<string> {
  const base = slugify(name) || 'categoria';
  let candidate = base;
  for (let attempt = 2; attempt < 50; attempt += 1) {
    const clash = await prisma.category.findFirst({
      where: { userId, slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${base}-${attempt}`;
  }
  // Red de seguridad: 50 versiones del mismo nombre es un caso patológico.
  return `${base}-${Date.now().toString(36)}`;
}

export async function createCategory(
  userId: string,
  input: CreateCategoryInput,
): Promise<CategoryDto> {
  const slug = await resolveSlug(userId, input.name);
  const maxPosition = await prisma.category.aggregate({
    where: { userId },
    _max: { position: true },
  });

  const created = await prisma.category.create({
    data: {
      userId,
      name: input.name,
      slug,
      icon: input.icon ?? 'Wallet',
      color: input.color ?? '#6366F1',
      position: input.position ?? (maxPosition._max.position ?? -1) + 1,
    },
  });
  return toDto({ ...created, _count: { expenses: 0 } });
}

export interface UpdateCategoryInput {
  name?: string;
  icon?: string | null;
  color?: string | null;
  position?: number | null;
  isArchived?: boolean;
}

export async function updateCategory(
  userId: string,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<CategoryDto> {
  const existing = await prisma.category.findFirst({
    where: { id: categoryId, userId },
    select: { id: true },
  });
  if (!existing) {
    throw new ApiError(404, 'not_found', 'La categoría no existe.');
  }

  // El slug no se recalcula al renombrar: cambiarlo rompería las reglas de
  // comercio y los enlaces guardados en el Atajo. Se conserva.
  const updated = await prisma.category.update({
    where: { id: categoryId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.icon !== undefined ? { icon: input.icon ?? 'Wallet' } : {}),
      ...(input.color !== undefined ? { color: input.color ?? '#6366F1' } : {}),
      ...(input.position !== undefined ? { position: input.position ?? 0 } : {}),
      ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
    },
    include: { _count: { select: { expenses: true } } },
  });
  return toDto(updated);
}

/**
 * Borra la categoría.
 *
 * Si tiene gastos asignados no se borra: se ofrece archivar. Borrar en cascada
 * destruiría el histórico del usuario, que es justo lo que no se quiere en una
 * app de contabilidad personal. Se sustituye la categoría por la de reserva.
 */
export async function deleteCategory(
  userId: string,
  categoryId: string,
  fallbackCategoryId: string | null,
): Promise<{ ok: true; reassigned: number }> {
  // Todo en una transaccion: si los gastos se mueven y luego el borrado falla,
  // el usuario se queda con los gastos reasignados y la categoria intacta, sin
  // poder saber por que.
  return prisma.$transaction(async (tx) => {
    const existing = await tx.category.findFirst({
      where: { id: categoryId, userId },
      select: { id: true, slug: true },
    });
    if (!existing) {
      throw new ApiError(404, 'not_found', 'La categoria no existe.');
    }

    const count = await tx.expense.count({ where: { userId, categoryId } });
    if (count > 0) {
      if (!fallbackCategoryId || fallbackCategoryId === categoryId) {
        throw new ApiError(
          409,
          'category_not_empty',
          `Esta categoria tiene ${count} gasto(s). Indica a que categoria se reasignan, o archivala en lugar de borrarla.`,
        );
      }

      // Sin esta comprobacion, un UUID de otra cuenta moveria los gastos fuera
      // del aislamiento del usuario: la columna es una clave foranea valida,
      // pero no dice de quien es la fila de destino.
      const target = await tx.category.findFirst({
        where: { id: fallbackCategoryId, userId },
        select: { id: true },
      });
      if (!target) {
        throw new ApiError(400, 'invalid_fallback', 'La categoria de destino no existe.');
      }

      await tx.expense.updateMany({
        where: { userId, categoryId },
        data: { categoryId: target.id, categorySource: 'manual' },
      });
    }

    // Las reglas que apuntan a esta categoria dejan de apuntar a ella: si no,
    // quedaria una regla rota que no se puede resolver.
    await tx.merchantRule.updateMany({
      where: { userId, categoryId },
      data: { isEnabled: false },
    });

    await tx.category.delete({ where: { id: categoryId } });
    return { ok: true as const, reassigned: count };
  });
}
export async function reorderCategories(
  userId: string,
  ids: string[],
): Promise<CategoryDto[]> {
  const owned = await prisma.category.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true },
  });
  if (owned.length !== ids.length) {
    throw new ApiError(
      404,
      'not_found',
      'Alguna de las categorías no existe o no pertenece a tu cuenta.',
    );
  }

  // `$transaction` con un array de promesas: o se aplica todo el reordenado o
  // nada, de modo que las posiciones nunca queden a medias.
  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.category.update({ where: { id }, data: { position: index } }),
    ),
  );
  return listCategories(userId, { includeArchived: true });
}

/** Categoría de reserva: la que recibe los gastos sin regla aplicable. */
export async function getFallbackCategoryId(userId: string): Promise<string | null> {
  const fallback = await prisma.category.findFirst({
    where: { userId, slug: 'otros' },
    select: { id: true },
  });
  return fallback?.id ?? null;
}
