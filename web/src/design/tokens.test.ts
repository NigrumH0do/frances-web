// Lee tokens.css como texto y comprueba el contraste WCAG AA de cada paleta.
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio } from '../ui/layout/contrast';

const tokens = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'),
  'utf8',
);

type Mode = 'light' | 'dark' | 'dark-forced';

// Devuelve el cuerpo de cada bloque `selector { … }`, sin comentarios.
function blocks(css: string): Map<string, string> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const key = (m[1] as string).trim();
    out.set(key, (out.get(key) ?? '') + (m[2] as string));
  }
  return out;
}

function palette(css: string, mode: Mode): Record<string, string> {
  const selector = {
    light: ':root',
    dark: ':root:not(.theme-light)',
    'dark-forced': ':root.theme-dark',
  }[mode];
  const body = blocks(css).get(selector);
  if (body === undefined) throw new Error(`sin bloque ${selector}`);
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) {
    vars[m[1] as string] = m[2] as string;
  }
  return vars;
}

const PAIRS_TEXT: [string, string][] = [
  ['--c-text', '--c-bg'],
  ['--c-text', '--c-card'],
  ['--c-text', '--c-surface'],
  ['--c-text-muted', '--c-card'],
  ['--c-text-faint', '--c-card'],
  ['--c-accent', '--c-card'],
  ['--c-on-accent', '--c-accent'],
  ['--c-on-accent-soft', '--c-accent-soft'],
  ['--c-success', '--c-success-soft'],
  ['--c-warning', '--c-warning-soft'],
  ['--c-danger', '--c-danger-soft'],
  ['--c-streak', '--c-streak-soft'],
  ['--c-rate-again', '--c-card'],
  ['--c-rate-hard', '--c-card'],
  ['--c-rate-good', '--c-card'],
  ['--c-rate-easy', '--c-card'],
];

describe('tokens.css', () => {
  test.each(['light', 'dark'] as const)('pasa AA en la paleta %s', (mode) => {
    const p = palette(tokens, mode);
    for (const [fg, bg] of PAIRS_TEXT) {
      expect(
        contrastRatio(p[fg] as string, p[bg] as string),
        `${fg}/${bg}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrastRatio(p['--c-border-strong'] as string, p['--c-card'] as string),
    ).toBeGreaterThanOrEqual(3);
  });

  test('la paleta oscura forzada y la del sistema son idénticas', () => {
    expect(palette(tokens, 'dark')).toEqual(palette(tokens, 'dark-forced'));
  });

  test('define la escala de tamaño táctil de 44 px', () => {
    expect(tokens).toMatch(/--tap:\s*44px/);
  });
});
