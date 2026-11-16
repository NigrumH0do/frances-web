import { beforeEach, expect, test } from 'vitest';
import { forgetText, HISTORY_MAX, loadHistory, rememberText } from './history';

beforeEach(() => {
  localStorage.clear();
});

test('guarda el texto primero y sin duplicados', () => {
  rememberText('u1', 'Bonjour', new Date('2026-11-15T10:00:00Z'));
  rememberText('u1', 'Merci', new Date('2026-11-15T10:01:00Z'));
  const list = rememberText(
    'u1',
    '  bonjour ',
    new Date('2026-11-15T10:02:00Z'),
  );
  expect(list.map((entry) => entry.text)).toEqual(['bonjour', 'Merci']);
});

test('cada usuario tiene su propia lista', () => {
  rememberText('u1', 'Bonjour');
  expect(loadHistory('u2')).toEqual([]);
});

test(`recorta a ${HISTORY_MAX} textos`, () => {
  for (let i = 0; i < HISTORY_MAX + 3; i += 1) {
    rememberText('u1', `Phrase ${i}`);
  }
  const list = loadHistory('u1');
  expect(list).toHaveLength(HISTORY_MAX);
  expect(list[0]?.text).toBe(`Phrase ${HISTORY_MAX + 2}`);
});

test('ignora datos corruptos y textos vacíos', () => {
  localStorage.setItem('frances.texto.history.v1:u1', '{no es json');
  expect(loadHistory('u1')).toEqual([]);
  expect(rememberText('u1', '   ')).toEqual([]);
});

test('forgetText quita un texto', () => {
  rememberText('u1', 'Bonjour');
  rememberText('u1', 'Merci');
  expect(forgetText('u1', 'BONJOUR').map((entry) => entry.text)).toEqual([
    'Merci',
  ]);
});
