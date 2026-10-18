/**
 * Prueba de extremo a extremo de la ingesta de una notificación de la app
 * Cartera, contra la API que corre de verdad. Comprueba lo que pidió el
 * usuario: el comercio es el local de la segunda línea, el importe es el de la
 * tercera y la nota queda vacía.
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EMAIL = 'demo@example.com';
const PASSWORD = 'DemoLocal2026!';

let cookie = '';

type CallOptions = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

async function call(path: string, options: CallOptions = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    redirect: 'manual',
    headers: {
      ...(cookie ? { cookie } : {}),
      origin: BASE,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* la respuesta no es JSON */
  }
  return { status: response.status, json, text };
}

async function main() {
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (login.status !== 200) throw new Error(`login ${login.status}: ${login.text}`);
  console.log('sesion iniciada');

  // La ingesta por notificación exige token de dispositivo, no la sesión: es lo
  // que usa el Atajo. Se emite uno de prueba y se manda como Bearer.
  const emitido = await call('/api/device-tokens', {
    method: 'POST',
    body: JSON.stringify({ label: 'iPhone de prueba Cartera' }),
  });
  const deviceToken = emitido.json?.token ?? '';
  if (!deviceToken.startsWith('gk_')) {
    throw new Error(`no se emitio token: ${emitido.status} ${emitido.text}`);
  }
  console.log('token de dispositivo emitido');

  // El texto exacto que describio el usuario: banco, local, importe.
  const ingesta = await call('/api/ingest/notification', {
    method: 'POST',
    headers: { authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({
      app: 'Cartera',
      title: 'Santander',
      subtitle: "D'licias 24 horas",
      body: '1,20€',
      payload: { source: 'revolut' },
    }),
  });
  console.log('ingesta', ingesta.status, JSON.stringify(ingesta.json));

  const listado = await call('/api/expenses?limit=10');
  type Gasto = {
    id: string;
    amount: number | string;
    currency: string;
    merchant: string | null;
    description?: string | null;
  };
  const gastos: Gasto[] = listado.json?.items ?? listado.json?.expenses ?? [];
  const gasto = gastos.find((e) => e.merchant === "D'licias 24 horas");

  const fallos = [];
  if (!gasto) {
    fallos.push(
      `no hay ningun gasto con el comercio "D'licias 24 horas" (hay ${gastos.length} en la lista)`,
    );
  } else {
    console.log('gasto guardado:', JSON.stringify(gasto));
    if (String(gasto.amount) !== '1.2') fallos.push(`importe: ${gasto.amount}`);
    if (gasto.currency !== 'EUR') fallos.push(`moneda: ${gasto.currency}`);
    if (gasto.merchant !== "D'licias 24 horas") fallos.push(`comercio: ${gasto.merchant}`);
    // El punto de la petición: la nota no debe traer el texto de la notificación.
    if (gasto.description !== null && gasto.description !== undefined && gasto.description !== '') {
      fallos.push(`la nota deberia estar vacia, viene: ${JSON.stringify(gasto.description)}`);
    }
    if (/santander/i.test(gasto.merchant ?? '')) fallos.push('el banco se guardo como comercio');
  }

  // Limpieza: el gasto de prueba no debe quedarse en la cuenta.
  if (gasto) {
    const borrado = await call(`/api/expenses/${gasto.id}`, { method: 'DELETE' });
    console.log('limpieza', borrado.status);
  }
  // El alta del token no devuelve su id, así que se localiza en el listado
  // por su `hint` y se revoca por id, que es lo que hace la pantalla de Ajustes.
  const tokens = await call('/api/device-tokens');
  type Token = { id: string; label: string };
  const mio: Token | undefined = (tokens.json?.items ?? tokens.json?.tokens ?? []).find(
    (t: Token) => t.label === 'iPhone de prueba Cartera',
  );
  if (mio) {
    const revocado = await call(`/api/device-tokens/${mio.id}`, { method: 'DELETE' });
    console.log('limpieza token', revocado.status);
  } else {
    console.log('limpieza token: no aparece en el listado');
  }

  console.log(
    fallos.length === 0 ? '\nTodo correcto.' : `\nFALLOS:\n- ${fallos.join('\n- ')}`,
  );
  process.exit(fallos.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('error:', e.message);
  process.exit(1);
});
// Modulo propio: evita que las variables de este script choquen con las de
// los demas ficheros de scripts/, que comparten ambito global.
export {};
