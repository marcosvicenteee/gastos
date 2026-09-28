import type { ExpenseIngestionProvider } from './types';

/**
 * Registro de fuentes de transacciones.
 *
 * Hoy sólo existe la captura por notificación de iOS 27. Si en el futuro
 * hubiera una API oficial de un proveedor, se añade su implementación aquí y
 * el resto de la aplicación no cambia: todas las fuentes entran por el mismo
 * contrato `ExpenseIngestionProvider` y comparten idempotencia,
 * categorización y deduplicación.
 */

/**
 * Proveedor de referencia: automatización de notificaciones de iOS 27.
 *
 * No es una integración con Revolut (no usamos ninguna API suya, ni
 * automatizamos su app): es la automatización oficial del sistema operativo
 * que entrega el texto de la notificación al Atajo. El Atajo hace el
 * `POST` y esta capa decide qué hacer con el texto.
 */
export const notificationIngestionProvider = {
  id: 'ios-notification',
  displayName: 'Notificaciones de iOS 27',
  available: true,
  description:
    'Automatización de Atajos «Cuando se recibe una notificación». ' +
    'Funciona con cualquier app que envíe notificaciones (Revolut incluida), ' +
    'sin credenciales y sin scrapear nada.',
} as const;

/** Fuentes actualmente disponibles. */
export const availableProviders: ExpenseIngestionProvider[] = [
  // La captura por notificación se resuelve directamente en la capa de rutas
  // (ver `src/app/api/ingest/notification/route.ts`) porque necesita leer el
  // texto crudo antes de normalizar, y así conserva la traza para depurar.
  notificationIngestionProvider as unknown as ExpenseIngestionProvider,
];

/**
 * Fuentes evaluadas y descartadas, con el motivo. Se muestran en la interfaz
 * para que el usuario entienda por qué no hay un botón de "sincronizar
 * Revolut" en lugar de dejarle buscando un botón que no existe.
 */
export const unavailableProviders: {
  id: string;
  displayName: string;
  reason: string;
}[] = [
  {
    id: 'revolut-personal-api',
    displayName: 'API de Revolut (cuenta personal)',
    reason:
      'Revolut no ofrece API pública para cuentas personales. Su web lo dice ' +
      'de forma explícita: "There\'s no public API for personal Revolut accounts."',
  },
  {
    id: 'revolut-business-api',
    displayName: 'API de Revolut Business',
    reason:
      'Sólo para cuentas Business de los planes Grow o superiores, y orientada a ' +
      'cuentas, beneficiarios y pagos de la propia empresa, no a un histórico de ' +
      'gastos personales.',
  },
  {
    id: 'revolut-open-banking',
    displayName: 'Open Banking API de Revolut',
    reason:
      'Permite leer transacciones (ReadTransactions), pero exige ser proveedor ' +
      'regulado o partner de Revolut, con certificados TLS y de firma emitidos por ' +
      'un QTSP y peticiones firmadas con JWT. No es accesible a un proyecto ' +
      'independiente, y no podemos pedirte que asumas esa figura legal.',
  },
  {
    id: 'revolut-scraping',
    displayName: 'Scraping de la app de Revolut',
    reason:
      'No se implementa. Vulneraría los términos de servicio de Revolut, sería ' +
      'frágil ante cualquier cambio y require credenciales de tu cuenta, que esta ' +
      'aplicación no pide ni almacena en ningún caso.',
  },
  {
    id: 'ios-shortcut-notification',
    displayName: 'Atajos leyendo notificaciones en iOS 26 o anterior',
    reason:
      'Antes de iOS 27 los Atajos no tienen ningún disparador de notificación: no ' +
      'existe forma oficial de que un Atajo reciba el contenido de una notificación ' +
      'de otra app. Si usas iOS 26 o anterior, la captura automática no es posible y ' +
      'sólo queda el Atajo manual.',
  },
];
