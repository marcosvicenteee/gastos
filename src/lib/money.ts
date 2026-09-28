import { Prisma } from '@prisma/client';
import { SUPPORTED_CURRENCIES } from './validators-constants';

/**
 * Utilidades de dinero.
 *
 * Regla inviolable: los importes viajan y se guardan como `Decimal(14,2)`.
 * `Float`/`number` sólo se usa en el último paso, al serializar a JSON para
 * los gráficos, donde un redondeo a 2 decimales es aceptable para mostrar.
 */

export { SUPPORTED_CURRENCIES };

/** Divisa por defecto del Atajo y de la app. */
export const DEFAULT_CURRENCY = 'EUR';

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

const MAX_AMOUNT = new Prisma.Decimal('9999999999.99');

/** Símbolos y códigos que se eliminan antes de interpretar un número. */
const CURRENCY_NOISE_RE =
  /[€$£¥₹]|eur|usd|gbp|chf|sek|nok|dkk|pln|czk|cad|aud|jpy/gi;

/**
 * Interpreta un importe escrito por una persona.
 *
 * Acepta las dos convenciones porque el Atajo se usa en teclados distintos:
 *   "12,50"   -> 12.50   (coma decimal, habitual en España)
 *   "12.50"   -> 12.50   (punto decimal, habitual en teclado inglés)
 *   "1.250,00"-> 1250.00 (punto de miles + coma decimal)
 *   "1,250.00"-> 1250.00 (coma de miles + punto decimal)
 *   "12,50 €" -> 12.50   (con moneda pegada)
 *
 * Heurística cuando sólo hay un tipo de separador:
 *   - aparece más de una vez  -> separador de miles
 *   - aparece una vez con exactamente 3 dígitos detrás -> separador de miles
 *   - en cualquier otro caso  -> separador decimal
 *
 * Se rechaza cualquier entrada ambigua o fuera de rango en lugar de adivinar.
 */
export function parseAmount(input: string | number | Prisma.Decimal): Prisma.Decimal {
  if (input instanceof Prisma.Decimal) return normaliseDecimal(input);

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new AmountError('El importe no es un número válido.');
    }
    // Se pasa por cadena para no arrastrar la representación binaria del float.
    return parseAmount(String(input));
  }

  if (typeof input !== 'string') {
    throw new AmountError('El importe debe ser un número o una cadena.');
  }

  const cleaned = input.replace(CURRENCY_NOISE_RE, '').replace(/[\s  ]/g, '');
  if (cleaned === '') {
    throw new AmountError('No se ha indicado ningún importe.');
  }
  if (!/^\d*([.,]\d*)*$/.test(cleaned)) {
    throw new AmountError(
      `El importe "${input}" no tiene un formato válido. Ejemplos válidos: 12,50 · 12.50 · 1250`,
    );
  }

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalised: string;

  if (lastComma !== -1 && lastDot !== -1) {
    // Ambas presentes: la que aparece más a la derecha es la decimal.
    const decimalIndex = Math.max(lastComma, lastDot);
    const integerPart = cleaned.slice(0, decimalIndex).replace(/[.,]/g, '');
    const fractionPart = cleaned.slice(decimalIndex + 1);
    if (fractionPart.length === 0) {
      throw new AmountError(`El importe "${input}" está incompleto.`);
    }
    normalised = `${integerPart}.${fractionPart}`;
  } else if (lastComma !== -1 || lastDot !== -1) {
    const separator = lastComma !== -1 ? ',' : '.';
    const occurrences = cleaned.split(separator).length - 1;
    const digitsAfter = cleaned.length - cleaned.lastIndexOf(separator) - 1;
    const isThousands =
      occurrences > 1 || (occurrences === 1 && digitsAfter === 3);
    normalised = isThousands
      ? cleaned.replace(/[.,]/g, '')
      : cleaned.replace(separator, '.');
  } else {
    normalised = cleaned;
  }

  if (!/^\d*(\.\d*)?$/.test(normalised) || normalised === '' || normalised === '.') {
    throw new AmountError(`El importe "${input}" no es un número válido.`);
  }

  // `normaliseDecimal` valida rango y signo además de redondear, así que aquí
  // no hace falta volver a comprobarlo.
  return normaliseDecimal(new Prisma.Decimal(normalised));
}

/**
 * Redondea a dos decimales, mitad hacia arriba.
 *
 * `ROUND_HALF_UP` y no el redondeo por defecto de JavaScript: es el redondeo
 * que espera cualquiera que ve una factura, y evita el caso
 * `1.005 → 1.00` que produce el redondeo bancario.
 */
function normaliseDecimal(value: Prisma.Decimal): Prisma.Decimal {
  if (value.lte(0)) throw new AmountError('El importe debe ser mayor que 0.');
  if (value.gt(MAX_AMOUNT)) throw new AmountError('El importe es demasiado grande.');
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountError';
  }
}

/** Redondeo a 2 decimales para presentación. */
export function toNumber(value: Prisma.Decimal | number | string): number {
  const decimal =
    typeof value === 'number' || typeof value === 'string'
      ? new Prisma.Decimal(value)
      : value;
  return Number(decimal.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2));
}

/** Símbolo de moneda por defecto para los locales soportados. */
const CURRENCY_LOCALES: Record<string, string> = {
  EUR: 'es-ES',
  USD: 'en-US',
  GBP: 'en-GB',
  CHF: 'de-CH',
  SEK: 'sv-SE',
  NOK: 'nb-NO',
  DKK: 'da-DK',
  PLN: 'pl-PL',
  CZK: 'cs-CZ',
  CAD: 'en-CA',
  AUD: 'en-AU',
  JPY: 'ja-JP',
};

const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * Formatea un importe de forma localizada, p. ej. `12,50 €` en español o
 * `€12.50` en inglés. El separador de millares y el símbolo dependen del
 * locale, no del código de moneda.
 */
export function formatMoney(
  value: Prisma.Decimal | number,
  currency: string = DEFAULT_CURRENCY,
  locale = 'es-ES',
): string {
  const amount = toNumber(value);
  const effectiveLocale = locale ?? CURRENCY_LOCALES[currency] ?? 'es-ES';
  const cacheKey = `${effectiveLocale}:${currency}`;
  let formatter = formatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.NumberFormat(effectiveLocale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatterCache.set(cacheKey, formatter);
  }
  return formatter.format(amount);
}

/** Igual que `formatMoney` pero con signo negativo explícito (lista de gastos). */
export function formatSignedMoney(
  value: Prisma.Decimal | number,
  currency: string = DEFAULT_CURRENCY,
  locale = 'es-ES',
): string {
  const formatted = formatMoney(value, currency, locale);
  return `-${formatted}`;
}
