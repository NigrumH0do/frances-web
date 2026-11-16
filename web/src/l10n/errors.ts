import type { ApiError } from '../contracts/generated';
import type { UiError } from '../components/resource';
import { common } from './es';

const MESSAGES = new Map<ApiError['code'], string>([
  ['unauthenticated', 'Inicia sesión para seguir'],
  ['forbidden', 'No tienes permiso para hacer esto'],
  ['csrf', 'La sesión caducó; recarga la página'],
  ['not_found', 'No encontramos lo que buscabas'],
  ['conflict', 'Esto cambió mientras lo editabas; recarga la página'],
  ['rate_limited', 'Hay demasiadas peticiones; espera un momento'],
  ['busy', 'El servidor está ocupado; inténtalo de nuevo'],
  ['llm_unavailable', 'La IA no está disponible ahora'],
  ['speech_unavailable', 'El audio no está disponible ahora'],
  ['bad_request', 'Revisa los datos e inténtalo de nuevo'],
  ['internal', 'Algo salió mal en el servidor'],
]);

// Texto en español para mostrar a la persona usuaria. Nunca devuelve una cadena vacía.
export function messageFor(e: UiError): string {
  if (e.kind === 'offline') return common.offline;
  const known = MESSAGES.get(e.code);
  if (known !== undefined) return known;
  return e.message || common.unknownError;
}
