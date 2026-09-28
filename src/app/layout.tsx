import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Gastos',
    template: '%s · Gastos',
  },
  description: 'Control de gastos personales con captura desde el iPhone.',
  // Es una aplicación privada: no tiene sentido que un buscador la indexe ni
  // que las previsualizaciones sociales la muestren.
  robots: { index: false, follow: false },
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // `viewport-fit=cover` más `env(safe-area-inset-*)` deja el contenido fuera
  // del notch y del indicador de inicio de los iPhone modernos.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1c20' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      {/*
        El tema se decide antes de pintar. Si se hiciera en un efecto de React,
        la página aparecería un instante en claro antes de pasar a oscuro.
        Este script se ejecuta en el <head>, antes del primer pintado.
      */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-dvh bg-page text-text antialiased">
        {children}
      </body>
    </html>
  );
}
