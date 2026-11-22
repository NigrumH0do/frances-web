export type Mastery = 'todo' | 'doing' | 'done';

// Dominio de un tema. No usa las bandas 90/75/60 de pronunciación.
export function mastery(
  cardsLearned: number,
  cardsTotal: number,
  lastQuizScore: number | null,
): Mastery {
  if (cardsLearned === 0 && lastQuizScore === null) return 'todo';
  if (cardsTotal > 0 && cardsLearned >= cardsTotal) return 'done';
  return 'doing';
}
