/**
 * Constantes compartidas por los esquemas de validación.
 *
 * Vive en su propio archivo para que `validation.ts` y los validadores de
 * runtime (que se ejecutan también en el Atajo y en scripts) no formen un
 * ciclo de importación.
 */
export const SUPPORTED_CURRENCIES = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'CAD',
  'AUD',
  'JPY',
] as const;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Orígenes admitidos de un gasto.
 *
 * Debe mantenerse sincronizado con el enum `ExpenseSource` de
 * `prisma/schema.prisma`. Si se añade un origen allí y no aquí, la validación
 * lo rechazará en la entrada: es un fallo ruidoso y fácil de ver, que es
 * preferible a dejar pasar valores que la base de datos no soporta.
 */
export const EXPENSE_SOURCES = ['web', 'shortcut', 'revolut'] as const;
export type ExpenseSourceValue = (typeof EXPENSE_SOURCES)[number];
