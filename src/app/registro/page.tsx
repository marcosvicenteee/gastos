import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { ToastProvider } from '@/components/toast';
import { getCurrentUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Crear cuenta' };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect('/');

  return (
    <ToastProvider>
      <AuthForm mode="register" />
    </ToastProvider>
  );
}
