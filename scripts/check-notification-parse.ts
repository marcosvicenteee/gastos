/**
 * Prueba del simulador de notificaciones con salida UTF-8 real.
 *
 * PowerShell muestra `?` en lugar de `€` y de las tildes, así que no sirve
 * para judging estos casos: la pregunta es justamente si el símbolo de moneda
 * se captura o se queda pegado al comercio.
 */
const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';
const ORIGIN = 'http://localhost:3000';

const CASES = [
  'Has pagado 12,50 € en Mercadona con tu tarjeta',
  'Pago de 12,50 € en Mercadona',
  'Has pagado 45,00 EUR en Amazon ES',
  'Pago de 8,99 $ en Burger King',
  'Has pagado 3,20 GBP en Tesco',
  'Recibiste 100,00 € de Ana',
  'Has pagado 1.234,56 € en IKEA',
];

let cookie = '';

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const value of setCookie) cookie = value.split(';')[0];
  return { status: res.status, body: await res.json() };
}

async function main() {
await call('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'demo@example.com', password: 'DemoLocal2026!' }),
});

let fallos = 0;
for (const body of CASES) {
  const { body: result } = await call('/api/notification-rules/test', {
    method: 'POST',
    body: JSON.stringify({ app: 'Revolut', body }),
  });
  const o = result.outcome;
  const esperadoIngreso = /recibiste/i.test(body);
  const problemas = [];

  if (o.ruleName === null && !esperadoIngreso) problemas.push('sin regla');
  if (esperadoIngreso && o.kind === 'expense') problemas.push('ingreso clasificado como gasto');
  if (o.merchant && /[€$£¥]/.test(o.merchant)) {
    problemas.push('el símbolo de moneda se ha colado en el comercio');
  }
  if (o.merchant && /^\W|^en\b|^para\b|^a\b/i.test(o.merchant.trim())) {
    problemas.push(`comercio empieza por ruido: "${o.merchant}"`);
  }

  const marca = problemas.length === 0 ? 'ok  ' : 'FALLA';
  if (problemas.length > 0) fallos += 1;
  console.log(
    `${marca} ${JSON.stringify(body)}\n      -> ${o.kind} importe=${JSON.stringify(o.amount)} ` +
      `moneda=${JSON.stringify(o.currency)} comercio=${JSON.stringify(o.merchant)} ` +
      `regla=${JSON.stringify(o.ruleName)}${problemas.length ? `\n      !! ${problemas.join('; ')}` : ''}`,
  );
}

console.log(fallos === 0 ? '\nTodo correcto.' : `\n${fallos} caso(s) con problemas.`);
process.exit(fallos === 0 ? 0 : 1);
}

main();
