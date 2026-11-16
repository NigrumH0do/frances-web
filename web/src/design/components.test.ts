// Lee components.css como texto: objetivos de 44 px y movimiento reducido.
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'components.css'),
  'utf8',
);
const legacyCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'legacy.css'),
  'utf8',
);

// Cuerpo de todas las reglas cuyo selector (lista separada por comas) incluye `sel`.
function ruleFor(text: string, sel: string): string {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  let body = '';
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] as string).split(',').map((s) => s.trim());
    if (selectors.includes(sel)) body += m[2] as string;
  }
  return body;
}

// Cuerpo de los bloques @media cuya condición contiene `query`.
function mediaBlock(text: string, query: string): string {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const start = clean.indexOf(`@media (${query})`);
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

describe('components.css', () => {
  test('cada control interactivo declara 44 px', () => {
    for (const sel of [
      '.btn',
      '.btn-icon',
      '.list-item',
      '.tabbar a',
      '.option',
      '.segmented button',
      '.switch',
      '.input',
      '.select',
      '.chip-filter::after',
    ]) {
      expect(ruleFor(css, sel), sel).toMatch(
        /min-(height|block-size):\s*var\(--tap(-lg)?\)/,
      );
    }
  });

  test('movimiento reducido anula volteo, esqueletos, spinners y pensando', () => {
    const block = mediaBlock(css, 'prefers-reduced-motion: reduce');
    for (const sel of ['.flip-inner', '.skeleton', '.spinner', '.thinking']) {
      expect(block, sel).toContain(sel);
    }
    expect(block).toMatch(
      /\*\s*\{[^}]*transition-duration:\s*0\.01ms\s*!important/,
    );
  });

  test('sin restos del marco ni del catálogo de las maquetas', () => {
    for (const sel of [
      '.phone',
      '.statusbar',
      '.specimen',
      '.theme-toggle',
      '.swatch',
      '.stage',
    ]) {
      expect(css).not.toContain(`${sel} {`);
    }
  });

  test('la barra inferior pasa a riel lateral desde 900 px', () => {
    const wide = mediaBlock(css, 'min-width: 900px');
    expect(wide).toMatch(/\.tabbar\s*\{[^}]*position:\s*sticky/);
    expect(wide).toMatch(/width:\s*88px/);
  });
});

describe('objetivos táctiles de 44 px en controles reusados (FIX-18)', () => {
  test('las pestañas de Tabs declaran 44 px', () => {
    const body = ruleFor(css, "[role='tab']");
    expect(body).toMatch(/min-height:\s*var\(--tap\)/);
    expect(body).toMatch(/min-width:\s*var\(--tap\)/);
  });

  test('el selector de voz del reproductor declara 44 px', () => {
    const body = ruleFor(legacyCss, '.audio-player select');
    expect(body).toMatch(/min-height:\s*var\(--tap\)/);
    expect(body).toMatch(/min-width:\s*var\(--tap\)/);
  });

  test('el botón de grabación de la práctica declara 44 px', () => {
    const body = ruleFor(legacyCss, '.practice-session > button');
    expect(body).toMatch(/min-height:\s*var\(--tap\)/);
    expect(body).toMatch(/min-width:\s*var\(--tap\)/);
  });
});

describe('contraste AA de tabs y grabación (CHG-16)', () => {
  test('[role=tab] usa fondo y color del sistema, también al seleccionar', () => {
    const tab = ruleFor(css, "[role='tab']");
    expect(tab).toMatch(/background:\s*var\(--c-card\)/);
    expect(tab).toMatch(/color:\s*var\(--c-text-muted\)/);
    expect(tab).toMatch(/border:\s*1px solid var\(--c-border-strong\)/);
    expect(ruleFor(css, "[role='tab']:hover")).toMatch(
      /background:\s*var\(--c-surface\)/,
    );
    const selected = ruleFor(css, "[role='tab'][aria-selected='true']");
    expect(selected).toMatch(/background:\s*var\(--c-accent-soft\)/);
    expect(selected).toMatch(/color:\s*var\(--c-on-accent-soft\)/);
  });

  test('.practice-session > button usa fondo y color del sistema', () => {
    const button = ruleFor(legacyCss, '.practice-session > button');
    expect(button).toMatch(/background:\s*var\(--c-card\)/);
    expect(button).toMatch(/color:\s*var\(--c-text\)/);
    expect(button).toMatch(/border:\s*1px solid var\(--c-border-strong\)/);
    expect(ruleFor(legacyCss, '.practice-session > button:hover')).toMatch(
      /background:\s*var\(--c-surface\)/,
    );
  });
});

describe('components.css: estado activo y esqueletos (UI-03)', () => {
  test('la opción activa de Segmented se ve con aria-checked', () => {
    expect(ruleFor(css, ".segmented [aria-checked='true']")).toMatch(
      /box-shadow|background/,
    );
  });

  test('las clases de esqueleto viven en components.css', () => {
    for (const sel of [
      '.skeleton-title',
      '.skeleton-line',
      '.skeleton-block',
    ]) {
      expect(ruleFor(css, sel), sel).not.toBe('');
    }
  });
});
