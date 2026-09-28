# Revolut

Respuesta corta: **esta app no se conecta a Revolut**. La captura automática se
hace con la automatización oficial de iOS 27, que entrega el texto de la
notificación a un Atajo y de ahí a `POST /api/ingest/notification`.

## Por qué no hay API

Se evaluaron las cuatro vías posibles y ninguna es accesible para una app de
gastos personales:

| Vía | Motivo de descarte |
| --- | --- |
| **API pública para cuentas personales** | No existe. La propia web de Revolut lo dice: *«There's no public API for personal Revolut accounts.»* |
| **Business API** | Sólo para cuentas Business de los planes Grow o superiores, y expone cuentas, beneficiarios y pagos de la empresa — no el histórico de gastos de una persona |
| **Open Banking API (ReadTransactions)** | Exige ser proveedor regulado o partner: aplicación registrada, certificados TLS y de firma emitidos por un QTSP, peticiones firmadas con JWT y consentimiento explícito. No es viable para un proyecto independiente |
| **Scraping de la app** | No se hace: vulneraría los términos de servicio, sería frágil ante cada cambio y requeriría las credenciales del usuario, que esta app **no pide ni almacena jamás** |

Esto también queda reflejado en el código: `src/lib/integrations/registry.ts`
lista estos descartes en `unavailableProviders` y la interfaz los muestra para
que nadie busque un botón «Sincronizar Revolut» que no existe ni va a existir.

## Qué hay en su lugar

```
Notificación de Revolut
   └─ iOS 27 · Atajos · «Cuando se reciba una notificación»   (oficial, del SO)
        └─ POST /api/ingest/notification  (Authorization: Bearer gk_...)
             └─ parser → idempotencia → categorización → Expense
```

- El servidor interpreta el texto; el Atajo sólo lo reenvía.
- Idempotente por `client_token` o hash de contenido: la cola offline puede
  reintentar sin duplicar.
- `source` queda `revolut` y `paymentMethod` queda `null` si el texto no lo
  dice explícitamente.
- Editar el gasto no cambia su origen: se marca `edited = true`.

## Si algún día hay API oficial

Basta con implementar `ExpenseIngestionProvider`
(`src/lib/integrations/types.ts`) y registrarlo en `registry.ts`: idempotencia,
deduplicación, categorización, estadísticas y exportación ya consumen ese
contrato y no cambian. Las credenciales irían en variables de entorno nuevas
documentadas en `.env.example` — nunca en el repositorio.
