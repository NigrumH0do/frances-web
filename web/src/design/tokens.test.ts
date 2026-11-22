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

// Cuerpo del bloque `selector { … }`, contando llaves anidadas.
function blockFor(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const start = clean.indexOf(selector);
  if (start < 0) return '';
  const open = clean.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    if (clean[i] === '}') {
      depth--;
      if (depth === 0) return clean.slice(open + 1, i);
    }
  }
  return '';
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
  ['--c-on-highlight', '--c-highlight'],
  ['--c-gold', '--c-gold-soft'],
];

const DURS = [
  '--dur-fast',
  '--dur-base',
  '--dur-med',
  '--dur-flip',
  '--dur-slow',
] as const;

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

  test('define --c-gold en claro y en las dos paletas oscuras', () => {
    const light = palette(tokens, 'light')['--c-gold'];
    const dark = palette(tokens, 'dark')['--c-gold'];
    const forced = palette(tokens, 'dark-forced')['--c-gold'];

    expect(light).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(dark).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(dark).toBe(forced);
    expect(light).not.toBe(dark);
  });

  test.each(['light', 'dark', 'dark-forced'] as const)(
    '#ffffff sobre --c-record pasa AA en %s',
    (mode) => {
      const record = palette(tokens, mode)['--c-record'];
      expect(record, mode).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(
        contrastRatio('#ffffff', record as string),
        `${mode} #ffffff/${record}`,
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  test('define --c-gold-3d distinto de --c-gold en claro, oscuro y forzado', () => {
    for (const mode of ['light', 'dark', 'dark-forced'] as const) {
      const gold3d = palette(tokens, mode)['--c-gold-3d'];
      const gold = palette(tokens, mode)['--c-gold'];
      expect(gold3d, mode).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(gold3d, mode).not.toBe(gold);
    }
    const light = palette(tokens, 'light')['--c-gold-3d'];
    const dark = palette(tokens, 'dark')['--c-gold-3d'];
    const forced = palette(tokens, 'dark-forced')['--c-gold-3d'];
    expect(light).not.toBe(dark);
    expect(dark).toBe(forced);
  });

  test('declara placeholder, rail, reloj único y el alias de info', () => {
    for (const mode of ['light', 'dark', 'dark-forced'] as const) {
      expect(palette(tokens, mode)['--c-text-placeholder'], mode).toMatch(
        /^#[0-9a-fA-F]{6}$/,
      );
    }
    expect(tokens).toMatch(/--bp-rail:\s*960px/);
    expect(tokens).toMatch(/--rail-w:\s*232px/);
    expect(tokens).toMatch(/--dur-fast:\s*140ms/);
    expect(tokens).toMatch(/--dur-med:\s*320ms/);
    expect(tokens).toMatch(/--dur-slow:\s*520ms/);
    expect(tokens).toMatch(/--c-info:\s*var\(--c-accent\)/);
  });

  test('prefers-reduced-motion y html.motion-off apagan las cinco duraciones', () => {
    const reduced = blockFor(tokens, '@media (prefers-reduced-motion: reduce)');
    const off = blockFor(tokens, 'html.motion-off');
    for (const dur of DURS) {
      expect(reduced, dur).toMatch(new RegExp(`${dur}:\\s*0ms`));
      expect(off, dur).toMatch(new RegExp(`${dur}:\\s*0ms`));
    }
  });
});
