'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertIcon, CheckIcon, XIcon } from './icons';

/**
 * Avisosemergentes.
 *
 * Vive en un contexto y no en un componente por pantalla porque las acciones
 * que necesitan avisar son transversales: un alta puede fallar desde un
 * formulario de gastos, desde el Atajo o desde la página de reglas, y todas
 * necesitan mostrarla igual.
 *
 * `role="status"` con `aria-live="polite"` hace que un lector de pantalla lo
 * anuncie sin interrumpir lo que el usuario esté haciendo.
 */

export type ToastTone = 'success' | 'error';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId++;
      setToasts((current) => [...current, { id, tone, message }]);
      // Los errores se quedan más tiempo que los avisos de éxito: suelen
      // exigir atención y, a diferencia de un "guardado", no se pueden ignorar.
      window.setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  const value = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="card pointer-events-auto flex w-full max-w-md items-start gap-3 px-4 py-3 shadow-pop"
          >
            <span
              className={
                toast.tone === 'success'
                  ? 'mt-0.5 text-positive'
                  : 'mt-0.5 text-negative'
              }
            >
              {toast.tone === 'success' ? <CheckIcon /> : <AlertIcon />}
            </span>
            <p className="flex-1 text-sm">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="text-text-subtle hover:text-text"
              aria-label="Cerrar aviso"
            >
              <XIcon />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast debe usarse dentro de <ToastProvider>.');
  }
  return context;
}
