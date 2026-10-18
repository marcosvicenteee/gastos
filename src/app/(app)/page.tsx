'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import type { Expense, ExpenseListResponse, StatisticsResponse } from '@/lib/types';
import { formatMoney, formatPercent, formatRelative } from '@/lib/types';
import { CategoryDonut, MonthlyBars, TrendChart } from '@/components/charts';
import { AlertIcon, DownloadIcon, PlusIcon } from '@/components/icons';
import { CategoryIcon } from '@/components/category-icon';
import { useToast } from '@/components/toast';

/**
 * Pantalla de resumen.
 *
 * Responde a las dos preguntas que se hacen al abrir la aplicación: cuánto he
 * gastado y en qué. Por eso el orden es importe arriba y desglose debajo: si
 * están al revés, el usuario tiene que desplazarse para ver lo importante.
 *
 * Se piden las estadísticas y los últimos gastos en paralelo porque son
 * independientes; encadenarlos duplicaría el tiempo de espera.
 *
 * Estilo Apple: tarjetas blancas con radio 28px sobre fondo gris #f5f5f7,
 * tipografía con tracking negativo, sin sombras.
 */

const SOURCE_LABEL: Record<string, string> = {
  web: 'Manual',
  shortcut: 'Atajo',
  revolut: 'Revolut',
};

type TrendGranularity = 'day' | 'week' | 'month';

const TREND_LABELS: Record<TrendGranularity, { button: string; title: string }> = {
  day: { button: 'Día', title: 'Últimos 30 días con gasto' },
  week: { button: 'Semana', title: 'Últimas 12 semanas con gasto' },
  month: { button: 'Mes', title: 'Últimos 12 meses con gasto' },
};

export default function DashboardPage() {
  const toast = useToast();
  const [stats, setStats] = useState<StatisticsResponse | null>(null);
  const [recent, setRecent] = useState<Expense[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [granularity, setGranularity] = useState<TrendGranularity>('day');

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<StatisticsResponse>('/api/statistics'),
      api.get<ExpenseListResponse>('/api/expenses?limit=8'),
    ])
      .then(([statistics, expenses]) => {
        if (!alive) return;
        setStats(statistics);
        setRecent(expenses.items);
      })
      .catch((caught) => {
        if (alive) {
          setError(caught instanceof Error ? caught.message : 'No se pudo cargar el resumen.');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function exportCsv() {
    if (downloading) return;
    setDownloading(true);
    try {
      const { downloadFile } = await import('@/lib/client');
      await downloadFile('/api/export?format=csv', 'gastos.csv');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'No se pudo exportar.');
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-body text-slate">
        <span className="spinner" />
        Cargando resumen…
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="card flex items-start gap-3 p-5 text-body text-negative">
        <AlertIcon className="mt-0.5 shrink-0" width={20} height={20} />
        <div>
          <p className="font-medium">No se pudo cargar el resumen.</p>
          <p className="text-body-small text-slate">{error}</p>
        </div>
      </div>
    );
  }

  const { statistics, currency } = stats;
  const { totals } = statistics;
  const up = (totals.monthOverMonth ?? 0) > 0;
  const trendData =
    granularity === 'day'
      ? statistics.byDay
      : granularity === 'week'
        ? statistics.byWeek
        : statistics.byMonth;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-heading text-3xl text-ink">Resumen</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={downloading}
            className="btn btn-secondary"
          >
            {downloading ? <span className="spinner" /> : <DownloadIcon width={16} height={16} />}
            Exportar
          </button>
          <Link href="/gastos?nuevo=1" className="btn btn-primary">
            <PlusIcon width={16} height={16} />
            Nuevo gasto
          </Link>
        </div>
      </div>

      {totals.monthOverMonth === null ? (
        <p className="text-body text-slate">
          Este mes: <strong className="text-ink">{formatMoney(totals.month, currency)}</strong>
        </p>
      ) : (
        <p className="text-body text-slate">
          Este mes:{' '}
          <strong className="text-ink">{formatMoney(totals.month, currency)}</strong>{' '}
          <span className={up ? 'text-negative' : 'text-positive'}>
            {up ? '+' : ''}
            {formatPercent(totals.monthOverMonth)}
          </span>{' '}
          frente al mes anterior
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Hoy" value={formatMoney(totals.today, currency)} />
        <Stat label="Esta semana" value={formatMoney(totals.week, currency)} />
        <Stat
          label="Media diaria"
          value={formatMoney(totals.averagePerDay, currency)}
          hint={`${totals.monthCount} días`}
        />
        <Stat
          label="Gasto medio"
          value={formatMoney(totals.averagePerPayment, currency)}
          hint={`${totals.monthTransactions} gastos`}
        />
      </div>

      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-body-small font-medium text-slate">
            {TREND_LABELS[granularity].title}
          </h2>
          <div className="flex rounded-full border border-hairline-silver p-0.5" role="group" aria-label="Agrupación del gráfico">
            {(Object.keys(TREND_LABELS) as TrendGranularity[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setGranularity(key)}
                aria-pressed={granularity === key}
                className={`rounded-full px-3 py-1 text-caption transition-colors ${
                  granularity === key
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-slate hover:text-ink'
                }`}
              >
                {TREND_LABELS[key].button}
              </button>
            ))}
          </div>
        </div>
        {trendData.length === 0 ? (
          <Empty />
        ) : (
          <TrendChart data={trendData} currency={currency} />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 text-body-small font-medium text-slate">Por categoría</h2>
          {statistics.byCategory.length === 0 ? (
            <Empty />
          ) : (
            <>
              <CategoryDonut data={statistics.byCategory} currency={currency} />
              <ul className="mt-4 space-y-2">
                {statistics.byCategory.slice(0, 6).map((item) => (
                  <li key={item.categoryId ?? item.categoryName} className="flex items-center gap-2.5 text-body-small">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-ink">{item.categoryName}</span>
                    <span className="text-slate">{item.count}</span>
                    <span className="w-24 text-right font-medium text-ink">
                      {formatMoney(item.total, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-4 text-body-small font-medium text-slate">Por mes</h2>
          {statistics.byMonth.length === 0 ? (
            <Empty />
          ) : (
            <MonthlyBars data={statistics.byMonth} currency={currency} />
          )}
        </div>
      </div>

      <div className="card divide-y divide-hairline-silver">
        <div className="flex items-center justify-between p-5">
          <h2 className="text-body-small font-medium text-slate">Últimos gastos</h2>
          <Link href="/gastos" className="text-body-small font-medium text-apple-blue hover:underline">
            Ver todos
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 pb-5 text-body-small text-slate">Todavía no hay gastos.</p>
        ) : (
          <ul>
            {recent.map((expense) => (
              <li key={expense.id} className="flex items-center gap-3 px-5 py-3.5">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-studio-mist text-base"
                  style={{ color: expense.category?.color ?? 'var(--color-text-subtle)' }}
                  aria-hidden="true"
                >
                  <CategoryIcon name={expense.category?.icon} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-ink">
                    {expense.merchant ?? expense.description ?? 'Sin comercio'}
                  </p>
                  <p className="truncate text-caption text-steel">
                    {expense.category?.name ?? 'Sin categoría'} · {SOURCE_LABEL[expense.source]} ·{' '}
                    {formatRelative(expense.expenseDate)}
                  </p>
                </div>
                <span className="shrink-0 text-body font-medium text-ink">{expense.amountFormatted}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-caption text-slate">{label}</p>
      <p className="mt-1 text-heading text-xl text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-caption text-steel">{hint}</p>}
    </div>
  );
}

function Empty() {
  return (
    <p className="py-10 text-center text-body-small text-slate">
      Aún no hay datos suficientes para dibujar el gráfico.
    </p>
  );
}
