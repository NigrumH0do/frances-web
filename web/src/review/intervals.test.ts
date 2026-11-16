import type { CardView, FsrsCard } from '../contracts/generated';
import { previewIntervals } from './intervals';

const NOW = new Date('2026-11-06T10:00:00.000Z');

const FSRS: FsrsCard = {
  due: '2026-11-05T10:00:00.000000Z',
  stability: 3.1,
  difficulty: 5.2,
  elapsed_days: 0,
  scheduled_days: 3,
  learning_steps: 0,
  reps: 1,
  lapses: 0,
  state: 2,
  last_review: '2026-11-05T10:00:00.000000Z',
};

const REVIEW_CARD_VIEW: CardView = {
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
  state: {
    card_id: 'c1',
    fsrs: FSRS,
    suspended: false,
    flagged_hard: false,
    updated_at: '2026-11-05T10:00:00.000000Z',
  },
};

function toMinutes(text: string): number {
  if (text === '<10 min') return 1;
  const value = Number.parseInt(text, 10);
  if (text.endsWith('min')) return value;
  if (text.endsWith('h')) return value * 60;
  if (text.endsWith('d')) return value * 24 * 60;
  if (text.endsWith('m')) return value * 30 * 24 * 60;
  if (text.endsWith('a')) return value * 365 * 24 * 60;
  throw new Error(`intervalo desconocido: ${text}`);
}

test('previewIntervals da un texto por calificación y crece con la nota', () => {
  const p = previewIntervals(REVIEW_CARD_VIEW, NOW);

  expect(Object.keys(p)).toEqual(['1', '2', '3', '4']);
  expect(p[1]).toBe('10 min');
  expect(p[2]).toBe('5 d');
  expect(p[3]).toBe('6 d');
  expect(p[4]).toBe('9 d');
  const minutes = [p[1], p[2], p[3], p[4]].map(toMinutes);
  expect(minutes[1]).toBeGreaterThan(minutes[0]);
  expect(minutes[2]).toBeGreaterThan(minutes[1]);
  expect(minutes[3]).toBeGreaterThan(minutes[2]);
});

test('previewIntervals no modifica la tarjeta ni pide red', () => {
  const before = structuredClone(REVIEW_CARD_VIEW);
  previewIntervals(REVIEW_CARD_VIEW, NOW);
  expect(REVIEW_CARD_VIEW).toEqual(before);
});

test('previewIntervals de una tarjeta nueva usa minutos para los pasos cortos', () => {
  const p = previewIntervals({ ...REVIEW_CARD_VIEW, state: null }, NOW);

  expect(Object.keys(p)).toEqual(['1', '2', '3', '4']);
  expect(p[1]).toBe('<10 min');
  expect(toMinutes(p[4])).toBeGreaterThan(toMinutes(p[3]));
});
