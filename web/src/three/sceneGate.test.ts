import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import {
  __resetSceneGateForTests,
  getSceneAvailability,
  setSceneAvailability,
  subscribeSceneAvailability,
} from './sceneGate';

afterEach(() => {
  __resetSceneGateForTests();
});

test('ok → lost → ok → css notifica y el reset vuelve a ok', () => {
  const seen: string[] = [];
  const unsubscribe = subscribeSceneAvailability(() => {
    seen.push(getSceneAvailability());
  });

  expect(getSceneAvailability()).toBe('ok');
  setSceneAvailability('lost');
  setSceneAvailability('ok');
  setSceneAvailability('css');
  expect(seen).toEqual(['lost', 'ok', 'css']);

  unsubscribe();
  setSceneAvailability('lost');
  expect(seen).toEqual(['lost', 'ok', 'css']);

  __resetSceneGateForTests();
  expect(getSceneAvailability()).toBe('ok');
});

test('el fuente no importa three', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'sceneGate.ts'),
    'utf8',
  );
  expect(source).not.toMatch(/from ['"]three['"]/);
});
