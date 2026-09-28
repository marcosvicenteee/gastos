import { FlatCompat } from '@eslint/eslintrc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Configuración de ESLint en formato plano (ESLint 9).
 *
 * `next lint` desaparece en Next 16 y además arranca un asistente interactivo
 * la primera vez, lo que hace imposible ejecutar el lint en un pipeline. Por
 * eso el lint se ejecuta con el binario de ESLint directamente
 * (`npm run lint`) y la configuración vive aquí.
 *
 * `FlatCompat` traduce los paquetes `next/core-web-vitals` y
 * `next/typescript`, que todavía se publican en formato eslintrc.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    // Con ESLint 9, `eslint .` sólo examina los archivos que alguno de los
    // bloques declara en `files`. Sin esta línea, los `.ts`/`.tsx` se quedarían
    // fuera y el lint terminaría sin comprobar nada.
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.pgdata/**',
      'next-env.d.ts',
      'postcss.config.mjs',
    ],
  },
];

export default config;
