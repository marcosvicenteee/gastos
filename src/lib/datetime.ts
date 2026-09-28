/**
 * Utilidades de fecha y hora con zona horaria real.
 *
 * Principio: en la base de datos todo es UTC (`timestamptz`). La zona horaria
 * del usuario sólo se usa al presentar y al recortar periodos ("hoy", "este
 * mes"). Así, un gasto creado desde el Atajo a las 00:32 en Madrid aparece
 * como 00:32 y no como las 22:32 del día anterior.
 */

export const DEFAULT_TIMEZONE = 'Europe/Madrid';

const tzCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = tzCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    tzCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Comprueba que un identificador IANA de zona horaria es válido. */
export function isValidTimezone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Descompone un instante UTC en las piezas que ve el usuario en su zona. */
export function getZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const lookup: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = Number(part.value);
  }
  // `hour` puede venir como 24 en punto de medianoche según el runtime.
  const hour = lookup.hour === 24 ? 0 : lookup.hour;
  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
    hour,
    minute: lookup.minute,
    second: lookup.second,
  };
}

/** Desplazamiento de la zona respecto a UTC, en minutos, para un instante dado. */
export function getTimezoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = getZonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Se descarta la parte de milisegundos del instante para que el cálculo
  // cuadre exactamente con las piezas de segundo.
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * Convierte una hora local ("00:32:18" del 28/09/2026) en el instante UTC
 * correspondiente, resolviendo correctamente el horario de verano.
 *
 * Se itera dos veces: el primer desplazamiento es una aproximación, y se
 * recalcula con el desplazamiento real de esa hora local. Es el método
 * estándar cuando no hay una base de datos de transiciones horarias.
 */
export function zonedTimeToUtc(
  parts: ZonedParts,
  timeZone: string,
): Date {
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  let instant = new Date(wallClockAsUtc);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offset = getTimezoneOffsetMinutes(instant, timeZone);
    instant = new Date(wallClockAsUtc - offset * 60000);
  }
  return instant;
}

export interface ParsedDateTime {
  instant: Date;
  /** Zona horaria efectiva usada para interpretar el valor. */
  timeZone: string;
  /** `true` si el cliente envió un desfase explícito (p. ej. `+02:00`). */
  hadExplicitOffset: boolean;
}

const ISO_WITH_OFFSET_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})$/;
const ISO_WITHOUT_OFFSET_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})?(?:\.\d{1,3})?)$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Comprueba que año, mes y día existen de verdad en el calendario.
 *
 * Las expresiones regulares de más abajo sólo verifican que sean dos dígitos:
 * sin esta comprobación, `2026-02-30` no daría error, se convertiría en el 2
 * de marzo y el gasto aparecería en el día equivocado.
 */
function isValidWallClock(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  // Día 0 del mes siguiente = último día del mes indicado.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * Interpreta la fecha que envía un cliente.
 *
 * Se prioriza el desfase explícito (`2026-09-28T00:32:18+02:00`) porque es el
 * dato más preciso. Si el cliente no lo envía —porque el Atajo se montó a mano
 * sin la acción de formato— se interpreta como hora local del usuario.
 *
 * Lanza `DateTimeError` en lugar de inventar una fecha.
 */
export function parseClientDateTime(
  value: string,
  fallbackTimeZone: string = DEFAULT_TIMEZONE,
): ParsedDateTime {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DateTimeError('Falta la fecha y hora del gasto.');
  }
  const input = value.trim();

  const withOffset = ISO_WITH_OFFSET_RE.exec(input);
  if (withOffset) {
    const instant = new Date(input.replace(' ', 'T'));
    if (Number.isNaN(instant.getTime())) {
      throw new DateTimeError(`Fecha no válida: ${value}`);
    }
    // `Date` acepta mes 13 o día 40 desplazándolos al año siguiente: eso es
    // inventar una fecha, no interpretarla.
    if (!isValidWallClock(Number(withOffset[1]), Number(withOffset[2]), Number(withOffset[3]))) {
      throw new DateTimeError(`Fecha no válida: ${value}`);
    }
    return {
      instant,
      timeZone: fallbackTimeZone,
      hadExplicitOffset: true,
    };
  }

  const withoutOffset = ISO_WITHOUT_OFFSET_RE.exec(input);
  if (withoutOffset) {
    const timeZone = isValidTimezone(fallbackTimeZone)
      ? fallbackTimeZone
      : DEFAULT_TIMEZONE;
    const year = Number(withoutOffset[1]);
    const month = Number(withoutOffset[2]);
    const day = Number(withoutOffset[3]);
    const hour = Number(withoutOffset[4]);
    const minute = Number(withoutOffset[5]);
    const second = Number(withoutOffset[6] ?? 0);
    if (
      !isValidWallClock(year, month, day) ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      throw new DateTimeError(`Fecha no válida: ${value}`);
    }
    const instant = zonedTimeToUtc(
      { year, month, day, hour, minute, second },
      timeZone,
    );
    return { instant, timeZone, hadExplicitOffset: false };
  }

  const dateOnly = DATE_ONLY_RE.exec(input);
  if (dateOnly) {
    const timeZone = isValidTimezone(fallbackTimeZone)
      ? fallbackTimeZone
      : DEFAULT_TIMEZONE;
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (!isValidWallClock(year, month, day)) {
      throw new DateTimeError(`Fecha no válida: ${value}`);
    }
    // Medianoche local del día indicado.
    const instant = zonedTimeToUtc(
      { year, month, day, hour: 0, minute: 0, second: 0 },
      timeZone,
    );
    return { instant, timeZone, hadExplicitOffset: false };
  }

  throw new DateTimeError(
    `Fecha no válida: "${value}". Usa el formato ISO 8601, por ejemplo 2026-09-28T00:32:18+02:00`,
  );
}

export class DateTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateTimeError';
  }
}

/** Inicio del día local, como instante UTC. */
export function startOfDay(instant: Date, timeZone: string): Date {
  const p = getZonedParts(instant, timeZone);
  return zonedTimeToUtc(
    { ...p, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

/** Inicio de la semana local (lunes 00:00:00), como instante UTC. */
export function startOfWeek(instant: Date, timeZone: string): Date {
  const dayStart = startOfDay(instant, timeZone);
  const p = getZonedParts(dayStart, timeZone);
  // getUTCDay: 0 = domingo. Se desplaza al lunes.
  const weekday = new Date(
    Date.UTC(p.year, p.month - 1, p.day),
  ).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return zonedTimeToUtc(
    { year: p.year, month: p.month, day: p.day - daysSinceMonday, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

/** Inicio del mes local, como instante UTC. */
export function startOfMonth(instant: Date, timeZone: string): Date {
  const p = getZonedParts(instant, timeZone);
  return zonedTimeToUtc(
    { year: p.year, month: p.month, day: 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

/** Fin exclusivo del mes local, como instante UTC. */
export function endOfMonth(instant: Date, timeZone: string): Date {
  const p = getZonedParts(instant, timeZone);
  // Medianoche local del día 1 del mes siguiente: es el primer instante que
  // ya no pertenece al mes, con lo que un `lt:` incluye también el último día.
  // (El "día 0 del mes siguiente" apuntaría a la medianoche de arranque del
  // último día y dejaría ese día entero fuera del total.)
  return zonedTimeToUtc(
    { year: p.year, month: p.month + 1, day: 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

/** Resto de días respecto al inicio de la semana, para agrupar por semana. */
export function weekKey(instant: Date, timeZone: string): string {
  const start = startOfWeek(instant, timeZone);
  const p = getZonedParts(start, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Etiqueta corta de eje para gráficos por día: "28 sep". */
export function formatDayLabel(instant: Date, timeZone: string, locale = 'es-ES'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: 'short',
  }).format(instant);
}

/** Etiqueta de eje para gráficos por mes: "sept". */
export function formatMonthLabel(instant: Date, timeZone: string, locale = 'es-ES'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
  })
    .format(instant)
    .replace('.', '');
}

/** "28/09/2026 · 00:18" */
export function formatDateTime(
  instant: Date,
  timeZone: string,
  locale = 'es-ES',
): string {
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instant);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
  return `${date} · ${time}`;
}

/** "28/09/2026" */
export function formatDate(instant: Date, timeZone: string, locale = 'es-ES'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instant);
}

/** "hoy", "ayer", "28/09/2026" */
export function formatRelativeDay(
  instant: Date,
  timeZone: string,
  now: Date = new Date(),
  locale = 'es-ES',
): string {
  const target = getZonedParts(instant, timeZone);
  const current = getZonedParts(now, timeZone);
  const dayDiff = Math.round(
    (Date.UTC(current.year, current.month - 1, current.day) -
      Date.UTC(target.year, target.month - 1, target.day)) /
      86400000,
  );
  if (dayDiff === 0) return 'Hoy';
  if (dayDiff === 1) return 'Ayer';
  if (dayDiff === -1) return 'Mañana';
  return formatDate(instant, timeZone, locale);
}

/** Marca ISO con el desfase de la zona, tal y como lo enviaría el Atajo. */
export function toIsoWithOffset(instant: Date, timeZone: string): string {
  const offset = getTimezoneOffsetMinutes(instant, timeZone);
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `${instant.toISOString().slice(0, 19)}${sign}${hours}:${minutes}`;
}
