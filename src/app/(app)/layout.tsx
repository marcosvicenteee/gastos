import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { ToastProvider } from '@/components/toast';
import { getCurrentUser } from '@/lib/auth';

/**
 * Zona privada de la aplicación.
 *
 * La comprobación de sesión vive aquí, en el servidor, y no en cada página.
 * Es la diferencia entre "olvidé proteger esta ruta" (un error por página,
 * que sólo se detecta al probarla) y "todo lo que hay bajo este layout está
 * protegido" (una decisión, en un sitio).
 *
 * La redirección se resuelve en el servidor a propósito: si se comprobara en
 * el cliente, la página protegida se descargaría, se ejecutaría y sólo después
 * aparecería el formulario de acceso, con un parpadeo.
 */
export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/entrar');

  return (
    <ToastProvider>
      <AppShell>{children}</AppShell>
    </ToastProvider>
  );
}
