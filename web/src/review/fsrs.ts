// Adaptador entre el contrato de la API (`FsrsCard`/`ReviewIn`, CHG-05/06) y
// el programador FSRS de la web (WEB-08). El cálculo sigue en el cliente
// (R-38): el servidor solo valida y guarda lo que se le manda.

import type { CardView, FsrsCard, ReviewIn } from '../contracts/generated';
import { normTs } from '../pron/parse';
import { schedule } from '../srs/scheduler';
import type { Rating, SrsRecord } from '../srs/types';

export function toRecord(
  cardId: string,
  s: FsrsCard | null,
): SrsRecord | undefined {
  if (s === null) return undefined;

  const record: SrsRecord = {
    card_id: cardId,
    due: new Date(s.due).toISOString(),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
  };
  if (s.last_review !== null) {
    record.last_review = new Date(s.last_review).toISOString();
  }
  return record;
}

export function toFsrsCard(r: SrsRecord): FsrsCard {
  return {
    due: normTs(new Date(r.due)),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: r.elapsed_days,
    scheduled_days: r.scheduled_days,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state as FsrsCard['state'],
    last_review:
      r.last_review !== undefined ? normTs(new Date(r.last_review)) : null,
  };
}

export function rate(card: CardView, rating: Rating, now: Date): ReviewIn {
  const { record } = schedule(
    toRecord(card.id, card.state?.fsrs ?? null),
    rating,
    now,
  );
  return {
    card_id: card.id,
    rating,
    reviewed_at: normTs(now),
    next: toFsrsCard(record),
  };
}
