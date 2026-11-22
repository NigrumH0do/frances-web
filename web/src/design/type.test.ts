// Lee index.css: Spectral 700 autoalojado y cifras en tabular-nums.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const indexCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'index.css'),
  'utf8',
);

function ruleFor(css: string, sel: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let body = '';
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] as string).split(',').map((s) => s.trim());
    if (selectors.includes(sel)) body += m[2] as string;
  }
  return body;
}

describe('index.css tipografía', () => {
  test('carga Spectral 700 autoalojado, sin @import http', () => {
    const latin600 = indexCss.indexOf(
      "@import '@fontsource/spectral/latin-600.css'",
    );
    const latin700 = indexCss.indexOf(
      "@import '@fontsource/spectral/latin-700.css'",
    );
    expect(latin600).toBeGreaterThanOrEqual(0);
    expect(latin700).toBeGreaterThan(latin600);
    expect(indexCss).not.toMatch(/@import[^;]*http/);
  });

  test('las cifras de interfaz usan tabular-nums', () => {
    for (const sel of ['.week-counts', '.rating .btn small']) {
      const body = ruleFor(indexCss, sel);
      expect(body, sel).toMatch(/tabular-nums/);
      expect(body, sel).toMatch(/font-feature-settings:\s*'tnum'\s*1/);
    }
  });
});
