'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import type {
  Category,
  Expense,
  ExpenseListResponse,
  ExpenseSource,
} from '@/lib/types';
import {
  AlertIcon,
  ChevronDownIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from '@/components/icons';
import { useToast } from '@/components/toast';
import { CategoryIcon } from '@/components/category-icon';

/**
 * Listado de gastos: alta, edición, borrado y filtros.
 *
 * Es la pantalla que más se usa, así que está pensada para el caso de un dedo
 * sobre un móvil: el formulario de alta es una hoja inferior a pantalla
 * completa, los botones de acción tienen tamaño suficiente y no hay menús
 * desplegables anidados.
 */

const SOURCES: { value: ExpenseSource; label: string }[] = [
  { value: 'web', label: 'Manual' },
  { value: 'shortcut', label: 'Atajo' },
  { value: 'revolut', label: 'Revolut' },
];

const PAGE_SIZE = 30;

interface Filters {
  q: string;
  month: string;
  from: string;
  to: string;
  minAmount: string;
  maxAmount: string;
  source: string;
  categoryId: string;
  sort: string;
}

const EMPTY_FILTERS: Filters = {
  q: '',
  month: '',
  from: '',
  to: '',
  minAmount: '',
  maxAmount: '',
  source: '',
  categoryId: '',
  sort: 'date_desc',
};

export default function ExpensesPage() {
  const params = useSearchParams();
  const toast = useToast();

  const [items, setItems] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [creating, setCreating] = useState(params.get('nuevo') === '1');
  const [showFilters, setShowFilters] = useState(false);
  // Zona horaria del usuario: hace falta para mostrar y para enviar la fecha
  // del gasto. Se pide al servidor una vez; sin ella, editar la fecha de un
  // gasto lo desplazaría unas horas cada vez.
  const [timezone, setTimezone] = useState<string | null>(null);

  const query = useMemo(() => {
    const search = new URLSearchParams();
    if (filters.q) search.set('q', filters.q);
    if (filters.month) search.set('month', filters.month);
    if (filters.from) search.set('from', filters.from);
    if (filters.to) search.set('to', filters.to);
    // El usuario escribe "12,50" con coma decimal; el backend espera un
    // número con punto, así que se normaliza antes de montar la query.
    if (filters.minAmount) search.set('minAmount', filters.minAmount.trim().replace(',', '.'));
    if (filters.maxAmount) search.set('maxAmount', filters.maxAmount.trim().replace(',', '.'));
    if (filters.source) search.set('source', filters.source);
    if (filters.categoryId) search.set('categoryId', filters.categoryId);
    if (filters.sort !== 'date_desc') search.set('sort', filters.sort);
    search.set('limit', String(PAGE_SIZE));
    search.set('offset', String(offset));
    return search.toString();
  }, [filters, offset]);

  useEffect(() => {
    api
      .get<{ user: { timezone: string } }>('/api/auth/me')
      .then((data) => setTimezone(data.user.timezone))
      // Sin la zona del usuario no se puede abrir la hoja de edición sin
      // arriesgarse a desplazar la fecha. Se cae en la misma zona por defecto
      // que usa el servidor al registrar, que es el mejor dato disponible.
      .catch(() => setTimezone('Europe/Madrid'));
    api.get<CategoryListResponseLike>('/api/categories').then((data) => {
      setCategories(data.categories);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // `q` retrasa la petición 300 ms: sin esto, teclear "Mercadona" dispara
    // ocho peticiones, una por letra.
    const timer = window.setTimeout(() => {
      api
        .get<ExpenseListResponse>(`/api/expenses?${query}`)
        .then((data) => {
          if (!alive) return;
          setItems(data.items);
          setTotal(data.pagination.total);
          setError(null);
        })
        .catch((caught) => {
          if (alive) {
            setError(caught instanceof Error ? caught.message : 'No se pudo cargar la lista.');
          }
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, filters.q ? 300 : 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, filters.q]);

  const reload = useCallback(async () => {
    const data = await api.get<ExpenseListResponse>(`/api/expenses?${query}`);
    setItems(data.items);
    setTotal(data.pagination.total);
  }, [query]);

  async function remove(expense: Expense) {
    const label = expense.merchant ?? expense.description ?? 'este gasto';
    if (!window.confirm(`¿Borrar ${label} (${expense.amountFormatted})? No se puede deshacer.`)) {
      return;
    }
    try {
      await api.delete(`/api/expenses/${expense.id}`);
      toast.success('Gasto borrado.');
      await reload();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'No se pudo borrar.');
    }
  }

  const activeFilterCount = [
    filters.q,
    filters.month,
    filters.from,
    filters.to,
    filters.minAmount,
    filters.maxAmount,
    filters.source,
    filters.categoryId,
  ].filter(Boolean).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Gastos</h1>
          <p className="text-sm text-text-muted">
            {loading ? 'Cargando…' : `${total} ${total === 1 ? 'gasto' : 'gastos'}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowFilters((open) => !open)}
            className="btn btn-secondary"
            aria-expanded={showFilters}
          >
            Filtros
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-accent px-1.5 text-xs text-accent-text">
                {activeFilterCount}
              </span>
            )}
            <ChevronDownIcon
              className={showFilters ? 'rotate-180 transition-transform' : 'transition-transform'}
            />
          </button>
          <button type="button" onClick={() => setCreating(true)} className="btn btn-primary">
            <PlusIcon />
            <span className="hidden sm:inline">Nuevo gasto</span>
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="card space-y-3 p-4">
          <div>
            <label htmlFor="q" className="mb-1 block text-sm font-medium">
              Buscar
            </label>
            <input
              id="q"
              className="field"
              placeholder="Comercio o descripción"
              value={filters.q}
              onChange={(event) => {
                setFilters((f) => ({ ...f, q: event.target.value }));
                setOffset(0);
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label htmlFor="month" className="mb-1 block text-sm font-medium">
                Mes
              </label>
              <input
                id="month"
                type="month"
                className="field"
                value={filters.month}
                onChange={(event) => {
                  setFilters((f) => ({ ...f, month: event.target.value }));
                  setOffset(0);
                }}
              />
            </div>
            <div>
              <label htmlFor="source" className="mb-1 block text-sm font-medium">
                Origen
              </label>
              <select
                id="source"
                className="field"
                value={filters.source}
                onChange={(event) => {
                  setFilters((f) => ({ ...f, source: event.target.value }));
                  setOffset(0);
                }}
              >
                <option value="">Todos</option>
                {SOURCES.map((source) => (
                  <option key={source.value} value={source.value}>
                    {source.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="categoryId" className="mb-1 block text-sm font-medium">
                Categoría
              </label>
              <select
                id="categoryId"
                className="field"
                value={filters.categoryId}
                onChange={(event) => {
                  setFilters((f) => ({ ...f, categoryId: event.target.value }));
                  setOffset(0);
                }}
              >
                <option value="">Todas</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sort" className="mb-1 block text-sm font-medium">
                Orden
              </label>
              <select
                id="sort"
                className="field"
                value={filters.sort}
                onChange={(event) => setFilters((f) => ({ ...f, sort: event.target.value }))}
              >
                <option value="date_desc">Más recientes</option>
                <option value="date_asc">Más antiguos</option>
                <option value="amount_desc">Importe: mayor a menor</option>
                <option value="amount_asc">Importe: menor a mayor</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label htmlFor="from" className="mb-1 block text-sm font-medium">
                Desde
              </label>
              <input
                id="from"
                type="date"
                className="field"
                value={filters.from}
                onChange={(event) => {
                  setFilters((f) => ({ ...f, from: event.target.value }));
                  setOffset(0);
                }}
              />
            </div>
            <div>
              <label htmlFor="to" className="mb-1 block text-sm font-medium">
                Hasta
              </label>
              <input
                id="to"
                type="date"
                className="field"
                value={filters.to}
                onChange={(event) => {
                  setFilters((f) => ({ ...f, to: event.target.value }));
                  setOffset(0);
                }}
              />
            </div>
            <div>
              <label htmlFor="minAmount" className="mb-1 block text-sm font-medium">
                Importe mín.
              </label>
              <input
                id="minAmount"
                className="field"
                inputMode="decimal"
                placeholder="0,00"
                value={filters.minAmount}
                onChange={(event) => {
                  setFilters((f) => ({ ...f, minAmount: event.target.value }));
                  setOffset(0);
                }}
              />
            </div>
            <div>
              <label htmlFor="maxAmount" className="mb-1 block text-sm font-medium">
                Importe máx.
              </label>
              <input
                id="maxAmount"
                className="field"
                inputMode="decimal"
                placeholder="sin límite"
                value={filters.maxAmount}
                onChange={(event) => {
                  setFilters((f) => ({ ...f, maxAmount: event.target.value }));
                  setOffset(0);
                }}
              />
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setOffset(0);
              }}
              className="btn btn-secondary"
            >
              <XIcon />
              Quitar filtros
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="card flex items-start gap-3 p-4 text-negative">
          <AlertIcon className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="card divide-y divide-border">
        {items.length === 0 && !loading ? (
          <p className="px-4 py-10 text-center text-sm text-text-muted">
            {activeFilterCount > 0
              ? 'Ningún gasto coincide con los filtros.'
              : 'Todavía no hay gastos. Añade uno con el botón de arriba.'}
          </p>
        ) : (
          items.map((expense) => (
            <article key={expense.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-base"
                style={{
                  color: expense.category?.color ?? 'var(--color-text-subtle)',
                }}
                aria-hidden="true"
              >
                <CategoryIcon name={expense.category?.icon} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {expense.merchant ?? expense.description ?? 'Sin comercio'}
                </p>
                <p className="truncate text-xs text-text-subtle">
                  {expense.expenseDateLocal}
                  {' · '}
                  {SOURCES.find((s) => s.value === expense.source)?.label ?? expense.source}
                  {expense.category && ` · ${expense.category.name}`}
                  {expense.edited && ' · editado'}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold">
                {expense.amountFormatted}
              </span>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => setEditing(expense)}
                  className="btn btn-secondary px-2 py-2"
                  aria-label={`Editar ${expense.merchant ?? 'gasto'}`}
                >
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  onClick={() => remove(expense)}
                  className="btn btn-danger px-2 py-2"
                  aria-label={`Borrar ${expense.merchant ?? 'gasto'}`}
                >
                  <TrashIcon />
                </button>
              </div>
            </article>
          ))
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
          >
            Anteriores
          </button>
          <span className="text-text-muted">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((value) => value + PAGE_SIZE)}
          >
            Siguientes
          </button>
        </div>
      )}

      {(creating || editing) && timezone && (
        <ExpenseSheet
          expense={editing}
          categories={categories}
          timezone={timezone}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async (message) => {
            setCreating(false);
            setEditing(null);
            toast.success(message);
            await reload();
          }}
        />
      )}
    </div>
  );
}

type CategoryListResponseLike = { categories: Category[] };

/**
 * Instante ISO → valor de `<input type="datetime-local">`.
 *
 * El valor del input es hora de pared sin desfase (`2026-09-28T00:32`), así que
 * hay que formatear en la zona horaria del usuario y no en la del navegador:
 * si el iPhone está de viaje, la fecha que se ve y la que se envía deben ser
 * las mismas que ya mostraba la lista.
 */
function toDatetimeLocalValue(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  // Medianoche puede venir como "24" según el runtime.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/**
 * Hoja de alta y edición.
 *
 * Monta y desmonta en vez de reutilizarse entre operaciones: así cada alta
 * arranca con el formulario limpio sin tener que resetear dozen campos a mano
 * en un `useEffect`, que es donde suelen quedar valores del gasto anterior.
 */
function ExpenseSheet({
  expense,
  categories,
  timezone,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  categories: Category[];
  timezone: string;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const isEdit = expense !== null;
  const toast = useToast();

  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [merchant, setMerchant] = useState(expense?.merchant ?? '');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [categoryId, setCategoryId] = useState(expense?.category?.id ?? '');
  // Valor con el que se abrió la hoja. Sirve para enviar la fecha sólo si el
  // usuario la ha tocado: si no, editar el comercio de un gasto de Revolut
  // reescribiría su zona horaria de origen por la del usuario.
  const [initialWhen] = useState(() =>
    toDatetimeLocalValue(expense?.expenseDate ?? new Date().toISOString(), timezone),
  );
  const [when, setWhen] = useState(initialWhen);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Cerrar con Escape es lo que espera cualquiera que haya usado un diálogo.
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
    setErrors({});

    const body: Record<string, unknown> = {
      // Se manda texto, no número: el usuario escribe "12,50" con coma y el
      // navegador no lo parsearía bien si se intentara en el onChange.
      amount: amount.trim().replace(',', '.'),
      merchant: merchant.trim() || undefined,
      description: description.trim() || undefined,
      categoryId: categoryId || undefined,
    };

    // Hora de pared sin desfase, con la zona declarada: el servidor la
    // interpreta en esa zona y guarda el instante UTC. En edición sólo se
    // manda si el usuario ha cambiado la fecha o la hora.
    if (!isEdit || when !== initialWhen) {
      body.created_at = when;
      body.timezone = timezone;
    }

    try {
      if (isEdit && expense) {
        await api.patch(`/api/expenses/${expense.id}`, body);
        await onSaved('Gasto actualizado.');
      } else {
        const result = await api.post<{ status?: string }>('/api/expenses', body);
        await onSaved(
          result.status === 'duplicate'
            ? 'Ya estaba registrado: no se ha duplicado.'
            : 'Gasto guardado.',
        );
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fields = caught.fieldErrors;
        if (Object.keys(fields).length > 0) setErrors(fields);
        else toast.error(caught.message);
      }
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
        className="card max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-b-none p-5 sm:rounded-b-card"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{isEdit ? 'Editar gasto' : 'Nuevo gasto'}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-subtle hover:text-text"
            aria-label="Cerrar"
          >
            <XIcon />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="amount" className="mb-1 block text-sm font-medium">
              Importe
            </label>
            <input
              id="amount"
              className="field text-lg"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              autoFocus
              required
            />
            {errors.amount && <p className="mt-1 text-xs text-negative">{errors.amount}</p>}
          </div>

          <div>
            <label htmlFor="merchant" className="mb-1 block text-sm font-medium">
              Comercio
            </label>
            <input
              id="merchant"
              className="field"
              placeholder="Dónde gastaste"
              value={merchant}
              onChange={(event) => setMerchant(event.target.value)}
            />
            {errors.merchant && <p className="mt-1 text-xs text-negative">{errors.merchant}</p>}
          </div>

          <div>
            <label htmlFor="categoryId" className="mb-1 block text-sm font-medium">
              Categoría
            </label>
            <select
              id="categoryId"
              className="field"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">Automática</option>
              {categories
                .filter((category) => !category.isArchived)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-xs text-text-subtle">
              Si lo dejas en automática, se aplica la regla que corresponda al comercio.
            </p>
          </div>

          <div>
            <label htmlFor="description" className="mb-1 block text-sm font-medium">
              Nota
            </label>
            <input
              id="description"
              className="field"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="when" className="mb-1 block text-sm font-medium">
              Fecha y hora
            </label>
            <input
              id="when"
              type="datetime-local"
              className="field"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
            />
            {errors.created_at && <p className="mt-1 text-xs text-negative">{errors.created_at}</p>}
            <p className="mt-1 text-xs text-text-subtle">
              {isEdit ? 'Tócala sólo si la fecha del gasto estaba mal.' : 'Por ahora, la hora actual.'}
            </p>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary flex-1" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary flex-1" disabled={busy}>
            {busy && <span className="spinner" />}
            {isEdit ? 'Guardar' : 'Añadir'}
          </button>
        </div>
      </form>
    </div>
  );
}
