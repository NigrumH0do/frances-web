import { expect, test } from 'vitest';
import { safeNext } from './next';

test('next only accepts same-app paths', () => {
  expect(safeNext('/temas/tp_1?x=1')).toBe('/temas/tp_1?x=1');
  for (const bad of [
    '//evil.test',
    'https://evil.test',
    '/\\evil',
    'javascript:alert(1)',
    null,
  ]) {
    expect(safeNext(bad)).toBe('/');
  }
});

test('next rechaza rutas internas con esquema o barra invertida', () => {
  expect(safeNext('/temas:secretos')).toBe('/');
  expect(safeNext('/temas\\tp_1')).toBe('/');
  expect(safeNext('')).toBe('/');
  expect(safeNext('entrar')).toBe('/');
});
