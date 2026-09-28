/**
 * Comprobación de humo del backend.
 *
 * No sustituye a las pruebas de extremo a extremo: comprueba que la cadena
 * básica (registro → gasto → duplicado → categorías → reglas → ingesta →
 * exportación → logout) responde lo que debe. Si algo de esto falla, el
 * problema está en la base de datos, la validación o el middleware, y no
 * hace falta depurar la interfaz para encontrarlo.
 */
import assert from 'node:assert/strict';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';
let failures = 0;
let checks = 0;

async function check(name: string, fn: () => Promise<void>) {
  checks += 1;
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures += 1;
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`  FALLA ${name}\n        ${detail}`);
  }
}

interface Result {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
  text: string;
}

const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://localhost:3000';

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Result> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      // El navegador envía `Origin` en toda mutación, y la protección CSRF lo
      // exige. Un cliente real lo haría; sin esta cabecera, los 403 serían
      // artefactos del arnés y no fallos de la aplicación.
      Origin: ORIGIN,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }
  return { status: response.status, body: parsed, headers: response.headers, text };
}

const unique = Date.now().toString(36);

async function main() {
  console.log(`Comprobando ${BASE}\n`);

  const email = `smoke-${unique}@example.com`;
  const password = 'ContrasenaMuyLarga2026';
  const jar = new Map<string, string>();

  const cookieHeader = (): Record<string, string> => {
    const pairs = [...jar.entries()].map(([k, v]) => `${k}=${v}`);
    return pairs.length > 0 ? { cookie: pairs.join('; ') } : {};
  };

  const absorb = (result: Result) => {
    // `getSetCookie` no existe en versiones antiguas de Node; en ese caso se
    // recurre a la cabecera única, que es suficiente porque cada respuesta
    // emite como mucho una cookie.
    const all = typeof result.headers.getSetCookie === 'function'
      ? result.headers.getSetCookie()
      : (() => {
          const single = result.headers.get('set-cookie');
          return single ? [single] : [];
        })();
    for (const entry of all) {
      const [pair] = entry.split(';');
      const index = pair?.indexOf('=') ?? -1;
      if (pair && index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  };

  console.log('Autenticación');

  await check('POST /api/demo/seed genera datos de ejemplo', async () => {
    const result = await call('POST', '/api/demo/seed', { months: 2 });
    assert.ok(result.status === 201 || result.status === 200, `status ${result.status}: ${result.text.slice(0, 200)}`);
  });

  await check('POST /api/auth/register crea la cuenta y la sesión', async () => {
    const result = await call('POST', '/api/auth/register', { email, password, name: 'Prueba' });
    absorb(result);
    assert.equal(result.status, 201, `${result.status}: ${result.text.slice(0, 200)}`);
    assert.ok(jar.has('gi_session'), 'no se fijó la cookie de sesión');
  });

  await check('el registro rechaza contraseñas cortas', async () => {
    const result = await call('POST', '/api/auth/register', { email: `x-${unique}@e.com`, password: 'corta' });
    assert.equal(result.status, 422, `esperaba 422, recibí ${result.status}`);
  });

  await check('GET /api/auth/me devuelve el usuario de la sesión', async () => {
    const result = await call('GET', '/api/auth/me', undefined, cookieHeader());
    assert.equal(result.status, 200, result.text.slice(0, 200));
    const user = result.body.user as { email?: string } | undefined;
    assert.equal(user?.email, email);
  });

  await check('GET /api/expenses exige sesión', async () => {
    const result = await call('GET', '/api/expenses');
    assert.equal(result.status, 401, `esperaba 401, recibí ${result.status}`);
  });

  await check('POST /api/expenses rechaza importes no numéricos', async () => {
    const result = await call('POST', '/api/expenses', { amount: 'mucho', merchant: 'X' }, cookieHeader());
    assert.ok([400, 422].includes(result.status), `esperaba 400/422, recibí ${result.status}`);
  });

  console.log('\nGastos');

  let expenseId = '';
  let categories: { id: string; slug: string }[] = [];

  await check('POST /api/expenses crea un gasto', async () => {
    const result = await call(
      'POST',
      '/api/expenses',
      { amount: '12,50', merchant: 'Panadería', description: 'prueba', source: 'web' },
      cookieHeader(),
    );
    assert.equal(result.status, 201, `${result.status}: ${result.text.slice(0, 300)}`);
    const body = result.body as { status?: string; expense?: { id?: string; amount?: number } };
    assert.equal(body.status, 'created');
    assert.equal(body.expense?.amount, 12.5);
    expenseId = body.expense?.id ?? '';
    assert.ok(expenseId, 'no devolvió id');
  });

  await check('GET /api/expenses lista el gasto creado', async () => {
    const result = await call('GET', '/api/expenses', undefined, cookieHeader());
    assert.equal(result.status, 200, result.text.slice(0, 200));
    const body = result.body as { items?: unknown[] };
    assert.ok((body.items?.length ?? 0) >= 1);
  });

  await check('GET /api/categories devuelve el catálogo inicial', async () => {
    const result = await call('GET', '/api/categories', undefined, cookieHeader());
    assert.equal(result.status, 200, result.text.slice(0, 200));
    const body = result.body as { categories?: { id: string; slug: string }[] };
    categories = body.categories ?? [];
    assert.ok(categories.length >= 8, `sólo ${categories.length} categorías`);
  });

  await check('PATCH /api/expenses/:id asigna categoría', async () => {
    const target = categories.find((c) => c.slug === 'comida');
    assert.ok(target, 'no hay categoría "comida"');
    const result = await call('PATCH', `/api/expenses/${expenseId}`, { categoryId: target.id }, cookieHeader());
    assert.equal(result.status, 200, `${result.status}: ${result.text.slice(0, 200)}`);
    const body = result.body as { expense?: { category?: { slug?: string }; edited?: boolean } };
    assert.equal(body.expense?.category?.slug, 'comida');
    assert.equal(body.expense?.edited, true, 'debería marcar edited');
  });

  await check('POST /api/expenses con el mismo client_token es duplicado', async () => {
    const clientToken = '11111111-2222-4333-8444-555555555555';
    const body = { amount: '4,20', merchant: 'Café', source: 'shortcut', client_token: clientToken };
    const first = await call('POST', '/api/expenses', body, cookieHeader());
    assert.equal(first.status, 201, first.text.slice(0, 200));
    const second = await call('POST', '/api/expenses', body, cookieHeader());
    assert.equal(second.status, 200, `esperaba 200 en el duplicado, recibí ${second.status}`);
    const parsed = second.body as { status?: string };
    assert.equal(parsed.status, 'duplicate');
  });

  await check('dos cafés idénticos sin client_token se registran aparte', async () => {
    const body = { amount: '1,60', merchant: 'Café', source: 'web' };
    const first = await call('POST', '/api/expenses', body, cookieHeader());
    const second = await call('POST', '/api/expenses', body, cookieHeader());
    assert.equal(first.status, 201);
    assert.equal(second.status, 201, 'la web no debe deduplicar compras legítimas');
  });

  await check('GET /api/statistics devuelve totales', async () => {
    const result = await call('GET', '/api/statistics', undefined, cookieHeader());
    assert.equal(result.status, 200, result.text.slice(0, 300));
    const body = result.body as { statistics?: { totals?: { month?: number }; byCategory?: unknown[] } };
    assert.ok(typeof body.statistics?.totals?.month === 'number');
    assert.ok(Array.isArray(body.statistics?.byCategory));
  });

  await check('el filtro por mes inválido se rechaza', async () => {
    const result = await call('GET', '/api/expenses?month=2026-13', undefined, cookieHeader());
    assert.ok([400, 422].includes(result.status), `esperaba 400/422, recibí ${result.status}`);
  });

  await check('un origen de filtro desconocido se rechaza', async () => {
    const result = await call('GET', '/api/expenses?source=inventado', undefined, cookieHeader());
    assert.ok([400, 422].includes(result.status), `esperaba 400/422, recibí ${result.status}`);
  });

  await check('GET /api/export?format=csv devuelve CSV', async () => {
    const result = await call('GET', '/api/export?format=csv', undefined, cookieHeader());
    assert.equal(result.status, 200, result.text.slice(0, 200));
    assert.match(result.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(result.headers.get('content-disposition') ?? '', /attachment/);
    assert.match(result.text, /Importe/);
  });

  await check('GET /api/export?format=json devuelve JSON', async () => {
    const result = await call('GET', '/api/export?format=json', undefined, cookieHeader());
    assert.equal(result.status, 200, result.text.slice(0, 200));
    const parsed = JSON.parse(result.text) as {
      version?: number;
      count?: number;
      expenses?: unknown[];
    };
    // El JSON es un sobre versionado, no una lista desnuda: incluye metadatos
    // para poder interpretarlo mas adelante.
    assert.equal(parsed.version, 1);
    assert.equal(typeof parsed.count, 'number');
    assert.ok(Array.isArray(parsed.expenses));
    assert.equal(parsed.expenses?.length, parsed.count);
  });

  await check('GET /api/export?format=xlsx devuelve un zip válido', async () => {
    const result = await fetch(`${BASE}/api/export?format=xlsx`, { headers: cookieHeader() });
    assert.equal(result.status, 200);
    const buffer = Buffer.from(await result.arrayBuffer());
    // Firma PK de un zip: 'PK\x03\x04'.
    assert.equal(buffer.subarray(0, 4).toString('hex'), '504b0304', 'no es un xlsx válido');
    assert.ok(buffer.byteLength > 1000, `xlsx demasiado pequeño: ${buffer.byteLength}`);
  });

  console.log('\nCategorías y reglas');

  await check('POST /api/categories crea con slug único', async () => {
    const result = await call('POST', '/api/categories', { name: 'Prueba A' }, cookieHeader());
    assert.equal(result.status, 201, result.text.slice(0, 200));
    const first = (result.body as { category: { slug: string } }).category.slug;
    const again = await call('POST', '/api/categories', { name: 'Prueba A' }, cookieHeader());
    const second = (again.body as { category: { slug: string } }).category.slug;
    assert.notEqual(first, second, 'el slug debe desambiguarse');
  });

  await check('POST /api/categories rechaza colores inválidos', async () => {
    const result = await call('POST', '/api/categories', { name: 'X', color: 'rojo' }, cookieHeader());
    assert.equal(result.status, 422, `esperaba 422, recibí ${result.status}`);
  });

  await check('borrar una categoría con gastos responde 409', async () => {
    const target = categories.find((c) => c.slug === 'comida');
    assert.ok(target);
    const result = await call('DELETE', `/api/categories/${target.id}`, {}, cookieHeader());
    assert.equal(result.status, 409, `esperaba 409, recibí ${result.status}: ${result.text.slice(0, 200)}`);
    // La categoria sigue existiendo: un 409 no debe haber tocado nada.
    const check = await call('GET', '/api/categories', undefined, cookieHeader());
    const after = (check.body as { categories?: { id: string }[] }).categories ?? [];
    assert.ok(after.some((c) => c.id === target.id), 'el 409 no deberia haber borrado la categoria');
  });

  await check('POST /api/notification-rules rechaza regex inválida', async () => {
    const result = await call(
      'POST',
      '/api/notification-rules',
      { name: 'Rota', match: 'pago de (', matchType: 'regex', amountGroup: 1 },
      cookieHeader(),
    );
    assert.equal(result.status, 422, `esperaba 422, recibí ${result.status}`);
  });

  await check('POST /api/notification-rules/test simula sin escribir', async () => {
    const result = await call(
      'POST',
      '/api/notification-rules/test',
      { app: 'Revolut', body: 'Pago de 12,50 € en Mercadona' },
      cookieHeader(),
    );
    assert.equal(result.status, 200, result.text.slice(0, 300));
    const body = result.body as { outcome?: { kind?: string; amount?: string } };
    assert.ok(body.outcome, 'no devolvió outcome');
  });

  await check('GET /api/merchant-rules lista reglas', async () => {
    const result = await call('GET', '/api/merchant-rules', undefined, cookieHeader());
    assert.equal(result.status, 200, result.text.slice(0, 200));
  });

  console.log('\nTokens de dispositivo e ingesta');

  let deviceToken = '';

  await check('POST /api/device-tokens emite un token', async () => {
    const result = await call('POST', '/api/device-tokens', { label: 'iPhone de prueba' }, cookieHeader());
    assert.equal(result.status, 201, result.text.slice(0, 200));
    const body = result.body as { token?: string };
    deviceToken = body.token ?? '';
    assert.ok(deviceToken.startsWith('gk_'), 'el token debe empezar por gk_');
  });

  await check('GET /api/device-tokens no expone el token', async () => {
    const result = await call('GET', '/api/device-tokens', undefined, cookieHeader());
    assert.equal(result.status, 200);
    assert.ok(!result.text.includes(deviceToken), '¡el token completo se está exponiendo!');
  });

  await check('POST /api/ingest/notification sin token responde 401', async () => {
    const result = await call('POST', '/api/ingest/notification', { body: 'Pago de 5,00 €' });
    assert.equal(result.status, 401, `esperaba 401, recibí ${result.status}`);
  });

  const auth = { Authorization: `Bearer ${deviceToken}` };

  await check('POST /api/ingest/notification interpreta un pago', async () => {
    const result = await call(
      'POST',
      '/api/ingest/notification',
      { app: 'Revolut', body: 'Pago de 23,45 EUR en Cafetería Central' },
      auth,
    );
    assert.equal(result.status, 200, `${result.status}: ${result.text.slice(0, 300)}`);
    const body = result.body as { status?: string; amount?: string; merchant?: string };
    assert.equal(body.status, 'created', result.text.slice(0, 300));
    assert.equal(body.amount, '23.45');
  });

  await check('la misma notificación dos veces es duplicado', async () => {
    const payload = { app: 'Revolut', body: 'Pago de 23,45 EUR en Cafetería Central' };
    const again = await call('POST', '/api/ingest/notification', payload, auth);
    const body = again.body as { status?: string };
    assert.equal(body.status, 'duplicate', again.text.slice(0, 300));
  });

  await check('un texto sin importe se ignora con 200', async () => {
    const result = await call(
      'POST',
      '/api/ingest/notification',
      { app: 'Revolut', body: 'Nuevo mensaje de Marketing' },
      auth,
    );
    assert.equal(result.status, 200, `esperaba 200, recibí ${result.status}`);
    const body = result.body as { status?: string };
    assert.ok(['ignored', 'failed'].includes(body.status ?? ''), result.text.slice(0, 200));
  });

  await check('el Atajo manual registra un gasto', async () => {
    const result = await call(
      'POST',
      '/api/ingest/notification',
      { amount: '9,99', merchant: 'Prueba Atajo', client_token: crypto.randomUUID() },
      auth,
    );
    assert.equal(result.status, 201, result.text.slice(0, 300));
  });

  await check('GET /api/categories/options sirve al Atajo', async () => {
    const result = await call('GET', '/api/categories/options', undefined, auth);
    assert.equal(result.status, 200, result.text.slice(0, 200));
    const body = result.body as {
      options?: { id: string; name: string; slug: string; color: string }[];
    };
    const options = body.options ?? [];
    assert.ok(options.length >= 8, `sólo ${options.length} opciones`);
    // El Atajo elige por nombre: cada opción debe traer lo justo para pintar
    // un menú, y nada más.
    for (const option of options) {
      assert.deepStrictEqual(Object.keys(option).sort(), ['color', 'id', 'name', 'slug']);
    }
  });

  await check('GET /api/categories/options exige autenticación', async () => {
    const result = await call('GET', '/api/categories/options');
    assert.equal(result.status, 401, `esperaba 401, recibí ${result.status}`);
  });

  await check('DELETE /api/device-tokens/:id revoca el token', async () => {
    const list = await call('GET', '/api/device-tokens', undefined, cookieHeader());
    const tokens = (list.body as { tokens?: { id: string }[] }).tokens ?? [];
    const target = tokens[0];
    assert.ok(target, 'no hay tokens que revocar');

    const result = await call('DELETE', `/api/device-tokens/${target.id}`, undefined, cookieHeader());
    assert.equal(result.status, 200, result.text.slice(0, 200));

    // Tras revocar, el token deja de servir para la ingesta.
    const rejected = await call(
      'POST',
      '/api/ingest/notification',
      { app: 'Revolut', body: 'Pago de 7,77 EUR en Sitio Raro' },
      auth,
    );
    assert.equal(rejected.status, 401, `esperaba 401 tras revocar, recibí ${rejected.status}`);
  });

  await check('revocar dos veces no es un error', async () => {
    const created = await call('POST', '/api/device-tokens', { label: 'Temporal' }, cookieHeader());
    const id = (created.body as { token?: string }).token;
    assert.ok(id);
    const list = await call('GET', '/api/device-tokens', undefined, cookieHeader());
    const tokens = (list.body as { tokens?: { id: string; label: string }[] }).tokens ?? [];
    const target = tokens.find((t) => t.label === 'Temporal');
    assert.ok(target);
    const first = await call('DELETE', `/api/device-tokens/${target.id}`, undefined, cookieHeader());
    const second = await call('DELETE', `/api/device-tokens/${target.id}`, undefined, cookieHeader());
    assert.equal(first.status, 200);
    assert.equal(second.status, 200, `esperaba 200, recibí ${second.status}`);
  });

  await check('un id de token inexistente responde 404', async () => {
    const result = await call(
      'DELETE',
      '/api/device-tokens/00000000-0000-4000-8000-000000000000',
      undefined,
      cookieHeader(),
    );
    assert.equal(result.status, 404, `esperaba 404, recibí ${result.status}`);
  });

  console.log('\nSesión y cierre');

  await check('POST /api/auth/logout destruye la sesión', async () => {
    const result = await call('POST', '/api/auth/logout', {}, cookieHeader());
    absorb(result);
    assert.equal(result.status, 200);
  });

  await check('tras el logout la sesión ya no vale', async () => {
    const result = await call('GET', '/api/auth/me', undefined, cookieHeader());
    assert.equal(result.status, 401, `esperaba 401, recibí ${result.status}`);
  });

  await check('POST /api/auth/login con la cuenta demo funciona', async () => {
    jar.clear();
    const result = await call('POST', '/api/auth/login', {
      email: 'demo@example.com',
      password: 'DemoLocal2026!',
    });
    absorb(result);
    assert.equal(result.status, 200, `${result.status}: ${result.text.slice(0, 200)}`);
  });

  await check('login con contraseña incorrecta responde 401', async () => {
    const result = await call('POST', '/api/auth/login', {
      email: 'demo@example.com',
      password: 'IncorrectaTotal2026!',
    });
    assert.equal(result.status, 401, `esperaba 401, recibí ${result.status}`);
  });

  await check('un gasto de la cuenta demo no es visible para el smoke', async () => {
    // El gasto se creo con la cuenta del smoke, no con la demo. Que un
    // usuario no pueda tocar lo de otro es justo lo que hay que comprobar,
    // asi que el 404 tambien es el resultado correcto aqui.
    const result = await call('DELETE', `/api/expenses/${expenseId}`, undefined, cookieHeader());
    assert.equal(result.status, 404, `esperaba 404, recibí ${result.status}: ${result.text.slice(0, 200)}`);
  });

  await check('al volver a entrar se recupera la sesion propia', async () => {
    jar.clear();
    const result = await call('POST', '/api/auth/login', { email, password });
    absorb(result);
    assert.equal(result.status, 200, result.text.slice(0, 200));
  });

  await check('DELETE /api/expenses/:id borra el gasto', async () => {
    const result = await call('DELETE', `/api/expenses/${expenseId}`, undefined, cookieHeader());
    assert.equal(result.status, 200, result.text.slice(0, 200));
  });

  await check('tras borrar, el gasto ya no existe', async () => {
    const result = await call('GET', `/api/expenses/${expenseId}`, undefined, cookieHeader());
    assert.equal(result.status, 404, `esperaba 404, recibí ${result.status}`);
  });

  console.log(`\n${checks - failures}/${checks} comprobaciones correctas`);
  if (failures > 0) {
    console.log(`${failures} fallo(s).`);
    process.exit(1);
  }
  console.log('Todo correcto.');
}

main().catch((error) => {
  console.error('Fallo inesperado:', error);
  process.exit(1);
});
