import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseClientDateTime,
  DateTimeError,
  isValidTimezone,
  getZonedParts,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  zonedTimeToUtc,
} from '../src/lib/datetime';

/**
 * Fechas.
 *
 * El eje de todas estas pruebas es que la base guarda UTC y que el corte en
 * "hoy", "esta semana" o "este mes" se hace en la zona del usuario. Un fallo
 * aquí se traduce en gastos que aparecen en el día equivocado a medianoche.
 */

const MADRID = 'Europe/Madrid';

test('interpreta una fecha sin desfase como hora local del usuario', () => {
  const summer = parseClientDateTime('2026-07-15T12:00:00', MADRID);
  assert.equal(summer.instant.toISOString(), '2026-07-15T10:00:00.000Z');
  assert.equal(summer.hadExplicitOffset, false);

  // En invierno Madrid está en UTC+1: la misma hora de pared es otra.
  const winter = parseClientDateTime('2026-01-15T12:00:00', MADRID);
  assert.equal(winter.instant.toISOString(), '2026-01-15T11:00:00.000Z');
});

test('prioriza el desfase explícito sobre la zona del usuario', () => {
  const parsed = parseClientDateTime('2026-09-28T00:32:18+02:00', MADRID);
  assert.equal(parsed.instant.toISOString(), '2026-09-27T22:32:18.000Z');
  assert.equal(parsed.hadExplicitOffset, true);
});

test('una fecha sin hora apunta a la medianoche local', () => {
  const parsed = parseClientDateTime('2026-09-28', MADRID);
  assert.equal(parsed.instant.toISOString(), '2026-09-27T22:00:00.000Z');
});

test('rechaza fechas imposibles en lugar de inventar una', () => {
  assert.throws(() => parseClientDateTime('ayer', MADRID), DateTimeError);
  assert.throws(() => parseClientDateTime('2026-13-45T10:00:00', MADRID), DateTimeError);
  assert.throws(() => parseClientDateTime('', MADRID), DateTimeError);
});

test('valida identificadores IANA', () => {
  assert.equal(isValidTimezone(MADRID), true);
  assert.equal(isValidTimezone('America/New_York'), true);
  assert.equal(isValidTimezone('Marte/Olympus_Mons'), false);
  assert.equal(isValidTimezone(''), false);
});

test('startOfWeek corta en lunes a medianoche local', () => {
  // Miércoles 30/09/2026 → lunes 28/09/2026 00:00 en Madrid (UTC+2).
  const start = startOfWeek(new Date('2026-09-30T12:00:00Z'), MADRID);
  const parts = getZonedParts(start, MADRID);
  assert.equal(parts.year, 2026);
  assert.equal(parts.month, 9);
  assert.equal(parts.day, 28);
  assert.equal(parts.hour, 0);
  assert.equal(parts.minute, 0);
});

test('startOfMonth y endOfMonth acotan el mes local', () => {
  const reference = new Date('2026-09-15T12:00:00Z');
  const start = startOfMonth(reference, MADRID);
  const end = endOfMonth(reference, MADRID);
  assert.equal(getZonedParts(start, MADRID).day, 1);
  // `endOfMonth` es exclusivo: el primer instante del mes siguiente.
  assert.equal(getZonedParts(end, MADRID).day, 1);
  assert.equal(getZonedParts(end, MADRID).month, 10);
  assert.ok(end.getTime() > start.getTime());
});

test('zonedTimeToUtc resuelve el horario de verano', () => {
  const instant = zonedTimeToUtc(
    { year: 2026, month: 7, day: 15, hour: 12, minute: 0, second: 0 },
    MADRID,
  );
  assert.equal(instant.toISOString(), '2026-07-15T10:00:00.000Z');

  const winter = zonedTimeToUtc(
    { year: 2026, month: 1, day: 15, hour: 12, minute: 0, second: 0 },
    MADRID,
  );
  assert.equal(winter.toISOString(), '2026-01-15T11:00:00.000Z');
});
