# Atajos de Apple

Hay dos Atajos. Ninguno guarda credenciales ni datos de tarjeta: sólo el token de
dispositivo y la URL del servidor.

## Requisitos

- iPhone con **iOS 27** para la captura automática (el disparador *«Cuando se
  reciba una notificación»* no existe antes). En iOS 26 o anterior sólo funciona
  el Atajo manual.
- Una instancia de esta app accesible por HTTPS (o en local para probar).
- Un token de dispositivo: **Ajustes → Tokens de dispositivo → Crear token**.
  Se muestra una sola vez; guárdalo en el llavero de iCloud.

## 1. Atajo automático (notificaciones de Revolut)

Disparador: **Atajos → + → Automation → «Cuando se reciba una notificación»**,
filtrando por la app de Revolut (o cualquier otra).

Pasos:

1. **Obtener el texto de la notificación** (título, subtítulo y cuerpo).
2. **Obtener el contenido del portapapeles** no hace falta: el cuerpo del
   aviso se pasa directamente.
3. **JSON** con el cuerpo:

   ```json
   {
     "app": "Revolut",
     "title": "{{NotificationTitle}}",
     "subtitle": "{{NotificationSubtitle}}",
     "body": "{{NotificationBody}}",
     "received_at": "{{Fecha formato ISO 8601 con desfase}}",
     "timezone": "{{Zona IANA del dispositivo}}",
     "client_token": "{{Identificador único del evento}}"
   }
   ```

   `client_token` es un UUID nuevo **por evento** (acción «Generar texto de
   UUID»). Es lo que hace que un reintento de la cola offline no duplique.
4. **Contenido de URL**: `POST https://TU-DOMINIO/api/ingest/notification`
   - Cabecera `Authorization`: `gk_...`
   - Cabecera `Content-Type`: `application/json`
   - Cuerpo: el JSON anterior.
5. **Si falla** (sin red), guardar `{json, client_token}` en un diccionario
   local y reintentar al recuperar conectividad. El servidor deduplica por
   `client_token`, así que repetir es seguro.

El servidor **siempre responde 200**: el desenlace (`created`, `duplicate`,
`ignored`, `failed`) va dentro de `status`. Un `4xx` sólo significa que no
llegará a crearse nada, no que haya que reintentar.

## 2. Atajo manual (formulario)

Disparador: el botón del icono de Atajos, o «Al tocar» desde una acción
compartida.

1. **Pedir entrada**: importe (texto), comercio (texto), categoría (lista).
   Las opciones de categoría salen de `GET /api/categories/options` con el
   mismo token `Bearer`.
2. Montar el mismo `POST /api/ingest/notification` con:

   ```json
   { "amount": "9,99", "merchant": "Panadería", "category": "Comida",
     "client_token": "<uuid>", "timezone": "<zona IANA>" }
   ```

3. Si el usuario escribe importe, manda lo suyo: el servidor no pasa por el
   parser. Esa es la regla: **lo humano gana sobre lo adivinado**.

## Qué hace el servidor con el texto

1. Reglas de notificación del usuario (prioridad ascendente): gasto, descarte
   (`not_an_expense`), o no entendido.
2. Si ninguna aplica, extractor genérico: busca importe con moneda o decimales
   y comercio tras «en / to / at / bei…».
3. Categoría: regla de comercio → «Otros».
4. Idempotencia: `client_token` → `source_transaction_id` → hash de contenido
   (ventana de 3 minutos) con `UNIQUE (userId, idempotencyKey)` como red de
   seguridad ante carreras.

Puedes probar cualquier texto sin enviar nada desde **Reglas → Probar texto**.

## Limitaciones honestas

- iOS 27 o superior para la ruta automática.
- La notificación debe llegar al iPhone y estar habilitada para la app.
- Si Revolut cambia el redactado de sus avisos, se ajusta una regla en la web;
  no hace falta tocar el Atajo (el Atajo manda texto crudo y nada más).
- El token se revoca desde la web y deja de servir de inmediato.
- No se lee el contenido de otras apps ni se eluden protecciones de iOS: sólo
  se usa la automatización oficial del sistema.
