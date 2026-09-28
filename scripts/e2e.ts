/**
 * Pruebas de extremo a extremo sobre el servidor real.
 *
 * A diferencia de los tests unitarios, aquí no se sustituye nada: se lanza el
 * servidor (`npm run build && npm start`, o `npm run dev`) y se le hablan sus
 * endpoints HTTP de verdad, con cookies y tokens reales.
 *
 * Cubre los cinco escenarios críticos que no se pueden comprobar aislados:
 *
 *  1. Dos peticiones idénticas simultáneas → un solo gasto.
 *  2. Aislamiento total entre dos cuentas.
 *  3. La ingesta de una notificación deja `paymentMethod` en `null`.
 *  4. Editar un gasto automático conserva el origen y la zona de origen.
 *  5. Las estadísticas de un usuario nunca cuentan gastos de otro.
 *
 * Uso: `npm run test:e2e` con el servidor escuchando en el puerto 3000.
 */
import assert from 'node:assert/strict';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const ORIGIN = process.env.E2E_ORIGIN ?? 'http://localhost:3000';

let checks = 0;
let failures = 0;

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

interface SerialisedExpense {
  id: string;
  amount: number;
  merchant: string | null;
  source: string;
  paymentMethod: string | null;
  expenseDate: string;
  sourceTimezone: string | null;
  edited: boolean;
}

/** Una cuenta con su propia galleta de sesión: nada de estado compartido. */
function createClient() {
  const jar = new Map<string, string>();

  const cookieHeader = (): Record<string, string> => {
    const pairs = [...jar.entries()].map(([k, v]) => `${k}=${v}`);
    return pairs.length > 0 ? { cookie: pairs.join('; ') } : {};
  };

  const absorb = (result: Result) => {
    const all =
      typeof result.headers.getSetCookie === 'function'
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
        Origin: ORIGIN,
        ...headers,
        ...cookieHeader(),
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

  async function register(email: string, password: string) {
    const result = await call('POST', '/api/auth/register', { email, password, name: 'E2E' });
    absorb(result);
    assert.equal(result.status, 201, `registro: ${result.status}: ${result.text.slice(0, 200)}`);
    assert.ok(jar.has('gi_session'), 'no se fijó la cookie de sesión');
  }

  async function getExpense(id: string): Promise<SerialisedExpense> {
    const result = await call('GET', `/api/expenses/${id}`);
    assert.equal(result.status, 200, `GET /api/expenses/:id → ${result.status}`);
    return (result.body as { expense: SerialisedExpense }).expense;
  }

  async function search(q: string): Promise<SerialisedExpense[]> {
    const result = await call('GET', `/api/expenses?q=${encodeURIComponent(q)}`);
    assert.equal(result.status, 200, `búsqueda → ${result.status}`);
    return ((result.body as { items?: SerialisedExpense[] }).items ?? []);
  }

  return { call, absorb, register, getExpense, search, cookieHeader };
}

async function main() {
  console.log(`E2E contra ${BASE}\n`);
  const unique = Date.now().toString(36);

  const a = createClient();
  const b = createClient();

  const marker = `E2E_${unique}`;

  await check('las dos cuentas de prueba se registran', async () => {
    await a.register(`e2a-${unique}@example.com`, 'ContrasenaE2ELarga2026');
    await b.register(`e2b-${unique}@example.com`, 'ContrasenaE2ELarga2026');
  });

  console.log('\n1. Dos envíos simultáneos no duplican');

  const racePayload = {
    amount: '19,99',
    merchant: `Carrera_${marker}`,
    source: 'revolut',
    created_at: '2026-09-20T10:15:00',
    timezone: 'Europe/Madrid',
  };

  let raceExpenseId = '';

  await check('dos POST idénticos simultáneos crean exactamente un gasto', async () => {
    const [first, second] = await Promise.all([
      a.call('POST', '/api/expenses', racePayload),
      a.call('POST', '/api/expenses', racePayload),
    ]);

    for (const result of [first, second]) {
      assert.ok(
        [200, 201].includes(result.status),
        `status ${result.status}: ${result.text.slice(0, 200)}`,
      );
    }

    const statuses = [first, second].map((r) => (r.body as { status?: string }).status);
    const created = statuses.filter((s) => s === 'created').length;
    const duplicated = statuses.filter((s) => s === 'duplicate').length;
    assert.equal(created, 1, `gastos creados: ${created} (estados: ${statuses.join(', ')})`);
    assert.equal(duplicated, 1, `duplicados detectados: ${duplicated} (estados: ${statuses.join(', ')})`);

    const winner = statuses[0] === 'created' ? first : second;
    const body = winner.body as { expense?: { id?: string } };
    raceExpenseId = body.expense?.id ?? '';
    assert.ok(raceExpenseId, 'el gasto creado no devolvió id');
  });

  await check('la lista confirma que sólo existe uno', async () => {
    const items = await a.search(`Carrera_${marker}`);
    assert.equal(items.length, 1, `se listaron ${items.length} gastos con el mismo contenido`);
  });

  console.log('\n2. Aislamiento entre cuentas');

  await check('B no ve ningún gasto de A', async () => {
    const seenByB = await b.search(`Carrera_${marker}`);
    assert.equal(seenByB.length, 0, `B vio ${seenByB.length} gastos ajenos`);
    const seenByA = await a.search(`Carrera_${marker}`);
    assert.equal(seenByA.length, 1, 'A sí debe ver su gasto');
  });

  await check('B no puede leer ni editar el gasto de A', async () => {
    const read = await b.call('GET', `/api/expenses/${raceExpenseId}`);
    assert.equal(read.status, 404, `lectura ajena → ${read.status}`);
    const patch = await b.call('PATCH', `/api/expenses/${raceExpenseId}`, { merchant: 'Vandalo' });
    assert.equal(patch.status, 404, `edición ajena → ${patch.status}`);
    const del = await b.call('DELETE', `/api/expenses/${raceExpenseId}`);
    assert.equal(del.status, 404, `borrado ajeno → ${del.status}`);

    const untouched = await a.getExpense(raceExpenseId);
    assert.equal(untouched.merchant, `Carrera_${marker}`, 'B modificó el gasto de A');
  });

  console.log('\n3. Ingesta de notificación');

  let deviceToken = '';

  await check('A emite un token de dispositivo', async () => {
    const result = await a.call('POST', '/api/device-tokens', { label: 'iPhone E2E' });
    assert.equal(result.status, 201, `${result.status}: ${result.text.slice(0, 200)}`);
    deviceToken = (result.body as { token?: string }).token ?? '';
    assert.ok(deviceToken.startsWith('gk_'), 'token inesperado');
  });

  const auth = { Authorization: `Bearer ${deviceToken}` };
  const ingestMerchant = `Ingesta_${marker}`;
  let ingestExpenseId = '';

  await check('la notificación crea un gasto', async () => {
    const result = await a.call(
      'POST',
      '/api/ingest/notification',
      { app: 'Revolut', body: `Pago de 6,50 EUR en ${ingestMerchant}` },
      auth,
    );
    assert.equal(result.status, 200, `${result.status}: ${result.text.slice(0, 300)}`);
    const body = result.body as { status?: string };
    assert.equal(body.status, 'created', result.text.slice(0, 300));

    const items = await a.search(ingestMerchant);
    assert.equal(items.length, 1, `se esperaba un gasto, hay ${items.length}`);
    ingestExpenseId = items[0]!.id;
  });

  await check('el método de pago desconocido queda en null, nunca en "card"', async () => {
    const expense = await a.getExpense(ingestExpenseId);
    assert.equal(expense.paymentMethod, null, `paymentMethod = ${String(expense.paymentMethod)}`);
    assert.equal(expense.source, 'revolut');
    assert.equal(expense.sourceTimezone, 'Europe/Madrid');
  });

  console.log('\n4. Editar conserva el origen');

  await check('cambiar el comercio no reescribe el origen', async () => {
    const before = await a.getExpense(ingestExpenseId);
    const result = await a.call('PATCH', `/api/expenses/${ingestExpenseId}`, {
      merchant: `${ingestMerchant}_corregido`,
    });
    assert.equal(result.status, 200, `${result.status}: ${result.text.slice(0, 200)}`);
    const after = (result.body as { expense: SerialisedExpense }).expense;

    assert.equal(after.source, 'revolut', 'la edición cambió el origen');
    assert.equal(after.edited, true, 'no se marcó como editado');
    assert.equal(after.paymentMethod, null, 'la edición inventó método de pago');
    assert.equal(after.sourceTimezone, before.sourceTimezone, 'se reescribió la zona de origen');
    assert.equal(after.expenseDate, before.expenseDate, 'la edición movió la fecha');
  });

  await check('un gasto manual sin método de pago también queda en null', async () => {
    const created = await a.call('POST', '/api/expenses', {
      amount: '3,10',
      merchant: `Manual_${marker}`,
      source: 'web',
    });
    assert.equal(created.status, 201, created.text.slice(0, 200));
    const id = ((created.body as { expense?: { id?: string } }).expense?.id) ?? '';
    assert.ok(id, 'sin id');
    const expense = await a.getExpense(id);
    assert.equal(expense.paymentMethod, null, `paymentMethod = ${String(expense.paymentMethod)}`);
  });

  console.log('\n5. Estadísticas por usuario');

  const bigAmount = 777.77;

  await check('A registra un gasto del mes en curso', async () => {
    const result = await a.call('POST', '/api/expenses', {
      amount: '777,77',
      merchant: `Total_${marker}`,
      source: 'web',
    });
    assert.equal(result.status, 201, result.text.slice(0, 200));
  });

  await check('el total del mes de A incluye su gasto', async () => {
    const result = await a.call('GET', '/api/statistics');
    assert.equal(result.status, 200, result.text.slice(0, 300));
    const stats = (result.body as { statistics?: { totals?: { month?: number } } }).statistics;
    assert.equal(typeof stats?.totals?.month, 'number', 'sin total de mes');
    assert.ok(
      stats!.totals!.month! >= bigAmount,
      `total de A = ${stats!.totals!.month}, esperaba >= ${bigAmount}`,
    );
  });

  await check('el total del mes de B es cero: no hereda nada de A', async () => {
    const result = await b.call('GET', '/api/statistics');
    assert.equal(result.status, 200, result.text.slice(0, 300));
    const stats = (result.body as { statistics?: { totals?: { month?: number } } }).statistics;
    assert.equal(
      stats?.totals?.month,
      0,
      `total de B = ${String(stats?.totals?.month)}, esperaba 0`,
    );
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
