import { z } from 'zod';
import {
  EXPENSE_SOURCES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SUPPORTED_CURRENCIES,
} from './validators-constants';

/**
 * Esquemas de validación de entrada.
 *
 * Todos los endpoints pasan por aquí antes de tocar la base de datos. Se usa
 * Zod en lugar de validación manual porque da un único punto de control,
 * mensajes coherentes y permite derivar los tipos de TypeScript
 * automáticamente, de modo que un cambio de esquema rompe la compilación.
 */

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------

/** Importe: acepta número o cadena en cualquiera de las dos convenciones. */
export const amountSchema = z.union([z.number(), z.string()]).transform((value, ctx) => {
  if (typeof value === 'string' && value.trim() === '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Indica el importe.' });
    return z.NEVER;
  }
  return value;
});

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => (SUPPORTED_CURRENCIES as readonly string[]).includes(value), {
    message: `Moneda no admitida. Usa un código ISO 4217 como ${SUPPORTED_CURRENCIES.slice(0, 4).join(', ')}.`,
  });

export const uuidSchema = z
  .string()
  .trim()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'Debe ser un UUID válido.',
  );

/**
 * Texto libre opcional, recortado y con longitud acotada.
 *
 * Importante: el esquema acaba en `.nullish()` y **no** en un `.transform()`
 * posterior. Un `.transform()` final envolvería el esquema opcional en un
 * `ZodEffects` no opcional, lo que hace que la clave pase a ser obligatoria en
 * el tipo de salida: los callers tendrían que pasar `null` explícito para
 * campos que son opcionales de verdad.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .transform((value) => (value === '' ? null : value))
    .nullish();

// ---------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254, 'El correo es demasiado largo.')
  .email('Introduce un correo electrónico válido.');

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `La contraseña necesita al menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(PASSWORD_MAX_LENGTH, 'La contraseña es demasiado larga.');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: optionalText(80),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Introduce tu contraseña.').max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------------

const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Usa un color hexadecimal, por ejemplo #6366F1.');

const categoryNameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre no puede estar vacío.')
  .max(40, 'Máximo 40 caracteres.');

export const createCategorySchema = z.object({
  name: categoryNameSchema,
  icon: z.string().trim().max(40).optional(),
  color: hexColorSchema.optional(),
  position: z.number().int().min(0).max(9999).optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: categoryNameSchema.optional(),
    icon: z.string().trim().max(40).optional(),
    color: hexColorSchema.optional(),
    position: z.number().int().min(0).max(9999).optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indica al menos un campo que quieras cambiar.',
  });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const reorderCategoriesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;

/** `GET /api/categories?includeArchived=1` */
export const categoryFilterSchema = z.object({
  includeArchived: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined) return false;
      return typeof value === 'boolean'
        ? value
        : ['1', 'true', 'yes'].includes(value.toLowerCase());
    }),
});
export type CategoryFilterInput = z.infer<typeof categoryFilterSchema>;

/**
 * `DELETE /api/categories/:id`
 *
 * `moveExpensesTo` es obligatorio cuando la categoría tiene gastos. Es
 * explícito a propósito: mover el historial a otra categoría debe ser una
 * decisión visible, no un efecto colateral de un borrado.
 */
export const deleteCategorySchema = z.object({
  moveExpensesTo: z.string().min(1).nullish(),
});
export type DeleteCategoryInput = z.infer<typeof deleteCategorySchema>;

// ---------------------------------------------------------------------------
// Reglas de comercio
// ---------------------------------------------------------------------------

export const createMerchantRuleSchema = z.object({
  pattern: z.string().trim().min(1, 'Escribe el texto a detectar.').max(80),
  matchType: z.enum(['contains', 'exact', 'regex']).default('contains'),
  categoryId: z.string().min(1),
  priority: z.number().int().min(0).max(9999).optional(),
  isEnabled: z.boolean().optional(),
});
export type CreateMerchantRuleInput = z.infer<typeof createMerchantRuleSchema>;

export const updateMerchantRuleSchema = z
  .object({
    pattern: z.string().trim().min(1).max(80).optional(),
    matchType: z.enum(['contains', 'exact', 'regex']).optional(),
    categoryId: z.string().min(1).optional(),
    priority: z.number().int().min(0).max(9999).optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indica al menos un campo que quieras cambiar.',
  });
export type UpdateMerchantRuleInput = z.infer<typeof updateMerchantRuleSchema>;

// ---------------------------------------------------------------------------
// Reglas de notificación
// ---------------------------------------------------------------------------

export const createNotificationRuleSchema = z.object({
  name: z.string().trim().min(1, 'Dale un nombre a la regla.').max(80),
  match: z.string().trim().min(1, 'Escribe el patrón a detectar.').max(500),
  matchType: z.enum(['contains', 'exact', 'regex']).default('regex'),
  amountGroup: z.number().int().min(0).max(20).nullish(),
  merchantGroup: z.number().int().min(0).max(20).nullish(),
  currencyGroup: z.number().int().min(0).max(20).nullish(),
  isExpense: z.boolean().default(true),
  priority: z.number().int().min(0).max(9999).optional(),
  isEnabled: z.boolean().optional(),
  notes: optionalText(400),
});
export type CreateNotificationRuleInput = z.infer<typeof createNotificationRuleSchema>;

export const updateNotificationRuleSchema = createNotificationRuleSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indica al menos un campo que quieras cambiar.',
  });
export type UpdateNotificationRuleInput = z.infer<typeof updateNotificationRuleSchema>;

export const testNotificationSchema = z.object({
  app: optionalText(60),
  title: optionalText(300),
  subtitle: optionalText(300),
  body: optionalText(1000),
});

/**
 * `POST /api/ingest/notification`
 *
 * Un solo esquema para las dos variantes del Atajo, porque llegan por la misma
 * ruta y se distinguen por la presencia de `amount`:
 *  · Automático → sólo texto de la notificación.
 *  · Manual     → el usuario rellenó importe y comercio.
 */
export const ingestNotificationSchema = z.object({
  app: optionalText(60),
  title: optionalText(300),
  subtitle: optionalText(300),
  body: optionalText(1000),
  /** Momento en que se recibió la notificación. ISO 8601. */
  received_at: optionalText(40),
  timezone: optionalText(64),
  /** Descripción libre en el Atajo manual. */
  text: optionalText(500),
  amount: z.union([z.number(), z.string()]).nullish(),
  merchant: optionalText(120),
  category: optionalText(60),
  /** UUID estable del Atajo: hace idempotente el reintento de la cola offline. */
  client_token: optionalText(80),
});
export type IngestNotificationInput = z.infer<typeof ingestNotificationSchema>;

// ---------------------------------------------------------------------------
// Gastos
// ---------------------------------------------------------------------------

export const createExpenseSchema = z.object({
  amount: amountSchema,
  currency: currencySchema.default('EUR'),
  merchant: optionalText(120),
  description: optionalText(500),
  /** Nombre o slug de la categoría. Si falta, se aplica la categorización automática. */
  category: optionalText(60),
  categoryId: z.string().min(1).nullish(),
  paymentMethod: z.enum(['card', 'cash', 'transfer', 'other']).nullish(),
  /** ISO 8601. Si falta, el servidor usa la hora actual en la zona del usuario. */
  created_at: optionalText(40),
  /** Marca explícita de origen. El Atajo manda `shortcut`. */
  source: z.enum(EXPENSE_SOURCES).default('web'),
  /** UUID estable del Atajo: hace idempotente el reintento de la cola offline. */
  client_token: uuidSchema.nullish(),
  source_transaction_id: optionalText(120),
  /** Zona horaria IANA que declara el cliente, p. ej. `Europe/Madrid`. */
  timezone: optionalText(64),
  /** Permite saltarse la deduplicación automática (dos cafés de 1,20 €). */
  allow_duplicate: z.boolean().optional(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z
  .object({
    amount: amountSchema.optional(),
    currency: currencySchema.optional(),
    merchant: optionalText(120),
    description: optionalText(500),
    category: optionalText(60),
    categoryId: z.string().min(1).nullish(),
    paymentMethod: z.enum(['card', 'cash', 'transfer', 'other']).nullish(),
    /** ISO 8601. */
    created_at: optionalText(40),
    timezone: optionalText(64),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indica al menos un campo que quieras cambiar.',
  });
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

// ---------------------------------------------------------------------------
// Filtros y exportación
// ---------------------------------------------------------------------------

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes'].includes(value.toLowerCase()),
  );

/** Lista separada por comas validada contra el enum: `web,shortcut`. */
const sourceListSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined,
  )
  .pipe(z.array(z.enum(EXPENSE_SOURCES)).min(1).optional());

export const expenseFilterSchema = z.object({
  from: optionalText(40),
  to: optionalText(40),
  /** Mes en formato `YYYY-MM`, con mes entre 01 y 12. */
  month: z
    .string()
    .trim()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Usa el formato YYYY-MM.')
    .nullish(),
  category: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value.split(',').filter(Boolean) : undefined)),
  categoryId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value.split(',').filter(Boolean) : undefined)),
  source: sourceListSchema,
  /** Búsqueda de texto libre sobre comercio y descripción. */
  q: optionalText(80),
  minAmount: z.coerce.number().min(0).max(1e9).nullish(),
  maxAmount: z.coerce.number().min(0).max(1e9).nullish(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).default('date_desc'),
});
export type ExpenseFilterInput = z.infer<typeof expenseFilterSchema>;

export const exportQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx', 'json']).default('csv'),
  from: optionalText(40),
  to: optionalText(40),
  month: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, 'Usa el formato YYYY-MM.')
    .nullish(),
  category: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value.split(',').filter(Boolean) : undefined)),
  source: sourceListSchema,
  q: optionalText(80),
  minAmount: z.coerce.number().min(0).max(1e9).nullish(),
  maxAmount: z.coerce.number().min(0).max(1e9).nullish(),
});
export type ExportQueryInput = z.infer<typeof exportQuerySchema>;

// ---------------------------------------------------------------------------
// Dispositivos
// ---------------------------------------------------------------------------

export const createDeviceTokenSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Dale un nombre al dispositivo, por ejemplo "iPhone de Mario".')
    .max(60),
});

// ---------------------------------------------------------------------------
// Preferencias
// ---------------------------------------------------------------------------

export const updateProfileSchema = z
  .object({
    name: optionalText(80),
    currency: currencySchema.optional(),
    timezone: z
      .string()
      .trim()
      .max(64)
      .optional()
      .refine((value) => value === undefined || isValidTimezoneValue(value), {
        message: 'Zona horaria no válida. Usa un identificador IANA como Europe/Madrid.',
      }),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indica al menos un campo que quieras cambiar.',
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

function isValidTimezoneValue(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export { booleanish };
