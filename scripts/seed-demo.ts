/**
 * Histórico de ejemplo para la cuenta de demostración.
 *
 *   npm run seed:demo                → crea o reutiliza (4 meses)
 *   npm run seed:demo -- --months=6  → hasta 12 meses
 *   npm run seed:demo -- --reset     → borra y regenera los gastos
 *
 * Los gastos se generan hacia atrás desde hoy, así que el conjunto siempre
 * parece reciente sin importar cuándo se ejecute. Es idempotente: sin
 * `--reset`, la segunda ejecución no duplica nada.
 */
import { prisma } from '../src/lib/prisma';
import { seedDemoData } from '../src/lib/services/demo';

function readOption(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

async function main() {
  const monthsValue = Number(readOption('months') ?? '4');
  const months = Number.isFinite(monthsValue) ? monthsValue : 4;
  const reset = process.argv.includes('--reset');

  const result = await seedDemoData({ months, reset });

  console.log(result.created ? 'Datos de ejemplo generados.' : 'La cuenta de demo ya existía.');
  console.log(`  Cuenta:  ${result.credentials.email}`);
  console.log(`  Clave:   ${result.credentials.password}`);
  console.log(`  Categorías: ${result.categories} · Gastos: ${result.expenses} · Meses: ${result.months}`);
}

main()
  .catch((error) => {
    console.error('No se pudieron generar los datos de ejemplo:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
