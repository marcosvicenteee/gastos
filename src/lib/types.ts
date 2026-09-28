/**
 * Tipos que viajan entre la API y el navegador.
 *
 * Son un espejo de lo que devuelve `serialise.ts`. No se importa nada de
 * Prisma aquí a propósito: ese módulo arrastra el cliente de base de datos al
 * bundle del navegador, que es un error que sólo aparece en producción.
 */

export type ExpenseSource = 'web' | 'shortcut' | 'revolut';

export type CategorySource = 'auto' | 'manual' | 'rule' | 'none';

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
  color: string;
  icon: string;
}

export interface Category extends CategorySummary {
  position: number;
  isArchived: boolean;
  expenseCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  amount: number;
  /** `65,26 €` ya formateado en la zona horaria e idioma del usuario. El
   *  cliente lo usa tal cual en vez de volver a formatear: si el importe
   *  pasara por `number` otra vez, la coma decimal se perdería al
   *  serializarlo. */
  amountFormatted: string;
  currency: string;
  merchant: string | null;
  description: string | null;
  category: CategorySummary | null;
  source: ExpenseSource;
  paymentMethod: string | null;
  /** Instante en UTC. */
  expenseDate: string;
  /** `25/09/2026 · 16:00`, ya en la zona horaria del usuario. */
  expenseDateLocal: string;
  /** `Ayer` o `25/09/2026`, según lo cerca que esté. */
  expenseDateRelative: string;
  sourceTimezone: string;
  receivedAt: string | null;
  /** `true` si el usuario corrigió el gasto a mano: deja de reclasificarse. */
  edited: boolean;
  categorySource: CategorySource;
  createdAt: string;
  updatedAt: string;
}

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ExpenseListResponse {
  items: Expense[];
  pagination: Pagination;
}

export interface CategoryListResponse {
  categories: Category[];
}

export interface TimeBucket {
  /** Etiqueta ya formateada en la zona horaria del usuario (`23 ago`). */
  key: string;
  /** Inicio del periodo en formato AAAA-MM-DD, ordenable como texto. */
  start: string;
  total: number;
  count: number;
}

export interface CategoryBreakdown {
  categoryId: string | null;
  categoryName: string;
  color: string;
  icon: string;
  total: number;
  count: number;
}

export interface MerchantBreakdown {
  merchant: string;
  total: number;
  count: number;
}

export interface SourceBreakdown {
  source: ExpenseSource;
  total: number;
  count: number;
}

export interface Statistics {
  totals: {
    today: number;
    week: number;
    month: number;
    previousMonth: number;
    monthCount: number;
    monthTransactions: number;
    averagePerDay: number;
    averagePerPayment: number;
    /** Variación respecto al mes anterior, en porcentaje. `null` si el mes
     *  pasado fue cero, porque "subió un 400 %" partiendo de 0 no significa
     *  nada. */
    monthOverMonth: number | null;
  };
  byCategory: CategoryBreakdown[];
  byDay: TimeBucket[];
  byWeek: TimeBucket[];
  byMonth: TimeBucket[];
  topMerchants: MerchantBreakdown[];
  topCategory: CategoryBreakdown | null;
  topMerchant: MerchantBreakdown | null;
  bySource: SourceBreakdown[];
}

export interface StatisticsResponse {
  statistics: Statistics;
  timezone: string;
  currency: string;
}

export interface DeviceToken {
  id: string;
  label: string;
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface MerchantRule {
  id: string;
  userId: string;
  /** Texto a detectar. Se llama `pattern` en la API. */
  pattern: string;
  matchType: 'contains' | 'exact' | 'regex';
  categoryId: string;
  category: CategorySummary | null;
  priority: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRule {
  id: string;
  userId: string;
  name: string;
  isEnabled: boolean;
  priority: number;
  match: string;
  matchType: 'contains' | 'exact' | 'regex';
  /** Índice del grupo de captura que contiene el importe. */
  amountGroup: number | null;
  /** Índice del grupo de captura que contiene el comercio. */
  merchantGroup: number | null;
  /** Índice del grupo de captura que contiene la moneda. */
  currencyGroup: number | null;
  /**
   * `false` marca la regla como "esto no es un gasto" (ingresos, devoluciones).
   * El orden lo resuelve `priority`, no esta bandera.
   */
  isExpense: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Regla de comercio junto con la categoría a la que apunta. */
export interface MerchantRuleListResponse {
  rules: MerchantRule[];
}

/** Reglas de notificación en orden de prioridad. */
export interface NotificationRuleListResponse {
  rules: NotificationRule[];
}

/**
 * `kind` distingue un gasto real de un aviso que se ignora a propósito, que es
 * la diferencia entre "no he registrado nada" y "he registrado un ingreso".
 */
export type NotificationOutcomeKind = 'expense' | 'not_an_expense' | 'unparsed';

/** Cómo se obtuvo el importe: por regla, por heurística o no se obtuvo. */
export type NotificationExtraction = 'rule' | 'fallback' | 'none';

/** Resultado de `POST /api/notification-rules/test`: no escribe nada. */
export interface NotificationTestResult {
  text: string;
  outcome: {
    kind: NotificationOutcomeKind;
    /** Importe tal como se leyó, con el formato del texto original. */
    amount: string | null;
    currency: string | null;
    merchant: string | null;
    ruleId: string | null;
    ruleName: string | null;
    extraction: NotificationExtraction;
  };
  diagnostics: {
    ruleCount: number;
    activeRuleCount: number;
    /**
     * `true` cuando el texto casaría con una regla desactivada. Es la pista
     * clave cuando alguien desactivó sin querer la regla que le hacía falta.
     */
    wouldMatchDifferentRule: boolean;
    rulesEvaluated: {
      id: string;
      name: string;
      isEnabled: boolean;
      priority: number;
      matchType: string;
      match: string;
      amountGroup: number | null;
      merchantGroup: number | null;
      currencyGroup: number | null;
      isExpense: boolean;
    }[];
  };
}

/** Perfil editable del usuario. */
export interface Profile {
  id: string;
  email: string;
  name: string | null;
  currency: string;
  timezone: string;
  isDemo: boolean;
  createdAt: string;
}

export interface ProfileResponse {
  user: Profile;
}

/** Lista de tokens de dispositivo; nunca incluye el token en claro. */
export interface DeviceTokenListResponse {
  tokens: DeviceToken[];
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  isDemo: boolean;
}

/**
 * Respuesta de `GET /api/auth/me`.
 *
 * El campo `via` es el que devuelve el servidor: `session` cuando la petición
 * venía con cookie de navegador y `device_token` cuando venía con el token de
 * un Atajo. No hay ningún otro campo: este tipo tiene que ser un espejo exacto
 * de la respuesta, o los consumidores leen `undefined` sin que TypeScript diga
 * nada.
 */
export interface SessionResponse {
  user: SessionUser;
  via: 'session' | 'device_token';
}

/** Convierte un texto a `CamelCase` con la primera letra en mayúscula. */
export function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Formatea un importe.
 *
 * Se usa `Intl.NumberFormat` en lugar de `toFixed` para que los separadores
 * sigan la convención del idioma del navegador y no la codificada en el
 * código. Los céntimos siempre se muestran: un gasto de 4,00 € y uno de 4 €
 * no son lo mismo en un Extracto.
 */
const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(
  amount: number,
  currency = 'EUR',
  locale = 'es-ES',
): string {
  const key = `${locale}:${currency}`;
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    moneyFormatters.set(key, formatter);
  }
  return formatter.format(amount);
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

/** `14 de marzo` / `14 mar`. */
export function formatDate(value: string, locale = 'es-ES'): string {
  return dateFormatter(locale, { day: 'numeric', month: 'short' }).format(new Date(value));
}

/** `2026-03-14` en la zona horaria del usuario, no en la del servidor. */
export function toLocalDateKey(value: string | Date, timeZone?: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (timeZone) {
    // `en-CA` ya devuelve el formato AAAA-MM-DD, que es ordenable como texto.
    return date
      .toLocaleDateString('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .replace(/\//g, '-');
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const percentFormatters = new Map<string, Intl.NumberFormat>();

/**
 * Porcentaje con los signos de la configuración regional.
 *
 * `toFixed` escribiría siempre `-2.9`, y en una interfaz en español el signo
 * decimal es la coma: ese número se leería como mil doscientos noventa.
 */
export function formatPercent(value: number, fractionDigits = 1, locale = 'es-ES'): string {
  const key = `${locale}:${fractionDigits}`;
  let formatter = percentFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    percentFormatters.set(key, formatter);
  }
  return formatter.format(value / 100);
}

/** `hace 3 días`, `ahora`. Corto y relativo para listas largas. */
export function formatRelative(value: string, locale = 'es-ES'): string {
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(seconds, 'second');
}
