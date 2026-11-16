import type {
  CardView,
  FsrsCard,
  UserCardStateOut,
} from '../contracts/generated';
import { normTs } from '../pron/parse';
import { rate, toFsrsCard, toRecord } from './fsrs';

// Mismos números de ejemplo que UI-05 (`next_of`): así el cliente y el
// servidor prueban la misma forma y los mismos rangos (R-38).
const NOW = new Date('2026-11-06T10:00:00.000Z');
const REVIEWED_AT = '2026-11-06T10:00:00.000000Z';

const UI05_NEXT: FsrsCard = {
  due: '2026-11-05T10:00:00.000000Z',
  stability: 3.1,
  difficulty: 5.2,
  elapsed_days: 0,
  scheduled_days: 3,
  learning_steps: 0,
  reps: 1,
  lapses: 0,
  state: 2,
  last_review: REVIEWED_AT,
};

// Estado previo realista con los mismos números de estabilidad/dificultad.
const PREVIOUS: FsrsCard = {
  ...UI05_NEXT,
  last_review: '2026-11-01T10:00:00.000000Z',
};

function state(fsrs: FsrsCard): UserCardStateOut {
  return {
    card_id: 'c1',
    fsrs,
    suspended: false,
    flagged_hard: false,
    updated_at: '2026-11-01T10:00:00.000000Z',
  };
}

function card(overrides: Partial<CardView> = {}): CardView {
  return {
    id: 'c1',
    kind: 'vocab',
    front_fr: 'bonjour',
    back_es: 'hola',
    example_fr: null,
    example_es: null,
    notes: null,
    ipa: null,
    phonemes: [],
    tags: [],
    stale: false,
    source_item_ids: ['i1'],
    audio: [],
    audio_pending: [],
    owner: 'shared',
    edited_by_human: false,
    source_changed: false,
    mine: null,
    state: state(PREVIOUS),
    ...overrides,
  };
}

test('rate usa ts-fsrs en el cliente y cumple R-38', () => {
  const body = rate(card(), 3, NOW);

  expect(body.card_id).toBe('c1');
  expect(body.rating).toBe(3);
  expect(body.reviewed_at).toBe(REVIEWED_AT);
  expect(body.next.stability).toBeGreaterThan(0);
  expect(body.next.difficulty).toBeGreaterThanOrEqual(1);
  expect(body.next.difficulty).toBeLessThanOrEqual(10);
  expect(new Date(body.next.due).getTime()).toBeGreaterThanOrEqual(
    NOW.getTime(),
  );
  expect(body.next.last_review).toBe(body.reviewed_at);
});

test('rate con una tarjeta nueva también cumple R-38', () => {
  const body = rate(card({ state: null }), 4, NOW);

  expect(body.next.stability).toBeGreaterThan(0);
  expect(body.next.difficulty).toBeGreaterThanOrEqual(1);
  expect(body.next.difficulty).toBeLessThanOrEqual(10);
  expect(new Date(body.next.due).getTime()).toBeGreaterThanOrEqual(
    NOW.getTime(),
  );
  expect(body.next.last_review).toBe(body.reviewed_at);
  expect(body.next.state).not.toBe(0);
});

test('la misma reseña calculada dos veces con el mismo reloj es idéntica', () => {
  expect(rate(card(), 3, NOW)).toEqual(rate(card(), 3, NOW));
});

test('ida y vuelta FsrsCard ↔ SrsRecord sin pérdida', () => {
  const record = toRecord('c1', UI05_NEXT);
  expect(record).toBeDefined();
  expect(toFsrsCard(record!)).toEqual(UI05_NEXT);
  expect(toFsrsCard(record!).due).toBe(UI05_NEXT.due);
  expect(toFsrsCard(record!).last_review).toBe(REVIEWED_AT);
});

test('toRecord sin estado devuelve undefined', () => {
  expect(toRecord('c1', null)).toBeUndefined();
});

test('normTs normaliza las fechas que viajan al servidor', () => {
  expect(normTs(NOW)).toBe(REVIEWED_AT);
});
