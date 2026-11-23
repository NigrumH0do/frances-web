import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { mastery } from './mastery';
import { masteryLabel } from './strings';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'mastery.ts'),
  'utf8',
);

test('clasifica el dominio sin las bandas de pronunciación', () => {
  expect(mastery(0, 10, null)).toBe('todo');
  expect(mastery(4, 10, 50)).toBe('doing');
  expect(mastery(10, 10, null)).toBe('done');
  expect(mastery(0, 0, null)).toBe('todo');
  expect(source).not.toMatch(/score\.ts/);
  expect(source).not.toMatch(/scoreBand/);
  expect(source).not.toMatch(/ui\/pron/);
});

test('masteryLabel nombra los tres estados', () => {
  expect(masteryLabel('todo')).toBe('por hacer');
  expect(masteryLabel('doing')).toBe('en curso');
  expect(masteryLabel('done')).toBe('al día');
});
