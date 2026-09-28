import type { NextRequest } from 'next/server';
import { jsonCreated, withErrorHandling } from '@/lib/api';
import { readJson } from '@/lib/server/route-helpers';
import { seedDemoData } from '@/lib/services/demo';
import { z } from 'zod';
import { RATE_LIMITS, enforceRateLimit, clientKey } from '@/lib/rate-limit';
import { assertSameOrigin } from '@/lib/csrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  months: z.coerce.number().int().min(1).max(12).optional(),
  reset: z.coerce.boolean().optional(),
});

/**
 * `POST /api/demo/seed`
 *
 * Genera la cuenta de demostración. **No requiere autenticación a propósito**:
 * es la puerta de entrada para probar la aplicación, y los datos que crea son
 * ficticios y se pueden borrar con `reset`.
 *
 * Lo que sí se protege:
 *  · El origen de la petición (CSRF), igual que en el registro.
 *  · Un límite por IP. Generar el conjunto son miles de inserts; sin tope,
 *    cualquiera podria usarlo para degradar la base de datos.
 *  · Una credencial fija y pública. Quien entre con ella ve sólo datos
 *    inventados, nunca los de una cuenta real.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  assertSameOrigin(request);
  enforceRateLimit(request, RATE_LIMITS.register, 'demo-seed', clientKey(request));

  const body = await readJson(request, bodySchema);
  const result = await seedDemoData({ months: body.months, reset: body.reset });

  return jsonCreated({
    ...result,
    loginUrl: '/entrar',
    note: result.created
      ? 'Datos de demostración generados.'
      : 'La cuenta de demostración ya existía. Usa reset para regenerarla.',
  });
});
