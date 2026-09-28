# Gastos iPhone

Gestión de gastos personales con dos vías de captura: **manual** (web y Atajo de
iPhone) y **automática** (notificaciones de Revolut u otra app, recibidas por la
automatización de Atajos de iOS 27). Sin credenciales bancarias, sin scraping y
sin datos de tarjeta.

Stack: **Next.js 15 (App Router) + TypeScript + PostgreSQL + Prisma**, dinero en
`Decimal/NUMERIC`, zonas horarias reales con `Intl`.

## Puesta en marcha

```bash
npm install
npm run db:local        # PostgreSQL embebido en 127.0.0.1:55432
npm run gen:env         # genera .env con secretos aleatorios (sino, copia .env.example)
npm run db:push         # crea el esquema
npm run db:seed         # categorías, reglas por defecto y cuenta demo
npm run dev             # http://localhost:3000
```

Cuenta demo: `demo@example.com` / `DemoLocal2026!`.

Producción: define `DATABASE_URL`, `AUTH_SECRET`, `DEVICE_TOKEN_SECRET` y
`APP_URL` en tu proveedor, ejecuta `npx prisma db push` y `npm run build && npm start`.

## Despliegue en Render

El repositorio trae un blueprint en [`render.yaml`](render.yaml):

1. **New → Blueprint** apuntando a este repositorio.
2. **New → PostgreSQL** en el mismo proyecto (Render enlaza `DATABASE_URL`).
3. Desplegar: el build ejecuta `prisma db push` + `next build`.
4. Primera vez en el shell de Render: `npm run db:seed` (cuenta demo) y, si
   quieres histórico, `npm run seed:demo`.
5. Anota la URL pública en `APP_URL` y usa esa misma URL como dominio del
   Atajo de iPhone.

Los secretos los genera Render (`generateValue: true`); no subas nunca un
`.env` real — está en `.gitignore` y sólo existe `.env.example` en el repo.

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` / `build` / `start` | Servidor de desarrollo / build de producción |
| `npm run lint` | ESLint 9 (flat config) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:local` | PostgreSQL embebido en el puerto 55432 |
| `npm run db:push` / `db:migrate` / `db:studio` | Esquema / migraciones / inspección |
| `npm run db:seed` | Semilla base (categorías + reglas + usuario demo) |
| `npm run seed:demo` | Histórico de gastos de ejemplo (`--months=N`, `--reset`) |
| `npm test` | Tests unitarios (`node:test` sobre `tests/`) |
| `npm run test:e2e` | Extremo a extremo contra el servidor real (puerto 3000) |
| `npm run test:smoke` | Humo de la API completa |
| `npm run test:notifications` | Parser de notificaciones con reglas por defecto |

## Estructura

```
src/app/(app)        Páginas autenticadas: panel, gastos, categorías, reglas, ajustes
src/app/api          Rutas REST (ver docs/API.md)
src/lib              Núcleo: dinero, fechas, idempotencia, validación, exportación
src/lib/services     Lógica de gastos, categorías, estadísticas, demo
src/lib/notifications Parser de notificaciones (reglas + extractor genérico)
src/lib/integrations Contrato de fuentes de transacciones (ver docs/INTEGRACIONES.md)
scripts              Arnéses: e2e, smoke, semillas, Postgres local
tests                Tests unitarios
docs                 API, Atajos, Revolut, integraciones, seguridad
```

## Pruebas

```bash
npm test              # unitarios, sin servidor
npm run build && npm start   # en otra terminal:
npm run test:e2e      # 13 comprobaciones críticas
npm run test:smoke    # 44 comprobaciones de humo
```

La terminación exige las cuatro verdes más `lint`, `typecheck` y `build`.

## Limitaciones conocidas

- La captura automática necesita **iOS 27** (en iOS 26 o anterior los Atajos no
  tienen disparador de notificaciones). Ver `docs/APPLE_SHORTCUTS.md`.
- No existe API pública de Revolut para cuentas personales; no se scraping ni
  se piden credenciales. Ver `docs/REVOLUT.md`.
- El rate limiting vive en memoria: con varias réplicas hay que moverlo a Redis
  (`docs/SEGURIDAD.md`).

## Documentación

- [`docs/API.md`](docs/API.md) — endpoints, autenticación, códigos de estado
- [`docs/APPLE_SHORTCUTS.md`](docs/APPLE_SHORTCUTS.md) — cómo montar los Atajos
- [`docs/REVOLUT.md`](docs/REVOLUT.md) — por qué no hay API y qué hay en su lugar
- [`docs/INTEGRACIONES.md`](docs/INTEGRACIONES.md) — contrato de fuentes
- [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md) — sesiones, tokens, límites, secretos
