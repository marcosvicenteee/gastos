/**
 * Reproducción del caso real de la app Cartera.
 *
 * La notificación de Cartera es de tres líneas y la primera es el emisor:
 *
 *   Santander              <- emisor (banco), NO es el comercio
 *   D'licias 24 horas      <- comercio (el local donde se pagó)
 *   1,20€                  <- importe
 *
 * Se ejecutan variantes porque el Atajo puede mandar el texto partido en
 * `title`/`subtitle`/`body` o todo en `body`, y no siempre en el mismo sitio.
 */
import { parseNotification, DEFAULT_NOTIFICATION_RULES, toRuleLike } from '../src/lib/notifications/parse';

const CASOS = [
  {
    nombre: 'tres líneas en body',
    payload: { app: 'Cartera', title: null, subtitle: null, body: 'Santander\nD\'licias 24 horas\n1,20€' },
  },
  {
    nombre: 'emisor en title, resto en body',
    payload: { app: 'Cartera', title: 'Santander', subtitle: null, body: 'D\'licias 24 horas\n1,20€' },
  },
  {
    nombre: 'importe con espacio antes del símbolo',
    payload: { app: 'Cartera', title: 'Santander', subtitle: null, body: "D'licias 24 horas\n1,30 €" },
  },
  {
    nombre: 'texto plano pegado, como llegó al usuario',
    payload: { app: 'Cartera', title: null, subtitle: null, body: "Santander\nD'licias 24 horas\n1,20€" },
  },
  {
    nombre: 'con línea intermedia de operación',
    payload: { app: 'Cartera', title: null, subtitle: null, body: 'Santander\nCompra con tarjeta\nD\'licias 24 horas\n1,20€' },
  },
  {
    nombre: 'alias Wallet en inglés',
    payload: { app: 'Wallet', title: null, subtitle: null, body: "Santander\nD'licias 24 horas\n1,20€" },
  },
  {
    // Sin saltos de línea no hay forma de saber dónde acaba el emisor y
    // empieza el local. No es un fallo del parser: debe avisar de ello.
    nombre: 'Atajo que aplana las líneas',
    payload: { app: 'Cartera', title: null, subtitle: null, body: 'SantanderDlicias 24 horas 1,20€' },
    esperaAviso: true,
  },
];

const REGLAS_REVOLUT_EN_UNA_LINEA = [
  'Pago de 12,50 € en Mercadona',
  'Has pagado 12,50 € a Mercadona',
  'Paid 12.50 EUR to Mercadona',
];

const rules = DEFAULT_NOTIFICATION_RULES.map((rule, index) =>
  toRuleLike({
    ...rule,
    id: `regla-${index}`,
    sourceApp: null,
    categoryId: null,
    category: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as never),
);

let fallos = 0;
for (const caso of CASOS) {
  const outcome = parseNotification(caso.payload, rules);
  const problemas: string[] = [];

  if (outcome.kind !== 'expense') {
    problemas.push(`no se registró como gasto (${outcome.kind})`);
  } else {
    if (outcome.amount !== '1,20' && outcome.amount !== '1,30') {
      problemas.push(`importe raro: ${JSON.stringify(outcome.amount)}`);
    }
    if (outcome.currency !== 'EUR') {
      problemas.push(`moneda rara: ${JSON.stringify(outcome.currency)}`);
    }
    const merchant = outcome.merchant ?? '';
    if (caso.esperaAviso) {
      if (outcome.hint === null) {
        problemas.push('sin aviso: el texto aplanado pasa desapercibido');
      }
    } else {
      if (outcome.hint !== null) {
        problemas.push(`aviso inesperado: ${outcome.hint}`);
      }
      if (/santander/i.test(merchant)) problemas.push(`el comercio es el banco: ${merchant}`);
      if (!/d.?licias/i.test(merchant)) {
        problemas.push(`el comercio no es el local: ${JSON.stringify(merchant)}`);
      }
    }
  }

  if (problemas.length > 0) fallos += 1;
  console.log(
    `${problemas.length === 0 ? 'ok  ' : 'FALLA'} ${caso.nombre}\n      ${JSON.stringify(caso.payload.body)}\n      -> ${JSON.stringify(outcome)}${problemas.length ? `\n      !! ${problemas.join('; ')}` : ''}`,
  );
}

// Regresión: el formato en una línea que ya funcionaba no debe romperse al
// añadir la regla de tres líneas, que tiene prioridad por delante.
for (const texto of REGLAS_REVOLUT_EN_UNA_LINEA) {
  const outcome = parseNotification({ app: 'Cartera', title: null, subtitle: null, body: texto }, rules);
  const problemas: string[] = [];
  if (outcome.kind !== 'expense') problemas.push(`ya no se registra (${outcome.kind})`);
  else {
    if (outcome.merchant !== 'Mercadona') problemas.push(`comercio: ${JSON.stringify(outcome.merchant)}`);
    // El separador se conserva tal cual ("12.50"); el importe acaba en una
        // columna numérica, así que los dos formatos valen.
    if (!/^12[.,]50$/.test(outcome.amount)) problemas.push(`importe: ${JSON.stringify(outcome.amount)}`);
  }
  if (problemas.length > 0) fallos += 1;
  console.log(
    `${problemas.length === 0 ? 'ok  ' : 'FALLA'} una línea: ${texto}` +
      (problemas.length ? `\n      !! ${problemas.join('; ')}` : `\n      -> ${JSON.stringify(outcome)}`),
  );
}

console.log(fallos === 0 ? '\nTodo correcto.' : `\n${fallos} caso(s) sin resolver.`);