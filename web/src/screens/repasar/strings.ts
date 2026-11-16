import { tr } from '../../l10n/es';

// Textos de la sesión de repaso. Los comunes (cargando, reintentar, sin
// conexión) viven en `l10n/`; aquí solo los de esta pantalla.
export const repasarStrings = {
  title: 'Repasar',
  tabsLabel: 'Modo de repaso',
  tabs: {
    tarjetas: 'Tarjetas',
    pronunciacion: 'Pronunciación',
    texto: 'Texto libre',
  },
  remaining: 'Quedan {n} · ~{min} min',
  progress: '{i}/{total}',
  showAnswer: 'Mostrar respuesta',
  answer: 'Respuesta',
  hardChip: 'Difícil',
  source: 'Fuente: {title}',
  ratingLabel: '¿Qué tal la recordaste?',
  ratings: {
    1: 'Otra vez',
    2: 'Difícil',
    3: 'Bien',
    4: 'Fácil',
  },
  suspend: 'Suspender',
  markHard: 'Marcar difícil',
  suspendedNotice: 'Tarjeta suspendida.',
  hardNotice: 'Tarjeta marcada como difícil.',
  undo: 'Deshacer',
  undoQueuedOffline: 'Sin conexión: el cambio se enviará al volver la red.',
  undoQueuedStale:
    'El cambio se guardó; la cola guardada no se recarga para no repetir reseñas.',
  empty: 'No tienes tarjetas para hoy',
  emptyAction: 'Temas',
  offlineNotice:
    'Sin conexión: las reseñas se guardan y se enviarán al volver la red.',
  summaryTitle: 'Sesión terminada',
  reviewed: 'Repasadas: {n}',
  again: 'Otra vez: {n}',
  pending: 'Guardadas sin conexión: {n}',
  kinds: {
    vocab: 'Vocabulario',
    phrase: 'Frase',
    grammar: 'Gramática',
    conjugation: 'Conjugación',
    drill: 'Taladro',
  },
} as const;

export function remainingLabel(remaining: number): string {
  const minutes =
    remaining === 0 ? 0 : Math.max(1, Math.ceil((remaining * 8) / 60));
  return tr(repasarStrings.remaining, { n: remaining, min: minutes });
}
