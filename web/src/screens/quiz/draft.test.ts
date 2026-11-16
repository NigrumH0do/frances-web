import '@testing-library/jest-dom/vitest';
import { beforeEach, expect, test } from 'vitest';
import {
  clearDraft,
  draftKey,
  isAnswered,
  newDraft,
  readDraft,
  saveDraft,
} from './draft';

beforeEach(() => {
  sessionStorage.clear();
});

test('guarda el borrador por quiz con started_at y respuestas', () => {
  saveDraft('qz_1', {
    started_at: '2026-11-06T10:00:00.000Z',
    answers: { q_1: 'suis', q_2: ['Je', 'suis'] },
  });

  expect(draftKey('qz_1')).toBe('fc-quiz:qz_1');
  expect(readDraft('qz_1')).toEqual({
    started_at: '2026-11-06T10:00:00.000Z',
    answers: { q_1: 'suis', q_2: ['Je', 'suis'] },
  });
});

test('lee y borra solo el borrador del quiz indicado', () => {
  saveDraft('qz_1', { started_at: '2026-11-06T10:00:00.000Z', answers: {} });
  saveDraft('qz_2', { started_at: '2026-11-06T11:00:00.000Z', answers: {} });

  clearDraft('qz_1');

  expect(readDraft('qz_1')).toBeNull();
  expect(readDraft('qz_2')?.started_at).toBe('2026-11-06T11:00:00.000Z');
});

test('un borrador corrupto se descarta', () => {
  sessionStorage.setItem('fc-quiz:qz_1', '{no es json');
  expect(readDraft('qz_1')).toBeNull();

  sessionStorage.setItem(
    'fc-quiz:qz_1',
    JSON.stringify({ started_at: 7, answers: {} }),
  );
  expect(readDraft('qz_1')).toBeNull();
});

test('newDraft usa la hora recibida e isAnswered ignora vacíos', () => {
  expect(newDraft(new Date('2026-11-06T12:00:00.000Z'))).toEqual({
    started_at: '2026-11-06T12:00:00.000Z',
    answers: {},
  });
  expect(isAnswered('  ')).toBe(false);
  expect(isAnswered([])).toBe(false);
  expect(isAnswered('suis')).toBe(true);
  expect(isAnswered(['Je'])).toBe(true);
});
