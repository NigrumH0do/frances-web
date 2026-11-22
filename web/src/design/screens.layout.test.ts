// Quiebre único a 960 px de Hoy y Texto libre (el 1100 px ya no existe).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const designDir = dirname(fileURLToPath(import.meta.url));

const screensCss = readFileSync(join(designDir, 'screens.css'), 'utf8');
const hoyCss = readFileSync(join(designDir, '../screens/hoy/hoy.css'), 'utf8');
const textoCss = readFileSync(
  join(designDir, '../screens/texto/texto.css'),
  'utf8',
);

// Consultas `@media` que envuelven la regla `selector {`, no la mención suelta.
function mediaQueriesFor(css: string, selector: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const queries: string[] = [];
  for (const match of clean.matchAll(new RegExp(`${escaped}\\s*\\{`, 'g'))) {
    const at = match.index ?? 0;
    const stack: string[] = [];
    for (let i = 0; i < at; i++) {
      if (clean[i] === '{') {
        const head = clean.slice(0, i);
        const query = /@media\b[^{]*$/.exec(head)?.[0]?.trim() ?? '';
        stack.push(query);
      } else if (clean[i] === '}') {
        stack.pop();
      }
    }
    const media = [...stack]
      .reverse()
      .find((query) => query.startsWith('@media'));
    if (media) queries.push(media.replace(/\s+/g, ' '));
  }
  return queries;
}

describe('layout de Hoy y Texto libre', () => {
  test('no queda min-width: 1100px', () => {
    expect(screensCss).not.toContain('min-width: 1100px');
    expect(hoyCss).not.toContain('min-width: 1100px');
    expect(textoCss).not.toContain('min-width: 1100px');
  });

  test('.hoy-grid, .lab-grid y .lab-keys parten en 960 px', () => {
    expect(mediaQueriesFor(hoyCss, '.hoy-grid')).toEqual([
      '@media (min-width: 960px)',
    ]);
    expect(mediaQueriesFor(textoCss, '.lab-grid')).toEqual([
      '@media (min-width: 960px)',
    ]);
    expect(mediaQueriesFor(textoCss, '.lab-keys')).toEqual([
      '@media (min-width: 960px)',
    ]);
  });
});
