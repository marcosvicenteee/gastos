import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';
import { ToastProvider } from '@/components/toast';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage() {
  // Si ya hay sesión, entrar otra vez no tiene sentido: se manda al resumen.
  if (await getCurrentUser()) redirect('/');

  return (
    <ToastProvider>
      <AuthForm mode="login" />
    </ToastProvider>
  );
}
