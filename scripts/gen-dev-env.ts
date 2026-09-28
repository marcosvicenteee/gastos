// Genera un archivo .env de desarrollo con secretos aleatorios.
// No usar en producción: allá los secretos los provee el proveedor.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const authSecret = randomBytes(48).toString('base64');
const deviceSecret = randomBytes(48).toString('base64');

const contents = `# Generado por scripts/gen-dev-env.ts — desarrollo local, no versionar.
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/gastos"
AUTH_SECRET="${authSecret}"
DEVICE_TOKEN_SECRET="${deviceSecret}"
APP_URL="http://localhost:3000"
`;

writeFileSync('.env', contents, 'utf8');
console.log('.env generado con secretos aleatorios.');
