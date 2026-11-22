// Lee motion.css como texto: duraciones, propiedades compuestas y apagado del
// movimiento por preferencia local (frances.motion3d === 'off').
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const motionCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'motion.css'),
  'utf8',
);
const tokensCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'),
  'utf8',
);

// Cuerpo de todas las reglas cuyo selector (lista separada por comas) incluye `sel`.
function ruleFor(css: string, sel: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let body = '';
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] as string).split(',').map((s) => s.trim());
    if (selectors.includes(sel)) body += m[2] as string;
  }
  return body;
}

// Declaración `transition:` de la regla base de `sel` (sin las reglas de
// apagado, que no animan nada).
function transitionFor(css: string, sel: string): string {
  const body = ruleFor(css, sel);
  return /transition:\s*([^;]+);/.exec(body)?.[1] ?? '';
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

describe('motion.css duraciones', () => {
  test('no redefine --dur-fast y usa el token de tokens.css', () => {
    expect(motionCss).not.toMatch(/--dur-fast:\s*180ms/);
    expect(tokensCss).toMatch(/--dur-fast:\s*140ms/);
  });

  test('prefers-reduced-motion y motion-off ponen las duraciones a cero', () => {
    const reduced = blockFor(
      motionCss,
      '@media (prefers-reduced-motion: reduce)',
    );
    expect(reduced).toMatch(/--dur-med:\s*0ms/);
    expect(reduced).toMatch(/--dur-slow:\s*0ms/);

    const off = blockFor(motionCss, ':root.motion-off');
    expect(off).toMatch(/--dur-med:\s*0ms/);
    expect(off).toMatch(/--dur-slow:\s*0ms/);
    expect(motionCss).toContain(':root.motion-off .route-enter');
    expect(motionCss).toContain(':root.motion-off .flip-tilt');
  });
});

describe('motion.css anima solo transform y opacity', () => {
  test('las tarjetas no animan box-shadow ni border-color', () => {
    const card = transitionFor(motionCss, '.card');
    expect(card).toMatch(/transform/);
    expect(card).not.toMatch(/box-shadow|border-color/);
  });

  test('los controles no animan background ni border-color', () => {
    for (const sel of ['.btn-google', '.starter-chip']) {
      const transition = transitionFor(motionCss, sel);
      expect(transition, sel).toMatch(/transform/);
      expect(transition, sel).not.toMatch(/background|border-color/);
    }
  });

  test('el medidor no anima width', () => {
    const meter = transitionFor(motionCss, '.usage-meter-fill');
    expect(meter).not.toMatch(/width/);
  });

  test('el anillo SVG usa --c-success y no el inexistente --c-ok', () => {
    expect(motionCss).not.toContain('var(--c-ok)');
    expect(ruleFor(motionCss, '.score-ring-fg.good')).toMatch(
      /stroke:\s*var\(--c-success\)/,
    );
    // stroke-dashoffset es la única propiedad no compuesta permitida: progresa
    // el arco SVG y está documentada en el archivo.
    expect(motionCss).toMatch(/stroke-dashoffset/);
  });
});
