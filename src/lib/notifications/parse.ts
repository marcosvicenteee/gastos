import { MatchType } from '@prisma/client';
import type { NotificationRule } from '@prisma/client';

/**
 * Extracción de datos a partir del texto de una notificación.
 *
 * ## Por qué esta parte existe y por qué es configurable
 *
 * La captura automática de pagos de Revolut se apoya en la automatización
 * oficial de iOS 27 «Cuando se recibe una notificación», que es un mecanismo
 * **del sistema operativo**, no de Revolut. Apple's docs dice que ese
 * disparador filtra por Message, Subtitle o Title, y el Atajo puede trabajar
 * con el texto de la notificación.
 *
 * Pero el texto exacto que envía Revolut **no es un contrato estable**: cambia
 * con el idioma de la app, con la versión, con el tipo de operación (pago con
 * tarjeta, transferencia, pago online) y con el diseño vigente en cada
 * momento. No hay forma de verificarlo desde fuera ni de que Apple lo fije.
 *
 * Por eso el diseño NO es un `switch` con la cadena de Revolut escrita a mano,
 * sino dos capas:
 *
 *  1. **Reglas del usuario** (`NotificationRule`) que deciden si el evento es un
 *     gasto y, si lo es, qué grupos de captura son el importe y el comercio.
 *  2. **Extractores genéricos** que resuelven el caso habitual sin que el
 *     usuario tenga que escribir una sola expresión regular.
 *
 * Cuando Revolut cambie la frase, se arregla desde el panel en un minuto, con
 * el probador de texto pegado al lado, sin tocar código ni rehacer el Atajo.
 * Y si ninguna regla casa, el evento queda registrado como `failed` con su
 * texto íntegro, en vez de perderse en silencio.
 */

export interface NotificationPayload {
  /** App que ha emitido la notificación, p. ej. `Revolut`. */
  app?: string | null;
  title?: string | null;
  subtitle?: string | null;
  body?: string | null;
  /**
   * Identificador de la notificación en el dispositivo, si el Atajo lo envía.
   * Opcional: el evaluador no lo usa, sólo se conserva en la traza de ingesta.
   */
  notificationId?: string | null;
  /** Momento de recepción declarado por el Atajo. Opcional, por lo mismo. */
  receivedAt?: Date | null;
}

/** Texto combinado sobre el que se evalúan las reglas y los extractores. */
export function joinNotification(payload: NotificationPayload): string {
  return [payload.title, payload.subtitle, payload.body]
    .map((part) => (part ?? '').trim())
    .filter((part) => part !== '')
    .join('\n');
}

export type ParseOutcome =
  | {
      kind: 'expense';
      amount: string;
      currency: string | null;
      merchant: string | null;
      ruleId: string | null;
      ruleName: string | null;
      /** `rule` = overrides de la regla; `heuristic` = extractor genérico. */
      extraction: 'rule' | 'heuristic';
    }
  | {
      /** La notificación existe pero no representa un gasto. */
      kind: 'not_an_expense';
      ruleId: string | null;
      ruleName: string | null;
      reason: string;
    }
  | {
      kind: 'unparsed';
      reason: string;
    };

// ---------------------------------------------------------------------------
// Extractores genéricos
// ---------------------------------------------------------------------------

/** Símbolo de moneda → código ISO 4217. */
const SYMBOL_TO_CURRENCY: Record<string, string> = {
  '€': 'EUR',
  $: 'USD',
  '£': 'GBP',
  '¥': 'JPY',
  CHF: 'CHF',
};

const CURRENCY_CODE_RE =
  /\b(EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CZK|CAD|AUD|JPY)\b/i;

/**
 * Un número que parece un importe: grupos de millares opcionales y hasta dos
 * decimales, seguido de un símbolo o código de moneda opcional.
 *
 * Se aceptan los millares con espacio o punto fino ("1 250,00"), habituales en
 * notificaciones de apps bancarias. Se exige separador decimal o símbolo de
 * moneda para no confundir un importe con un número cualquiera ("hace 3 días",
 * "tarjeta 2").
 */
const MONEY_TOKEN_RE =
  /(?<![\d.,])(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(€|\$|£|¥|EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CZK|CAD|AUD|JPY)?/gi;

/** Conector que separa el importe del comercio: "Pago de 12,50 € en Mercadona". */
const MERCHANT_CONNECTOR_RE = /\b(?:en|to|a|at|in|para|bei|hacia)\s+(.+)$/is;

/** Ruido que nunca forma parte de un nombre de comercio. */
const MERCHANT_TRAILING_NOISE_RE =
  /[\s.,;:!?)\]"'»]+$|^(?:con tu tarjeta|tarjeta|con la tarjeta|with your card|with card|card|paid|spent|payment|pago)\b\s*/i;

export function findCurrency(text: string): string | null {
  const code = CURRENCY_CODE_RE.exec(text);
  if (code?.[1]) return code[1].toUpperCase();

  for (const [symbol, currency] of Object.entries(SYMBOL_TO_CURRENCY)) {
    if (text.includes(symbol)) return currency;
  }
  return null;
}

interface MoneyCandidate {
  raw: string;
  index: number;
  score: number;
}

/**
 * Devuelve el candidato a importe más probable.
 *
 * Puntuación, de mayor a menor peso:
 *  1. Llevar un símbolo o código de moneda explícito.
 *  2. Tener separador decimal.
 *  3. Aparecer antes en el texto (las notificaciones suelen empezar por
 *     "Pago de 12,50 € en X").
 */
export function findAmountToken(text: string): string | null {
  const candidates: MoneyCandidate[] = [];
  MONEY_TOKEN_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = MONEY_TOKEN_RE.exec(text)) !== null) {
    const numeric = match[1] ?? '';
    if (numeric === '') continue;

    const hasExplicitCurrency = Boolean(match[2]);
    const hasDecimalSeparator = /[.,]\d{1,2}$/.test(numeric);
    // Sin moneda ni decimales es demasiado débil para tratarlo como importe.
    if (!hasExplicitCurrency && !hasDecimalSeparator) continue;

    candidates.push({
      raw: match[0],
      index: match.index,
      score: (hasExplicitCurrency ? 4 : 0) + (hasDecimalSeparator ? 2 : 0),
    });
  }

  if (candidates.length === 0) return null;

  // Se recorre en lugar de usar `reduce` con un comparador: `reduce` exige que
  // el callback devuelva el acumulador, no un número, así que no sirve para
  // "quédate con el mayor". Sólo se sustituye en empate estricto, de modo que
  // gana siempre el primer candidato en caso de puntuación igual.
  let best = candidates[0]!;
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (candidate.score > best.score) best = candidate;
  }
  return best.raw;
}

/**
 * Extrae el comercio. Devuelve `null` si no lo encuentra con confianza: es
 * preferible no inventarlo, porque un comercio equivocado contamina las
 * estadísticas y las reglas de categorización.
 */
export function findMerchant(text: string, amountToken: string | null): string | null {
  // El texto a partir del importe suele contener el comercio: "12,50 € en Mercadona".
  let scope = text;
  if (amountToken) {
    const index = text.toLowerCase().indexOf(amountToken.toLowerCase());
    if (index !== -1) {
      scope = text.slice(index + amountToken.length).trim();
    }
  }

  const connector = MERCHANT_CONNECTOR_RE.exec(scope);
  const candidate = (connector?.[1] ?? scope).trim();

  if (candidate === '' || candidate === text.trim()) return null;
  if (candidate.length > 64) return null;

  const cleaned = candidate
    .replace(MERCHANT_TRAILING_NOISE_RE, '')
    .replace(/[\s.,;:!?)\]"'»]+$/, '')
    .trim();

  if (cleaned === '' || cleaned.length < 2) return null;
  // Si vuelve a contener un importe, no es un comercio.
  if (/\d+[.,]\d{2}/.test(cleaned)) return null;
  return cleaned;
}

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

export interface RuleLike {
  id: string;
  name: string;
  isEnabled: boolean;
  priority: number;
  match: string;
  matchType: MatchType;
  amountGroup: number | null;
  merchantGroup: number | null;
  currencyGroup: number | null;
  isExpense: boolean;
}

function matchesRule(rule: RuleLike, text: string): RegExpMatchArray | null {
  try {
    if (rule.matchType === MatchType.exact) {
      return text.trim().toLowerCase() === rule.match.trim().toLowerCase()
        ? [rule.match]
        : null;
    }
    if (rule.matchType === MatchType.contains) {
      const needle = rule.match.trim().toLowerCase();
      if (needle === '') return null;
      // En `contains` los metacaracteres son literales, así que se escapan.
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(escaped, 'i').test(text) ? [rule.match] : null;
    }
    // Se usa una copia de la expresión sin banderas globales: con `g`, el
    // `lastIndex` haría que el resultado dependiera del orden de evaluación.
    return new RegExp(rule.match, 'i').exec(text);
  } catch {
    // Una regla mal escrita no debe tumbar la ingesta; simplemente no casa.
    return null;
  }
}

function groupValue(
  match: RegExpMatchArray,
  group: number | null | undefined,
): string | null {
  if (group == null) return null;
  const value = match[group];
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Decide qué hacer con una notificación.
 *
 * Las reglas se evalúan por `priority` ascendente y gana la primera que casa,
 * de modo que las de exclusión ("esto es un abono") se colocan por delante de
 * las de gasto.
 *
 * Si ninguna regla casa se intenta el camino genérico: si el texto contiene un
 * importe con moneda o decimales, se considera un gasto. Es un punto de partida
 * razonable y el usuario puede desactivarlo creando una regla de exclusión
 * para los casos que le molesten.
 */
export function parseNotification(
  payload: NotificationPayload,
  rules: RuleLike[],
): ParseOutcome {
  const text = joinNotification(payload);
  if (text === '') {
    return { kind: 'unparsed', reason: 'La notificación llegó sin texto.' };
  }

  const ordered = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of ordered) {
    if (!rule.isEnabled) continue;
    const match = matchesRule(rule, text);
    if (!match) continue;

    if (!rule.isExpense) {
      return {
        kind: 'not_an_expense',
        ruleId: rule.id,
        ruleName: rule.name,
        reason: 'La regla indica que esta notificación no es un gasto.',
      };
    }

    // Los grupos de captura de la regla tienen prioridad sobre los extractores.
    const ruleAmount = groupValue(match, rule.amountGroup);
    if (ruleAmount == null) {
      // La regla casa pero no aporta un importe: se prueban las siguientes.
      continue;
    }

    const currencyFromRule = groupValue(match, rule.currencyGroup);
    const merchantFromRule = groupValue(match, rule.merchantGroup);

    return {
      kind: 'expense',
      amount: extractNumericAmount(ruleAmount),
      currency: currencyFromRule
        ? normaliseCurrency(currencyFromRule)
        : findCurrency(ruleAmount) ?? findCurrency(text),
      merchant: merchantFromRule ?? findMerchant(text, ruleAmount),
      ruleId: rule.id,
      ruleName: rule.name,
      extraction: 'rule',
    };
  }

  // Camino genérico, sin reglas aplicables.
  const genericAmount = findAmountToken(text);
  if (genericAmount) {
    return {
      kind: 'expense',
      amount: extractNumericAmount(genericAmount),
      currency: findCurrency(genericAmount) ?? findCurrency(text),
      merchant: findMerchant(text, genericAmount),
      ruleId: null,
      ruleName: null,
      extraction: 'heuristic',
    };
  }

  return {
    kind: 'unparsed',
    reason:
      'No se ha encontrado ningún importe en el texto de la notificación. ' +
      'Crea una regla de notificación en Integraciones para este formato.',
  };
}

/** Deja sólo la parte numérica del token ("12,50 €" → "12,50"). */
function extractNumericAmount(token: string): string {
  const match = /-?\d[\d .]*(?:[.,]\d{1,2})?/.exec(token);
  if (!match?.[0]) return token.trim();
  return match[0].trim();
}

function normaliseCurrency(value: string): string | null {
  const upper = value.trim().toUpperCase();
  if (CURRENCY_CODE_RE.test(upper)) return upper;
  const symbol = value.trim();
  return SYMBOL_TO_CURRENCY[symbol] ?? SYMBOL_TO_CURRENCY[symbol.toLowerCase()] ?? null;
}

/** Convierte las filas de Prisma al tipo que consume el evaluador de reglas. */
export function toRuleLike(rule: NotificationRule): RuleLike {
  return {
    id: rule.id,
    name: rule.name,
    isEnabled: rule.isEnabled,
    priority: rule.priority,
    match: rule.match,
    matchType: rule.matchType,
    amountGroup: rule.amountGroup,
    merchantGroup: rule.merchantGroup,
    currencyGroup: rule.currencyGroup,
    isExpense: rule.isExpense,
  };
}

/**
 * Reglas iniciales que se ofrecen al registrarse.
 *
 * IMPORTANTE: son un punto de partida, no una verdad sobre Revolut. Están
 * escritas para cubrir los formatos plausibles de un aviso de pago
 * ("Pago de 12,50 € en Mercadona", "Has pagado 12,50 € a Mercadona", "Paid
 * 12.50 EUR to Mercadona") y para descartar lo que no es un gasto. El usuario
 * debe verificar su texto real con el probador de Integraciones.
 *
 * Se pueden desactivar o borrar sin perder nada más.
 */
export const DEFAULT_NOTIFICATION_RULES: Omit<RuleLike, 'id'>[] = [
  {
    name: 'Ingresos y devoluciones (no son gastos)',
    isEnabled: true,
    priority: 10,
    match:
      '(recib|ingreso|abono|devoluci|reembolso|refund|received|incoming|added to your account|top ?up|cash ?deposit|transferencia recibida)',
    matchType: MatchType.regex,
    amountGroup: null,
    merchantGroup: null,
    currencyGroup: null,
    isExpense: false,
  },
  {
    name: 'Pagos pendientes o rechazados (llega otro aviso con el importe real)',
    isEnabled: true,
    priority: 20,
    match: '(pendiente|pending|pre-?author|authoriz|authoris|declin|rechazad|solicitud de approve|3d ?secure)',
    matchType: MatchType.regex,
    amountGroup: null,
    merchantGroup: null,
    currencyGroup: null,
    isExpense: false,
  },
  {
    name: 'Avisos de cuenta y otros no relacionados con pagos',
    isEnabled: true,
    priority: 30,
    match: '(bienvenido|welcome|nuevo dispositivo|new device|verificaci|verification|actualiza tu|update your|cambio de l[ií]mite|limit changed)',
    matchType: MatchType.regex,
    amountGroup: null,
    merchantGroup: null,
    currencyGroup: null,
    isExpense: false,
  },
  {
    name: 'Pago con tarjeta: "Pago de 12,50 € en Mercadona"',
    isEnabled: true,
    priority: 40,
    match:
      '(?:pago de|pago|has pagado|gasto de|gasto|has gastado|compra de|compra|paid|spent|payment of|payment)\\D{0,24}?(\\d[\\d .]*(?:[.,]\\d{1,2})?)\\s*(EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CZK|CAD|AUD|JPY|[€$£¥])?\\s*(?:en|to|a|at|in|para|bei)?\\s*(.+)',
    matchType: MatchType.regex,
    amountGroup: 1,
    currencyGroup: 2,
    merchantGroup: 3,
    isExpense: true,
  },
];
