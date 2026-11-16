import { tr } from '../../l10n/es';

// Textos de la práctica de pronunciación. Los comunes viven en `l10n/es.ts`.
export const pronunciacionStrings = {
  title: 'Pronunciación',
  modeLabel: 'Modo de práctica',
  phrases: 'Frases',
  phonemeChip: 'Fonema {phoneme}',
  progress: 'Frase {i} de {n}',
  phonemeProgress: 'Fonema /{phoneme}/ · {i} de {n}',
  choosePhoneme: 'Elige un fonema para practicar',
  emptyPhrases: 'No hay frases para practicar hoy',
  emptyPhoneme: 'No hay tarjetas para este fonema',
  emptyAction: 'Temas',
  offline: 'La práctica necesita conexión',
  unavailable: 'La práctica no está disponible ahora',
  rateLimited: 'Límite de práctica por hora',
  finishedTitle: 'Práctica terminada',
  finishedBody: 'Tus intentos quedaron guardados en este dispositivo.',
  practiceAgain: 'Practicar otra vez',
  backToReview: 'Volver a Repasar',
} as const;

export function practiceProgress(
  mode: 'frases' | 'fonema',
  phoneme: string,
  index: number,
  total: number,
): string {
  return tr(
    mode === 'fonema'
      ? pronunciacionStrings.phonemeProgress
      : pronunciacionStrings.progress,
    { i: index + 1, n: total, phoneme },
  );
}
