import { expect, test } from 'vitest';
import { passwordProblems } from './password';

test('passwordProblems cuenta puntos de código tras NFC', () => {
  expect(passwordProblems('e\u0301'.repeat(12))).toEqual([]); // 12 «é» NFC
  expect(passwordProblems('corta')).toEqual(['short']);
});

test('passwordProblems marca largo y confirmación distinta', () => {
  expect(passwordProblems('a'.repeat(129))).toEqual(['long']);
  expect(passwordProblems('a'.repeat(12), 'b'.repeat(12))).toEqual([
    'mismatch',
  ]);
  expect(passwordProblems('a'.repeat(12), 'a'.repeat(12))).toEqual([]);
});

test('passwordProblems compara la confirmación tras NFC', () => {
  expect(passwordProblems('e\u0301'.repeat(12), 'é'.repeat(12))).toEqual([]);
});
