/**
 * Contrato para fuentes de transacciones.
 *
 * ## Estado actual
 *
 * La única fuente automática activa hoy es la **automatización de
 * notificaciones de iOS 27**, que entra por HTTP en
 * `POST /api/ingest/notification` y se implementa como
 * `NotificationIngestionProvider` más abajo.
 *
 * ## Por qué existe esta capa
 *
 * La intención original era sincronizar Revolut automáticamente. Se investigó y
 * la vía oficial no es accesible para una app de gastos personales:
 *
 *  · **No hay API pública para cuentas personales.** La propia web de Revolut
 *    dice: "There's no public API for personal Revolut accounts."
 *  · **La Business API** sólo existe para cuentas Business de los planes Grow
 *    o superiores, y da acceso a cuentas, beneficiarios y pagos, no a un
 *    histórico de gastos personales de otra persona.
 *  · **La Open Banking API** (ReadTransactions) sí expone transacciones, pero
 *    exige ser proveedor regulado o partner de Revolut, registrar la
 *    aplicación, y presentar certificados de transporte TLS y de firma emitidos
 *    por un QTSP, con peticiones firmadas mediante JWT y consentimiento
 *    explícito del usuario. No es accesible a un proyecto independiente.
 *
 * No se hace scraping de la app de Revolut, no se piden credenciales al
 * usuario y no se intenta eludir ninguna protección de iOS.
 *
 * ## Cómo añadir una fuente en el futuro
 *
 * Si algún día existiera un proveedor con API oficial (o el usuario firms un
 * acuerdo de partner), basta con implementar `ExpenseIngestionProvider` y
 * registrarla en `registry.ts`. El resto de la aplicación —idempotencia,
 * categorización, deduplicación, estadísticas, exportación— ya consume este
 * contrato y no cambia.
 */

import type { Prisma } from '@prisma/client';

export interface NormalisedTransaction {
  /** Importe positivo en Decimal(14,2). */
  amount: Prisma.Decimal;
  currency: string;
  merchant: string | null;
  /** Fecha y hora del pago según el proveedor. */
  expenseDate: Date;
  /** Identificador estable de la transacción en el proveedor. */
  sourceTransactionId: string;
  /** Zona horaria IANA que declara el proveedor. */
  sourceTimezone: string | null;
  description: string | null;
  paymentMethod: string | null;
}

export interface IngestContext {
  userId: string;
  /** Token de dispositivo que originó el evento, si viene de un Atajo. */
  deviceTokenId: string | null;
  /** Zona horaria del usuario, usada como respaldo. */
  userTimezone: string;
}

export type IngestResult =
  | { outcome: 'created'; expenseId: string; transaction: NormalisedTransaction }
  | { outcome: 'duplicate'; expenseId: string; reason: string }
  | { outcome: 'ignored'; reason: string }
  | { outcome: 'failed'; reason: string; detail?: unknown };

export interface ExpenseIngestionProvider {
  /** Identificador estable, p. ej. `revolut-notification`. */
  readonly id: string;
  /** Nombre legible para la interfaz. */
  readonly displayName: string;
  /** `false` mientras la fuente no esté disponible para el usuario. */
  readonly available: boolean;
  /** Explicación honesta de cómo funciona y de qué depende. */
  readonly description: string;

  /** Transforma una respuesta cruda del proveedor en transacciones normalizadas. */
  normalise(raw: unknown, context: IngestContext): Promise<IngestResult[]>;
}
