# Seguridad

## Sesiones

- Cookie `gi_session` con token aleatorio de 256 bits, `HttpOnly`, `Secure`
  (en producción), `SameSite=Lax`, TTL de 30 días con renovación a 7.
- En la base sólo se guarda el **SHA-256** del token: leer la tabla `Session`
  no permite suplantar a nadie.
- Comparación en tiempo constante en toda verificación (`timingSafeEqual`).

## Contraseñas

- `scrypt` (N=2¹⁵, r=8, p=1, keylen 64) con salt aleatorio y parámetros
  guardados junto al hash para poder subirlos después sin invalidar nada.
- Verificación en tiempo constante que devuelve `false` ante hashes malformados
  en lugar de lanzar, para no filtrar información por tiempos de respuesta.
- Mínimo 10 caracteres, máximo 200, normalización NFKC.

## CSRF

Sólo afecta a las mutaciones con cookie (`src/lib/csrf.ts`):

1. `SameSite=Lax` ya neutraliza los POST cross-site clásicos.
2. Toda mutación debe traer cabecera `Origin` (o `Referer`) del propio origen.
3. Sólo se acepta `Content-Type: application/json` (o vacío), lo que impide
   formularios HTML clásicos.

Las peticiones con `Authorization: Bearer` no dependen de cookies: no son
sensibles a CSRF.

## Tokens de dispositivo

- Prefijo `gk_`, 256 bits de entropía, emitidos desde **Ajustes → Tokens**.
- En la base sólo vive el **hash derivado con `DEVICE_TOKEN_SECRET`** (HMAC):
  el token en claro se muestra una sola vez al crearlo.
- Revocación inmediata (`DELETE /api/device-tokens/:id`, idempotente); tras
  revocar, la ingesta responde `401`.
- Rotar `DEVICE_TOKEN_SECRET` invalida todos los tokens: hay que volver a
  crearlos desde la web.

## Aislamiento de usuarios

- Toda consulta filtra por `userId`; `GET/PATCH/DELETE` de un recurso ajeno
  devuelve `404`, no `403`, para no revelar su existencia.
- Las estadísticas y la exportación usan el mismo `where` que la lista.
- Probado en `scripts/e2e.ts` (dos cuentas cruzándose) y en `scripts/smoke.ts`.

## Validación de entrada

- Zod en la entrada de cada ruta (`src/lib/validation.ts`); un error de
  validación es `422` con mensaje, nunca una excepción de Prisma.
- Importes: texto → `parseAmount` → `Decimal(14,2)`. Un valor no numérico se
  rechaza; **nunca** se convierte en `0`. Redondeo mitad-arriba explícito.
- Fechas: ISO 8601 con o sin desfase, interpretadas en la zona del usuario;
  fechas imposibles (`2026-02-30`, mes 13) se rechazan con `422` en lugar de
  desplazarlas.
- Zonas horarias: sólo identificadores IANA válidos (`Intl`).
- SQL: no hay concatenación — todo pasa por Prisma, que parametriza.

## Idempotencia y deduplicación

- `UNIQUE (userId, idempotencyKey)` es la red de seguridad: dos peticiones
  simultáneas idénticas no pueden crear dos gastos; la perdedora devuelve
  `duplicate`, no `500`.
- Ventana de proximidad de 3 minutos para el hash de contenido, con
  `allow_duplicate` como escape para compras legítimas repetidas.

## Inyección de fórmulas en exportaciones

El CSV prefija con apóstrofo todo valor que empieza por `=`, `+`, `-`, `@`,
tabulador o retorno de carro, y entrecomilla lo que lleva `;` o comillas. Un
comercio llamado `=IMPORTXML(...)` no se ejecuta al abrir el fichero.

## Rate limiting

Cubo de tokens en memoria (`src/lib/rate-limit.ts`), por IP:

| Acción | Capacidad | Recarga |
| --- | --- | --- |
| login | 8 | 8/min |
| registro | 5 | 5/min |
| escritura | 60 | 60/min |
| ingesta (Atajo, legítimamente en ráfaga) | 120 | 120/min |
| lectura | 300 | 300/min |
| exportación | 10 | 10/min |

**Limitación documentada:** el contador vive en la memoria del proceso. Con
una sola instancia es exacto; con varias réplicas (serverless, N pods) cada
una lleva el suyo y un ataque distribuido queda limitado a `N × rate`. Para
multi-instancia hay que sustituir el backing store por Redis/Upstash
manteniendo la misma interfaz `rateLimit()`. La protección crítica — scrypt,
comparación en tiempo constante, tokens con hash, restricción única — no
depende de este módulo.

## Datos sensibles

- No se almacenan credenciales bancarias, números de tarjeta, PIN ni caducidad.
  `paymentMethod` es una etiqueta o `null`.
- No se piden ni guardan credenciales de Revolut: ver [`REVOLUT.md`](REVOLUT.md).
- Los tokens de dispositivo no se devuelven nunca en lecturas (`GET` lista sin
  el secreto); comprobado en el arnés de humo.
- `.env` y `.pgdata` están en `.gitignore`. En producción los secretos los
  aporta el proveedor; en desarrollo se generan con `npm run gen:env`.
