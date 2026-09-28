import type { NextRequest } from 'next/server';
import { destroySession } from '@/lib/auth';
import { jsonOk, withErrorHandling } from '@/lib/api';
import { assertSameOrigin } from '@/lib/csrf';

export const runtime = 'nodejs';

/** `POST /api/auth/logout` — destruye la sesión del navegador. */
export const POST = withErrorHandling(async (request: NextRequest) => {
  assertSameOrigin(request);
  await destroySession();
  return jsonOk({ ok: true });
});
