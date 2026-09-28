# Integraciones

Todas las fuentes de transacciones pasan por un único contrato. La aplicación
no sabe de dónde viene un gasto: sólo recibe algo normalizado.

## Contrato

`src/lib/integrations/types.ts`:

```ts
export interface ExpenseIngestionProvider {
  readonly id: string;            // estable, p. ej. "ios-notification"
  readonly displayName: string;   // legible para la interfaz
  readonly available: boolean;
  readonly description: string;   // cómo funciona y de qué depende, con honestidad
  normalise(raw: unknown, context: IngestContext): Promise<IngestResult[]>;
}
```

`NormalisedTransaction`: `amount` (`Decimal(14,2)`), `currency`, `merchant`,
`expenseDate`, `sourceTransactionId`, `sourceTimezone`, `description`,
`paymentMethod` (`null` si se desconoce).

`IngestResult`: `created | duplicate | ignored | failed`.

## Estado actual

**Disponible** (`availableProviders`):

- `ios-notification` — automatización de notificaciones de iOS 27. No es una
  integración con Revolut: es el sistema operativo el que entrega el texto al
  Atajo, y el Atajo hace el `POST`.

**Descartados** (`unavailableProviders`): API personal de Revolut, Business API,
Open Banking API, scraping, y captura por notificación en iOS 26 o anterior.
El motivo de cada uno está en la lista y se muestra en la interfaz; el detalle
está en [`REVOLUT.md`](REVOLUT.md).

La resolución de la captura por notificación vive en
`src/app/api/ingest/notification/route.ts` (no en el registro) porque necesita
el texto crudo antes de normalizarlo y así conserva la traza para depurar.

## Cómo añadir una fuente

1. Implementar `ExpenseIngestionProvider` en `src/lib/integrations/`.
2. Registrarlo en `registry.ts` (`availableProviders`).
3. Añadir sus credenciales a `.env.example` con un comentario que explique de
   dónde se obtienen. **Nunca** versionar valores reales.
4. Si la fuente trae id propio, añadir el mapeo a `source_transaction_id` para
   que la deduplicación sea por identificador y no por contenido.
5. Cubrir el camino nuevo en `scripts/e2e.ts`.

Nada del resto de la app cambia: idempotencia, categorización, estadísticas y
exportación ya dependen del contrato, no del proveedor.

## Reglas que no se negocian

- Sin credenciales bancarias en la base de datos, en logs ni en el cliente.
- Sin scraping ni automatización de la app de un banco.
- Sin números de tarjeta, PIN ni caducidad: `paymentMethod` es una etiqueta
  (`card`, `cash`, `transfer`, `other`) o `null`.
- Dinero siempre en `Decimal` / `NUMERIC(14,2)`.
