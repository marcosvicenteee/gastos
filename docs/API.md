# API

Todas las rutas viven bajo `/api` y devuelven JSON. Salvo indicación, el cuerpo
de éxito es `{"data": ...}` o `{"expense": ...}` / `{"items": [...]}` según el
recurso; los errores son `{"error": {"code": ..., "message": ...}}`.

## Autenticación

Dos mecanismos, nunca mezclados:

| Mecanismo | Dónde | Uso |
| --- | --- | --- |
| Cookie `gi_session` (`HttpOnly`, `SameSite=Lax`) | Navegador web | Toda la interfaz |
| Cabecera `Authorization: Bearer gk_...` | Atajos de iPhone | `POST /api/ingest/notification`, `GET /api/categories/options` |

Las mutaciones con cookie exigen además cabecera `Origin` del propio origen y
`Content-Type: application/json` (CSRF). Sin cookie ni token → `401`.

## Endpoints

### Autenticación

| Método | Ruta | Descripción |
| --- | --- | --- |
| POST | `/api/auth/register` | Crea cuenta y sesión (201). Contraseña ≥ 10 caracteres |
| POST | `/api/auth/login` | Abre sesión (200) o `401` |
| POST | `/api/auth/logout` | Destruye la sesión |
| GET | `/api/auth/me` | Usuario actual; si va con token de dispositivo, `{"via": "device_token"}` |
| PATCH | `/api/profile` | Nombre, moneda por defecto, zona horaria |

### Gastos

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/expenses` | Lista con filtros: `from`, `to`, `month=YYYY-MM`, `category`, `categoryId`, `source`, `q`, `minAmount`, `maxAmount`, `limit`, `offset`, `sort` |
| POST | `/api/expenses` | Crea gasto (201) o devuelve `{"status":"duplicate"}` (200) |
| GET | `/api/expenses/:id` | Un gasto |
| PATCH | `/api/expenses/:id` | Edita; **nunca reescribe `source`**, sólo marca `edited=true` |
| DELETE | `/api/expenses/:id` | Borra |

Cuerpo de creación:

```json
{
  "amount": "12,50",
  "currency": "EUR",
  "merchant": "Mercadona",
  "description": "Compra semanal",
  "categoryId": null,
  "paymentMethod": null,
  "created_at": "2026-09-28T00:32:18+02:00",
  "timezone": "Europe/Madrid",
  "source": "web",
  "client_token": "uuid-del-atajo",
  "source_transaction_id": null,
  "allow_duplicate": false
}
```

- `amount` acepta número o texto (`12,50`, `1.250,00`, `8,99 $`); un texto no
  numérico se rechaza con `422`, jamás se convierte en `0`.
- `paymentMethod`: `card | cash | transfer | other | null`. **Si no se conoce,
  va `null`**; no se rellena con `"card"`.
- `source`: `web | shortcut | revolut`.
- `client_token` (UUID del Atajo) y `source_transaction_id` hacen la creación
  idempotente; sin ellos se usa un hash de contenido con ventana de 3 minutos.

### Estadísticas y categorías

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/statistics` | Totales de mes/hoy/semana, comparativa con el mes anterior, por categoría y evolución |
| GET | `/api/categories` | Catálogo con conteo de gastos |
| POST | `/api/categories` | Crea (201), slug único |
| PATCH/DELETE | `/api/categories/:id` | Edita / borra (`409` si tiene gastos) |
| POST | `/api/categories/reorder` | Reordena |
| GET | `/api/categories/options` | Sólo `id,name,slug,color` — pensado para el menú del Atajo (acepta `Bearer`) |

### Reglas

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET/POST | `/api/merchant-rules` | Categorización por comercio (`contains`, `exact`, `regex`) |
| PATCH/DELETE | `/api/merchant-rules/:id` | Edita / borra |
| GET/POST | `/api/notification-rules` | Interpretación de notificaciones (prioridad, grupos, `isExpense`) |
| PATCH/DELETE | `/api/notification-rules/:id` | Edita / borra |
| POST | `/api/notification-rules/test` | Simula con un texto **sin escribir nada** |

### Captura y dispositivos

| Método | Ruta | Descripción |
| --- | --- | --- |
| POST | `/api/ingest/notification` | Entrada del Atajo. **Siempre responde 200**; el resultado va en `status` |
| POST | `/api/device-tokens` | Emite token `gk_...` (se muestra una sola vez) |
| GET | `/api/device-tokens` | Lista tokens **sin** exponer el secreto |
| DELETE | `/api/device-tokens/:id` | Revoca (idempotente) |
| POST | `/api/demo/seed` | Datos de ejemplo |

Dos variantes en la misma ruta de ingesta:

```json
// automática: sólo el texto de la notificación
{ "app": "Revolut", "body": "Pago de 12,50 € en Mercadona",
  "received_at": "2026-09-28T00:32:18+02:00", "client_token": "uuid" }

// manual: lo rellenó el usuario, siempre gana sobre el parser
{ "amount": "9,99", "merchant": "Panadería", "category": "Comida",
  "client_token": "uuid" }
```

`status` posible: `created | duplicate | ignored | failed`.

### Salud y keep-alive

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/health` | **Público y sin BD**: `{"status":"ok","timestamp":...}` |

Pensado para el keep-alive del plan free de Render. El propio servidor hace
`GET` a `SELF_URL/api/health` cada `KEEPALIVE_INTERVAL_MINUTES` (ver
`src/instrumentation.ts`), y sirve además como `healthCheckPath` del blueprint
`render.yaml` y como URL opcional de un pinger externo.

### Exportación

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/export?format=csv` | CSV con BOM UTF-8 y separador `;` |
| GET | `/api/export?format=xlsx` | Libro Excel real (zip OOXML) |
| GET | `/api/export?format=json` | Sobre versionado `{"version":1, ...}` |

Respeta los mismos filtros que `GET /api/expenses`.

## Códigos de estado

| Código | Cuándo |
| --- | --- |
| `401` | Sin sesión o token inválido/revocado |
| `403` | CSRF: `Origin` que no coincide o `Content-Type` no JSON |
| `404` | Recurso inexistente **o de otro usuario** (no se filtra su existencia) |
| `409` | Conflicto, p. ej. borrar categoría con gastos |
| `422` | Validación: importe, fecha, color, regex, zona horaria |
| `429` | Rate limit (`Retry-After` en segundos) |

Límites por minuto: login 8, registro 5, escritura 60, ingesta 120, lectura 300,
exportación 10.
