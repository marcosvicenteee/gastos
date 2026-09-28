'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import type { Category, CategoryListResponse } from '@/lib/types';
import {
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from '@/components/icons';
import { useToast } from '@/components/toast';

/**
 * Gestión de categorías.
 *
 * Dos decisiones que condicionan la interfaz:
 *
 * - Borrar nunca reasigna gastos por sorpresa. La API devuelve 409 si la
 *   categoría tiene gastos, así que aquí se pide explícitamente a dónde van.
 * - Archivadas siguen visibles y son editables, pero no se ofrecen al Atajo.
 *   Es el equivalente a "retirar sin perder el historial".
 */

/** Paleta sobria: colores distinguibles y con contraste suficiente en ambos temas. */
const PALETTE = [
  '#F97316',
  '#22C55E',
  '#3B82F6',
  '#A855F7',
  '#EC4899',
  '#EAB308',
  '#14B8A6',
  '#EF4444',
  '#6366F1',
  '#64748B',
];

export default function CategoriesPage() {
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api.get<CategoryListResponse>('/api/categories?includeArchived=true');
    setCategories(data.categories);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((caught) =>
      toast.error(caught instanceof Error ? caught.message : 'No se pudieron cargar.'),
    );
  }, [load, toast]);

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;
    const ids = categories.map((category) => category.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    // Se pinta el cambio antes de confirmar con el servidor: reordenar es una
    // acción reversible y esperar hace que el botón parezca roto.
    setCategories((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    try {
      await api.post('/api/categories/reorder', { ids });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'No se pudo reordenar.');
      await load();
    }
  }

  async function toggleArchived(category: Category) {
    setBusyId(category.id);
    try {
      await api.patch(`/api/categories/${category.id}`, {
        isArchived: !category.isArchived,
      });
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'No se pudo actualizar.');
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Borrado con decisión explícita del destino.
   *
   * Se usa `prompt` en lugar de un diálogo propio a propósito: es el camino
   * más corto para una acción destructiva puntual y no merece un componente
   * con estado, foco atrapado y bloqueo de scroll.
   */
  async function remove(category: Category) {
    const others = categories.filter(
      (item) => item.id !== category.id && !item.isArchived,
    );
    const message =
      category.expenseCount > 0
        ? `"${category.name}" tiene ${category.expenseCount} gastos.\n\n` +
          'Escribe el nombre de una categoría activa a la que quieras moverlos.'
        : `¿Borrar "${category.name}"?`;

    const answer = window.prompt(message);
    if (answer === null) return;

    const destination =
      category.expenseCount > 0
        ? others.find(
            (item) => item.name.toLowerCase() === answer.trim().toLowerCase(),
          )
        : undefined;

    if (category.expenseCount > 0 && !destination) {
      if (answer.trim() === '') {
        toast.error('Indica la categoría destino o cancela.');
      } else {
        toast.error(`No existe ninguna categoría llamada "${answer.trim()}".`);
      }
      return;
    }

    setBusyId(category.id);
    try {
      await api.delete(`/api/categories/${category.id}`, {
        moveExpensesTo: destination?.id,
      });
      toast.success(
        destination
          ? `Categoría borrada. Los gastos están en ${destination.name}.`
          : 'Categoría borrada.',
      );
      setEditing(null);
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'No se pudo borrar.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-text-muted">Cargando categorías…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Categorías</h1>
          <p className="text-sm text-text-muted">
            {categories.filter((c) => !c.isArchived).length} activas ·{' '}
            {categories.filter((c) => c.isArchived).length} archivadas
          </p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="btn btn-primary">
          <PlusIcon />
          <span className="hidden sm:inline">Nueva</span>
        </button>
      </div>

      <div className="card divide-y divide-border">
        {categories.map((category, index) => (
          <div
            key={category.id}
            className={category.isArchived ? 'flex items-center gap-3 px-4 py-3 opacity-60' : 'flex items-center gap-3 px-4 py-3'}
          >
            <span
              className="h-8 w-8 shrink-0 rounded-lg"
              style={{ backgroundColor: category.color }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {category.name}
                {category.isArchived && (
                  <span className="ml-2 text-xs font-normal text-text-subtle">archivada</span>
                )}
              </p>
              <p className="truncate text-xs text-text-subtle">
                {category.expenseCount} {category.expenseCount === 1 ? 'gasto' : 'gastos'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0 || busyId === category.id}
                className="btn btn-secondary px-2 py-2"
                aria-label={`Subir ${category.name}`}
              >
                <ChevronDownIcon className="rotate-180" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === categories.length - 1 || busyId === category.id}
                className="btn btn-secondary px-2 py-2"
                aria-label={`Bajar ${category.name}`}
              >
                <ChevronDownIcon />
              </button>
              <button
                type="button"
                onClick={() => setEditing(category)}
                className="btn btn-secondary px-2 py-2"
                aria-label={`Editar ${category.name}`}
              >
                <PencilIcon />
              </button>
              <button
                type="button"
                onClick={() => toggleArchived(category)}
                disabled={busyId === category.id}
                className="btn btn-secondary px-2 py-2"
                aria-label={
                  category.isArchived ? `Reactivar ${category.name}` : `Archivar ${category.name}`
                }
              >
                <CheckIcon />
              </button>
              <button
                type="button"
                onClick={() => remove(category)}
                disabled={busyId === category.id}
                className="btn btn-danger px-2 py-2"
                aria-label={`Borrar ${category.name}`}
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        ))}
      </div>

      {(creating || editing) && (
        <CategorySheet
          category={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async (message) => {
            setCreating(false);
            setEditing(null);
            toast.success(message);
            await load();
          }}
        />
      )}
    </div>
  );
}

function CategorySheet({
  category,
  onClose,
  onSaved,
}: {
  category: Category | null;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const isEdit = category !== null;
  const [name, setName] = useState(category?.name ?? '');
  const [color, setColor] = useState(category?.color ?? PALETTE[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isEdit && category) {
        await api.patch(`/api/categories/${category.id}`, { name: name.trim(), color });
        await onSaved('Categoría actualizada.');
      } else {
        await api.post('/api/categories', { name: name.trim(), color });
        await onSaved('Categoría creada.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar.');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="card w-full max-w-md p-5 sm:rounded-b-card"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {isEdit ? 'Editar categoría' : 'Nueva categoría'}
          </h2>
          <button type="button" onClick={onClose} className="text-text-subtle" aria-label="Cerrar">
            <XIcon />
          </button>
        </div>

        <label htmlFor="catName" className="mb-1 block text-sm font-medium">
          Nombre
        </label>
        <input
          id="catName"
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          required
        />

        <p className="mb-2 mt-4 text-sm font-medium">Color</p>
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setColor(option)}
              className="h-8 w-8 rounded-lg border-2"
              style={{
                backgroundColor: option,
                borderColor: option === color ? 'var(--color-text)' : 'transparent',
              }}
              aria-label={`Color ${option}`}
              aria-pressed={option === color}
            />
          ))}
        </div>

        {error && (
          <p className="mt-3 flex items-start gap-2 text-sm text-negative">
            <AlertIcon className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary flex-1" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary flex-1" disabled={busy || !name.trim()}>
            {busy && <span className="spinner" />}
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
