'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import type { DeviceToken, DeviceTokenListResponse, Profile, ProfileResponse } from '@/lib/types';
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  PhoneIcon,
  TrashIcon,
} from '@/components/icons';
import { useToast } from '@/components/toast';

/**
 * Ajustes: perfil, tokens de dispositivo y atajo de iPhone.
 *
 * El token del dispositivo se muestra una única vez, aquí, y no vuelve a
 * aparecer nunca. Si la persona lo pierde genera otro; por eso el aviso dice
 * "solo se muestra una vez" en vez de "cópialo" como si fuese a poder
 * consultarlo después.
 */

const TIMEZONES = [
  'Europe/Madrid',
  'Atlantic/Canary',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/Mexico_City',
  'America/Bogota',
  'America/Argentina/Buenos_Aires',
  'America/Santiago',
  'UTC',
];

export default function SettingsPage() {
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tokens, setTokens] = useState<DeviceToken[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [timezone, setTimezone] = useState('Europe/Madrid');
  const [savingProfile, setSavingProfile] = useState(false);

  const [label, setLabel] = useState('iPhone');
  const [issuing, setIssuing] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [me, list] = await Promise.all([
      api.get<ProfileResponse>('/api/profile'),
      api.get<DeviceTokenListResponse>('/api/device-tokens'),
    ]);
    setProfile(me.user);
    setName(me.user.name ?? '');
    setCurrency(me.user.currency);
    setTimezone(me.user.timezone);
    setTokens(list.tokens);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((caught) =>
      toast.error(caught instanceof Error ? caught.message : 'No se pudo cargar.'),
    );
  }, [load, toast]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (savingProfile) return;
    setSavingProfile(true);
    try {
      const result = await api.patch<ProfileResponse>('/api/profile', {
        name: name.trim(),
        currency,
        timezone,
      });
      setProfile(result.user);
      toast.success('Perfil guardado.');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'No se pudo guardar.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function issueToken(event: React.FormEvent) {
    event.preventDefault();
    if (issuing) return;
    setIssuing(true);
    try {
      const result = await api.post<{ token: string }>('/api/device-tokens', {
        label: label.trim(),
      });
      setFreshToken(result.token);
      setLabel('iPhone');
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'No se pudo generar el token.');
    } finally {
      setIssuing(false);
    }
  }

  async function revokeToken(token: DeviceToken) {
    if (!window.confirm(`¿Revocar el token de "${token.label}"? El Atajo dejará de funcionar.`)) {
      return;
    }
    try {
      await api.delete(`/api/device-tokens/${token.id}`);
      toast.success('Token revocado.');
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'No se pudo revocar.');
    }
  }

  async function copy(value: string, what: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${what} copiado.`);
    } catch {
      toast.error('No se pudo copiar. Cópialo a mano.');
    }
  }

  if (loading || !profile) {
    return <p className="text-sm text-text-muted">Cargando ajustes…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Ajustes</h1>
        <p className="text-sm text-text-muted">{profile.email}</p>
      </div>

      <form onSubmit={saveProfile} className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-subtle">Perfil</h2>
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">
            Nombre
          </label>
          <input
            id="name"
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="currency" className="mb-1 block text-sm font-medium">
              Moneda
            </label>
            <select
              id="currency"
              className="field"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {['EUR', 'USD', 'GBP', 'MXN', 'COP', 'ARS', 'CLP'].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="timezone" className="mb-1 block text-sm font-medium">
              Zona horaria
            </label>
            <select
              id="timezone"
              className="field"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              {/* Puede haber una zona guardada que no esté en la lista corta. */}
              {!TIMEZONES.includes(timezone) && <option value={timezone}>{timezone}</option>}
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-text-subtle">
          La zona horaria decide dónde caen los días y los meses de tus estadísticas.
        </p>
        <button type="submit" className="btn btn-primary" disabled={savingProfile}>
          {savingProfile && <span className="spinner" />}
          Guardar perfil
        </button>
      </form>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-subtle">
          Atajo de iPhone
        </h2>

        <form onSubmit={issueToken} className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1">
            <label htmlFor="label" className="mb-1 block text-sm font-medium">
              Nombre del dispositivo
            </label>
            <input
              id="label"
              className="field"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={issuing || !label.trim()}>
            {issuing && <span className="spinner" />}
            <PhoneIcon />
            Generar token
          </button>
        </form>

        {freshToken && (
          <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <p className="text-sm font-medium">
              Copia este token ahora: no se vuelve a mostrar.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs">
                {freshToken}
              </code>
              <button
                type="button"
                onClick={() => copy(freshToken, 'Token')}
                className="btn btn-secondary"
                aria-label="Copiar token"
              >
                <CopyIcon />
              </button>
            </div>
          </div>
        )}

        {tokens.length > 0 && (
          <div className="divide-y divide-border">
            {tokens.map((token) => (
              <div key={token.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{token.label}</p>
                  <p className="truncate text-xs text-text-subtle">
                    {token.hint} ·{' '}
                    {token.lastUsedAt
                      ? `usado ${new Date(token.lastUsedAt).toLocaleDateString('es-ES')}`
                      : 'sin usar'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => revokeToken(token)}
                  className="btn btn-danger px-2 py-2"
                  aria-label={`Revocar ${token.label}`}
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        <ol className="list-decimal space-y-1 pl-5 text-sm text-text-muted">
          <li>Abre Atajos y crea un atajo nuevo con el disparador «Notificación recibida».</li>
          <li>Añade «Obtener texto de la notificación recibida».</li>
          <li>
            Pega el token en <code className="text-xs">gk_…</code> y llama a{' '}
            <code className="text-xs">POST /api/ingest/notification</code> con{' '}
            <code className="text-xs">Authorization: Bearer …</code>.
          </li>
          <li>Elige la categoría con <code className="text-xs">GET /api/categories/options</code>.</li>
        </ol>
        <p className="flex items-start gap-2 text-xs text-text-subtle">
          <AlertIcon className="mt-0.5 shrink-0" />
          El disparador de notificaciones requiere iOS 27 o posterior. En versiones anteriores la
          app sigue funcionando, pero no hay captura automática.
        </p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-subtle">
          Exportar
        </h2>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/export?format=csv"
            className="btn btn-secondary"
            target="_blank"
            rel="noreferrer"
          >
            <DownloadIcon />
            CSV
          </a>
          <a
            href="/api/export?format=xlsx"
            className="btn btn-secondary"
            target="_blank"
            rel="noreferrer"
          >
            <DownloadIcon />
            Excel
          </a>
          <a
            href="/api/export?format=json"
            className="btn btn-secondary"
            target="_blank"
            rel="noreferrer"
          >
            <DownloadIcon />
            JSON
          </a>
        </div>
        <p className="flex items-start gap-2 text-xs text-text-subtle">
          <CheckIcon className="mt-0.5 shrink-0" />
          La exportación se genera en el servidor, con tus datos y tu zona horaria.
        </p>
      </section>
    </div>
  );
}
