/**
 * Servidor PostgreSQL local para desarrollo, sin Docker.
 *
 * Usa `embedded-postgres`, que descarga los binarios oficiales de PostgreSQL
 * (windows-x64 / linux-x64 / darwin-*). En producción se usa el PostgreSQL
 * gestionado que se quiera (Neon, Supabase, RDS, Railway...). Para producción
 * sólo cambia `DATABASE_URL`.
 *
 * Uso:
 *   npm run db:local          -> arranca y se queda en primer plano
 *   npm run db:local -- --stop -> detiene el clúster
 */
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), '.pgdata');
const PORT = Number(process.env.PGPORT ?? 55432);
const USER = 'postgres';
const PASSWORD = 'postgres';
const DATABASE = 'gastos';

const shouldStop = process.argv.includes('--stop');
const shouldReset = process.argv.includes('--reset');

function dataDirFor(): string {
  if (process.env.PGDATA_OVERRIDE) return process.env.PGDATA_OVERRIDE;
  return DATA_DIR;
}

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: dataDirFor(),
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    onLog: () => {},
    onError: (message: unknown) => {
      if (process.env.PG_VERBOSE) console.error('[pg]', message);
    },
  });

  if (shouldStop) {
    await pg.stop();
    console.log('PostgreSQL local detenido.');
    return;
  }

  if (shouldReset) {
    try {
      await pg.stop();
    } catch {
      // el clúster quizá no estaba arrancado
    }
    if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
    console.log('Datos locales eliminados. Vuelve a ejecutar `npm run db:local`.');
    return;
  }

  if (!existsSync(dataDirFor())) mkdirSync(dataDirFor(), { recursive: true });

  const alreadyInitialised = existsSync(path.join(dataDirFor(), 'PG_VERSION'));

  if (!alreadyInitialised) {
    console.log('Inicializando clúster PostgreSQL local (primera vez, puede tardar)...');
    await pg.initialise();
  }

  await pg.start();
  await ensureDatabase(pg, DATABASE);

  console.log('');
  console.log('  PostgreSQL local listo');
  console.log(`  DATABASE_URL=postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}`);
  console.log('');
  console.log('  No cierres esta ventana. Ctrl+C para detener.');
  console.log('');

  // Mantiene el proceso vivo.
  await new Promise(() => {});
}

/**
 * Crea la base de datos sólo si no existe.
 *
 * `createDatabase` falla si el nombre ya está en uso, así que llamarlo sin
 * comprobar hacía que el segundo arranque del servidor abortara con un error
 * poco descriptivo. Se consultan antes las bases existentes.
 */
async function ensureDatabase(pg: EmbeddedPostgres, name: string): Promise<void> {
  const client = new Client({
    host: '127.0.0.1',
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: 'postgres',
  });
  try {
    await client.connect();
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount === 0) {
      await pg.createDatabase(name);
      console.log(`  Base de datos "${name}" creada.`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error('No se pudo arrancar PostgreSQL local:', error);
  process.exit(1);
});
