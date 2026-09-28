/**
 * Cliente HTTP del navegador.
 *
 * Existe para que ningún componente tenga que escribir un `fetch` suelto. El
 * motivo no es la abreviatura: es que la API responde con una forma concreta
 * de error y repetir el `if (!res.ok) throw ...` en veinte sitios es la forma
 * más rápida de que la mitad de ellos muestre un mensaje distinto.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /**
   * Mensajes de validación por campo, listos para pintar bajo cada input.
   * Devuelve un objeto vacío si el error no es de validación, para que quien
   * lo use no tenga que comprobar la forma.
   */
  get fieldErrors(): Record<string, string> {
    if (!this.details || typeof this.details !== 'object' || Array.isArray(this.details)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.details as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  }
}

/**
 * Error de red o de cliente (servidor caído, sin conexión, CORS). Se distingue
 * de `ApiError` porque la acción correcta es distinta: reintentar, no corregir
 * un formulario.
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      // La cookie de sesión es lo que autentica: sin esta línea el navegador
      // no la envía y toda petición acaba en 401.
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError('No se pudo conectar con el servidor. Revisa la conexión.');
  }

  if (response.status === 204) return undefined as T;

  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const envelope = (payload ?? {}) as {
      error?: { message?: string; code?: string; details?: unknown };
    };
    throw new ApiError(
      response.status,
      envelope.error?.code ?? 'unknown',
      envelope.error?.message ?? `Error ${response.status}.`,
      envelope.error?.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};

/**
 * Dispara la descarga de un archivo.
 *
 * No se puede usar `fetch` + enlace porque la respuesta es binaria y hay que
 * leerla entera; y no se puede usar un `<a download>` con la cookie, porque
 * un enlace normal no envía cabeceras pero sí la cookie, que es justo lo que
 * hace falta aquí. La forma correcta es `fetch` con credenciales y convertir la
 * respuesta en un blob.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin' });
  } catch {
    throw new NetworkError('No se pudo conectar con el servidor. Revisa la conexión.');
  }

  if (!response.ok) {
    throw new ApiError(response.status, 'download_failed', 'No se pudo generar el archivo.');
  }

  // El nombre viene en `Content-Disposition`; si no está, se usa el de reserva.
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Sin revocar, el blob se queda retenido en memoria hasta que se recargue
  // la página.
  URL.revokeObjectURL(url);
}
