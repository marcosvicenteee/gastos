'use client';

import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CategoryBreakdown, TimeBucket } from '@/lib/types';
import { formatMoney } from '@/lib/types';

/**
 * Gráficos.
 *
 * Todos leen los colores de las variables CSS en tiempo de ejecución en lugar
 * de recibir props de color. Motivo: los colores de la interfaz ya están
 * definidos en un único sitio (el `globals.css`) y duplicarlos aquí
 * significaría que cambiar un tono obliga a acordarse de tocar también este
 * archivo. Además, leerlos con `getComputedStyle` hace que los gráficos
 * cambien solos al alternar el tema.
 */

interface Palette {
  accent: string;
  textMuted: string;
  border: string;
  surface: string;
  text: string;
}

function usePalette(): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(null);

  useEffect(() => {
    function read() {
      const styles = getComputedStyle(document.documentElement);
      const pick = (name: string, fallback: string) =>
        styles.getPropertyValue(name).trim() || fallback;
      setPalette({
        accent: pick('--color-accent', '#3B82F6'),
        textMuted: pick('--color-text-muted', '#64748B'),
        border: pick('--color-border', '#E2E8F0'),
        surface: pick('--color-surface', '#FFFFFF'),
        text: pick('--color-text', '#0F172A'),
      });
    }
    read();
    // El cambio de tema es un MutationObserver sobre la clase del <html>:
    // no existe un evento para "ha cambiado el tema", y un `resize` no serviría.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  return palette;
}

/** Colores de las series, derivados del acento para que nunca choquen. */
const SERIES = ['#3B82F6', '#22C55E', '#F97316', '#A855F7', '#EC4899', '#14B8A6', '#EAB308'];

function TooltipBox({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: { value?: number; name?: string }[];
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="card px-3 py-2 text-xs shadow-pop"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      {label && <p className="mb-0.5 font-medium">{label}</p>}
      {payload.map((entry, index) => (
        <p key={index} className="text-text-muted">
          {entry.name ? `${entry.name}: ` : ''}
          <span className="font-medium text-text">
            {formatMoney(Number(entry.value ?? 0), currency)}
          </span>
        </p>
      ))}
    </div>
  );
}

/** Evolución temporal: un área para leer la tendencia, no cada pico. */
export function TrendChart({
  data,
  currency,
  height = 220,
}: {
  data: TimeBucket[];
  currency: string;
  height?: number;
}) {
  const palette = usePalette();
  if (!palette) return <div style={{ height }} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="trend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.accent} stopOpacity={0.35} />
            <stop offset="100%" stopColor={palette.accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="key"
          tick={{ fill: palette.textMuted, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: palette.border }}
          interval="preserveStartEnd"
          minTickGap={16}
        />
        <YAxis
          tick={{ fill: palette.textMuted, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(value: number) => formatMoney(value, currency).replace(/[€]/, '')}
        />
        <Tooltip
          content={<TooltipBox currency={currency} />}
          cursor={{ stroke: palette.border }}
        />
        <Area
          type="monotone"
          dataKey="total"
          name="Gasto"
          stroke={palette.accent}
          strokeWidth={2}
          fill="url(#trend)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Comparativa por mes: barras, porque lo que interesa es comparar. */
export function MonthlyBars({
  data,
  currency,
  height = 200,
}: {
  data: TimeBucket[];
  currency: string;
  height?: number;
}) {
  const palette = usePalette();
  if (!palette) return <div style={{ height }} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
        <XAxis
          dataKey="key"
          tick={{ fill: palette.textMuted, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: palette.border }}
          interval={0}
        />
        <YAxis
          tick={{ fill: palette.textMuted, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(value: number) => formatMoney(value, currency).replace(/[€]/, '')}
        />
        <Tooltip
          content={<TooltipBox currency={currency} />}
          cursor={{ fill: palette.surface, opacity: 0.5 }}
        />
        <Bar dataKey="total" name="Gasto" fill={palette.accent} radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Reparto por categoría.
 *
 * Los colores son los que el usuario eligió para cada categoría, no los de la
 * paleta por defecto: en un gráfico de sectores, el color es la única vía para
 * distinguir dos porciones, y si no coincidiera con el de la lista el usuario
 * tendría que leer las etiquetas de cada sector.
 */
export function CategoryDonut({
  data,
  currency,
  size = 200,
}: {
  data: CategoryBreakdown[];
  currency: string;
  size?: number;
}) {
  const palette = usePalette();
  if (!palette) return <div style={{ height: size }} />;

  const total = data.reduce((sum, item) => sum + item.total, 0);

  return (
    <div className="relative" style={{ height: size }}>
      <ResponsiveContainer width="100%" height={size}>
        <PieChart>
          <Pie
            data={data}
            dataKey="total"
            nameKey="categoryName"
            innerRadius="62%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((item, index) => (
              <Cell key={item.categoryId ?? item.categoryName} fill={item.color || SERIES[index % SERIES.length]} />
            ))}
          </Pie>
          <Tooltip content={<TooltipBox currency={currency} />} />
        </PieChart>
      </ResponsiveContainer>
      {/* El total en el hueco del anillo: evita tener que buscarlo en el
          desglose de al lado. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-text-muted">Total</span>
        <span className="text-sm font-semibold">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}
