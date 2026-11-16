// Vista previa de los intervalos de las cuatro calificaciones, calculada con
// el mismo programador FSRS que `rate` (sin efectos ni red). UI-15 la usa
// para el texto de cada botón de la barra de calificación.

import type { CardView } from '../contracts/generated';
import { schedule } from '../srs/scheduler';
import type { Rating } from '../srs/types';
import { toRecord } from './fsrs';

const RATINGS: readonly Rating[] = [1, 2, 3, 4];

function formatInterval(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 10) return '<10 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;

  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} h`;

  const days = hours / 24;
  if (days < 30) return `${Math.round(days)} d`;
  if (days < 365) return `${Math.round(days / 30)} m`;
  return `${Math.round(days / 365)} a`;
}

export function previewIntervals(
  card: CardView,
  now: Date,
): Record<Rating, string> {
  const record = toRecord(card.id, card.state?.fsrs ?? null);
  const intervals = {} as Record<Rating, string>;
  for (const rating of RATINGS) {
    const next = schedule(record, rating, now).record;
    intervals[rating] = formatInterval(
      new Date(next.due).getTime() - now.getTime(),
    );
  }
  return intervals;
}
