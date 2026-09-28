/**
 * Semilla de la base de datos.
 *
 * Se ejecuta con `npm run db:seed` (y también con `npx prisma db seed`).
 * prepara una base recién creada con:
 *
 *  · la cuenta de demostración (`demo@example.com`),
 *  · su catálogo de categorías,
 *  · las reglas de interpretación de notificaciones.
 *
 * No crea gastos: para el histórico de ejemplo está `npm run seed:demo`.
 *
 * Es idempotente. Ejecutarla dos veces no duplica nada y sólo repone lo que
 * falte, así que sirve también para reparar una base a medio configurar.
 *
 * No imprime ningún secreto: la contraseña de la demo es una constante del
 * código, no un valor de entorno.
 */
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/crypto';
import { DEMO_EMAIL, DEMO_PASSWORD, seedBaseData } from '../src/lib/services/demo';

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      passwordHash,
      name: 'Cuenta de demostración',
      isDemo: true,
    },
    select: { id: true },
  });

  await seedBaseData(user.id, { withSuggestedRules: true });

  const [categories, expenses] = await Promise.all([
    prisma.category.count({ where: { userId: user.id } }),
    prisma.expense.count({ where: { userId: user.id } }),
  ]);

  console.log('Base de datos preparada.');
  console.log(`  Cuenta:  ${DEMO_EMAIL}`);
  console.log(`  Clave:   ${DEMO_PASSWORD}`);
  console.log(`  Categorías: ${categories} · Gastos: ${expenses}`);
  if (expenses === 0) {
    console.log('  Sin gastos todavía: ejecuta `npm run seed:demo` para el histórico de ejemplo.');
  }
}

main()
  .catch((error) => {
    console.error('No se pudo preparar la base de datos:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
