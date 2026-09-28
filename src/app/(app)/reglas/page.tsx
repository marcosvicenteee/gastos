'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import type {
  Category,
  MerchantRule,
  MerchantRuleListResponse,
  NotificationRule,
  NotificationRuleListResponse,
  NotificationTestResult,
} from '@/lib/types';
import {
  AlertIcon,
  CheckIcon,
  PlusIcon,
  TrashIcon,
  WandIcon,
  XIcon,
} from '@/components/icons';
import { useToast } from '@/components/toast';

/**
 * Reglas de categorización y de interpretación de notificaciones.
 *
 * Son dos mecanismos distintos y conviene no mezclarlos en la interfaz:
 *
 * - Las reglas de comercio actúan antes de guardar un gasto, y se aplican al
 *   texto que escribe la persona o el Atajo.
 * - Las reglas de notificación actúan sobre el texto literal de la
 *   notificación de Revolut, antes de que exista ningún gasto.
 *
 * La diferencia importa al diagnosear: si un gasto mal clasificado viene del
 * Atajo de Revolut, el culpable es la segunda lista, no la primera.
 */

const MATCH_LABELS: Record<MerchantRule['matchType'], string> = {
  contains: 'contiene',
  exact: 'es exactamente',
  regex: 'expresión regular',
};

export default function RulesPage() {
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [notificationRules, setNotificationRules] = useState<NotificationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingMerchant, setCreatingMerchant] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    const [cats, merchants, notifications] = await Promise.all([
      api.get<{ categories: Category[] }>('/api/categories'),
      api.get<MerchantRuleListResponse>('/api/merchant-rules'),
      api.get<NotificationRuleListResponse>('/api/notification-rules'),
    ]);
    setCategories(cats.categories);
    setMerchantRules(merchants.rules);
    setNotificationRules(notifications.rules);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((caught) =>
      toast.error(caught instanceof Error ? caught.message : 'No se pudieron cargar.'),
    );
  }, [load, toast]);

  async function toggleMerchant(rule: MerchantRule) {
    try {
      await api.patch(`/api/merchant-rules/${rule.id}`, { isEnabled: !rule.isEnabled });
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'No se pudo actualizar.');
    }
  }

  async function removeMerchant(rule: MerchantRule) {
    if (!window.confirm(`¿Borrar la regla "${rule.pattern}"?`)) return;
    try {
      await api.delete(`/api/merchant-rules/${rule.id}`);
      toast.success('Regla borrada.');
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'No se pudo borrar.');
    }
  }

  async function toggleNotification(rule: NotificationRule) {
    try {
      await api.patch(`/api/notification-rules/${rule.id}`, { isEnabled: !rule.isEnabled });
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'No se pudo actualizar.');
    }
  }

  async function removeNotification(rule: NotificationRule) {
    if (!window.confirm(`¿Borrar la regla "${rule.name}"?`)) return;
    try {
      await api.delete(`/api/notification-rules/${rule.id}`);
      toast.success('Regla borrada.');
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'No se pudo borrar.');
    }
  }

  if (loading) {
    return <p className="text-sm text-text-muted">Cargando reglas…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Reglas</h1>
        <p className="text-sm text-text-muted">
          Automatiza la clasificación y la lectura de las notificaciones.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-subtle">
            Comercios
          </h2>
          <button
            type="button"
            onClick={() => setCreatingMerchant(true)}
            className="btn btn-secondary"
          >
            <PlusIcon />
            Nueva
          </button>
        </div>
        <div className="card divide-y divide-border">
          {merchantRules.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-text-muted">
              Sin reglas. Cada gasto nuevo quedará sin categoría.
            </p>
          )}
          {merchantRules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {rule.pattern}
                  {rule.matchType !== 'contains' && (
                    <span className="ml-2 text-xs font-normal text-text-subtle">
                      {MATCH_LABELS[rule.matchType]}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-text-subtle">
                  → {rule.category?.name ?? 'sin categoría'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggleMerchant(rule)}
                className="btn btn-secondary px-2 py-2"
                aria-label={rule.isEnabled ? `Desactivar ${rule.pattern}` : `Activar ${rule.pattern}`}
                title={rule.isEnabled ? 'Activa' : 'Desactivada'}
              >
                <CheckIcon className={rule.isEnabled ? '' : 'opacity-30'} />
              </button>
              <button
                type="button"
                onClick={() => removeMerchant(rule)}
                className="btn btn-danger px-2 py-2"
                aria-label={`Borrar ${rule.pattern}`}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-subtle">
          Notificaciones
        </h2>
        <div className="card divide-y divide-border">
          {notificationRules.map((rule) => (
            <div key={rule.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {rule.name}
                  {!rule.isExpense && (
                    <span className="ml-2 text-xs font-normal text-text-subtle">no es gasto</span>
                  )}
                  {!rule.isEnabled && (
                    <span className="ml-2 text-xs font-normal text-text-subtle">desactivada</span>
                  )}
                </p>
                <code className="mt-1 block truncate text-xs text-text-subtle">
                  {rule.match}
                </code>
              </div>
              <button
                type="button"
                onClick={() => toggleNotification(rule)}
                className="btn btn-secondary px-2 py-2"
                aria-label={rule.isEnabled ? `Desactivar ${rule.name}` : `Activar ${rule.name}`}
              >
                <CheckIcon className={rule.isEnabled ? '' : 'opacity-30'} />
              </button>
              <button
                type="button"
                onClick={() => removeNotification(rule)}
                className="btn btn-danger px-2 py-2"
                aria-label={`Borrar ${rule.name}`}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setTesting(true)} className="btn btn-secondary">
          <WandIcon />
          Probar con un texto real
        </button>
      </section>

      {creatingMerchant && (
        <MerchantRuleSheet
          categories={categories}
          onClose={() => setCreatingMerchant(false)}
          onSaved={async (message) => {
            setCreatingMerchant(false);
            toast.success(message);
            await load();
          }}
        />
      )}

      {testing && (
        <TestSheet
          onClose={() => setTesting(false)}
        />
      )}
    </div>
  );
}

function MerchantRuleSheet({
  categories,
  onClose,
  onSaved,
}: {
  categories: Category[];
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState<MerchantRule['matchType']>('contains');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
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
      await api.post('/api/merchant-rules', {
        pattern: pattern.trim(),
        matchType,
        categoryId,
      });
      await onSaved('Regla creada.');
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
        className="card w-full max-w-md p-5"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Nueva regla de comercio</h2>
          <button type="button" onClick={onClose} className="text-text-subtle" aria-label="Cerrar">
            <XIcon />
          </button>
        </div>

        <label htmlFor="pattern" className="mb-1 block text-sm font-medium">
          Texto a detectar
        </label>
        <input
          id="pattern"
          className="field"
          placeholder="Mercadona"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          autoFocus
          required
        />

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="matchType" className="mb-1 block text-sm font-medium">
              Coincidencia
            </label>
            <select
              id="matchType"
              className="field"
              value={matchType}
              onChange={(event) => setMatchType(event.target.value as MerchantRule['matchType'])}
            >
              <option value="contains">contiene</option>
              <option value="exact">exacta</option>
              <option value="regex">regex</option>
            </select>
          </div>
          <div>
            <label htmlFor="ruleCat" className="mb-1 block text-sm font-medium">
              Categoría
            </label>
            <select
              id="ruleCat"
              className="field"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              {categories
                .filter((category) => !category.isArchived)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </div>
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
          <button
            type="submit"
            className="btn btn-primary flex-1"
            disabled={busy || !pattern.trim() || !categoryId}
          >
            {busy && <span className="spinner" />}
            Crear
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Simulador de notificaciones.
 *
 * Manda el texto tal cual llegaría de iOS y enseña qué regla casaría y qué
 * gasto se crearía, sin escribir nada. Es la única forma razonable de ajustar
 * expresiones regulares sin depender de que el banco mande una notificación
 * de prueba cuando a uno le apetece.
 */
function TestSheet({ onClose }: { onClose: () => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NotificationTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busy || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<NotificationTestResult>('/api/notification-rules/test', {
        app: 'Revolut',
        body: body.trim(),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo probar.');
    } finally {
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
      <div
        className="card w-full max-w-md p-5"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Probar una notificación</h2>
          <button type="button" onClick={onClose} className="text-text-subtle" aria-label="Cerrar">
            <XIcon />
          </button>
        </div>

        <label htmlFor="sample" className="mb-1 block text-sm font-medium">
          Texto de la notificación
        </label>
        <textarea
          id="sample"
          className="field min-h-24 resize-y"
          placeholder="Pago de 12,50 € en Mercadona"
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setResult(null);
          }}
        />
        <p className="mt-1 text-xs text-text-subtle">
          No se guarda nada: sólo se muestra qué regla se aplicaría.
        </p>

        {error && <p className="mt-3 text-sm text-negative">{error}</p>}

        {result && (
          <div className="mt-4 space-y-2 rounded-lg border border-border p-3 text-sm">
            <p>
              <span className="text-text-subtle">Resultado: </span>
              {result.outcome.kind === 'expense'
                ? 'se crearía un gasto'
                : result.outcome.kind === 'not_an_expense'
                  ? 'se ignoraría, no es un gasto'
                  : 'no se reconoce el formato'}
            </p>
            <p>
              <span className="text-text-subtle">Regla: </span>
              {result.outcome.ruleName ?? 'ninguna (se usaría la heurística)'}
            </p>
            <p>
              <span className="text-text-subtle">Importe: </span>
              {result.outcome.amount
                ? `${result.outcome.amount} ${result.outcome.currency ?? ''}`.trim()
                : 'no detectado'}
            </p>
            <p>
              <span className="text-text-subtle">Comercio: </span>
              {result.outcome.merchant ?? 'no detectado'}
            </p>
            {result.diagnostics.wouldMatchDifferentRule && (
              <p className="text-warning">
                Ojo: casaría con una regla que está desactivada.
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary flex-1" disabled={busy}>
            Cerrar
          </button>
          <button
            type="button"
            onClick={run}
            className="btn btn-primary flex-1"
            disabled={busy || !body.trim()}
          >
            {busy && <span className="spinner" />}
            Probar
          </button>
        </div>
      </div>
    </div>
  );
}
