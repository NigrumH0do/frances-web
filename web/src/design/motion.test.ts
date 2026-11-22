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

// `@media` aún abierto en la posición de `needle` (sin contar su propia regla).
function mediaEnclosing(css: string, needle: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = clean.indexOf(needle);
  if (at < 0) return '';
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
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]?.startsWith('@media')) return stack[i] ?? '';
  }
  return '';
}

// Selectores de clase de un fragmento, sin el prefijo `html.motion-off`.
function classSelectors(cssChunk: string): string[] {
  const found = new Set<string>();
  for (const match of cssChunk.matchAll(/([^{}]+)\{/g)) {
    for (const raw of (match[1] as string).split(',')) {
      const normalized = raw.replace(/html\.motion-off/g, '').trim();
      if (normalized.startsWith('.')) found.add(normalized);
    }
  }
  return [...found].sort();
}

const DUR_DECL = /--dur-(?:fast|base|med|flip|slow)\s*:/;

// Thinking (`.thinking` / `.dots`) vive en components.css, no en esta hoja.
const MOTION_OFF_SELECTORS = [
  '.flip-tilt',
  '.route-enter',
  '.score-ring-fg',
  '.usage-meter-fill',
];

describe('motion.css duraciones', () => {
  test('no redefine --dur-fast y usa el token de tokens.css', () => {
    expect(motionCss).not.toMatch(/--dur-fast:\s*180ms/);
    expect(tokensCss).toMatch(/--dur-fast:\s*140ms/);
  });

  test('no declara --dur-fast, --dur-base, --dur-med, --dur-flip ni --dur-slow', () => {
    expect(motionCss).not.toMatch(DUR_DECL);
  });

  test('html.motion-off apaga las mismas clases que reduced-motion, sin --dur-*', () => {
    const reduced = blockFor(
      motionCss,
      '@media (prefers-reduced-motion: reduce)',
    );
    const clean = motionCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const offAt = clean.indexOf('html.motion-off');
    const off = offAt < 0 ? '' : clean.slice(offAt);

    expect(reduced).not.toMatch(DUR_DECL);
    expect(off).not.toMatch(DUR_DECL);
    expect(motionCss).not.toContain(':root.motion-off');
    expect(motionCss).toContain('html.motion-off .route-enter');
    expect(motionCss).toContain('html.motion-off .flip-tilt');

    expect(classSelectors(reduced)).toEqual(MOTION_OFF_SELECTORS);
    expect(classSelectors(off)).toEqual(MOTION_OFF_SELECTORS);

    for (const sel of ['.score-ring-fg', '.usage-meter-fill']) {
      expect(ruleFor(reduced, sel), sel).toMatch(/transition:\s*none/);
      expect(ruleFor(off, `html.motion-off ${sel}`), sel).toMatch(
        /transition:\s*none/,
      );
    }
    expect(ruleFor(reduced, '.route-enter')).toMatch(/animation:\s*none/);
    expect(ruleFor(off, 'html.motion-off .route-enter')).toMatch(
      /animation:\s*none/,
    );
    expect(ruleFor(reduced, '.flip-tilt')).toMatch(/transition:\s*none/);
    expect(ruleFor(off, 'html.motion-off .flip-tilt')).toMatch(
      /transition:\s*none/,
    );
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

  test('.usage-meter-fill.warn usa --c-warning y no --c-danger', () => {
    const warn = ruleFor(motionCss, '.usage-meter-fill.warn');
    expect(warn).toMatch(/background:\s*var\(--c-warning\)/);
    expect(warn).not.toMatch(/var\(--c-danger\)/);
  });

  test('el hover de .card y .list-item no asigna box-shadow', () => {
    for (const sel of ['.card:hover', '.list-item:hover']) {
      expect(ruleFor(motionCss, sel), sel).not.toMatch(/box-shadow/);
    }
    expect(ruleFor(motionCss, '.list-item:hover')).toMatch(
      /transform:\s*translateY\(-1px\)/,
    );
    expect(
      mediaEnclosing(motionCss, '.list-item:hover').replace(/\s+/g, ' '),
    ).toBe('@media (hover: hover) and (pointer: fine)');
  });

  test('.flip-tilt no declara will-change ni un 200ms literal', () => {
    const tilt = ruleFor(motionCss, '.flip-tilt');
    expect(tilt).not.toMatch(/will-change/);
    expect(tilt).not.toMatch(/200ms/);
    expect(tilt).toMatch(
      /transition:\s*transform\s+var\(--dur-fast\)\s+var\(--ease\)/,
    );
  });

  test('.burst-overlay queda acotado y no usa inset: 0', () => {
    const burst = ruleFor(motionCss, '.burst-overlay');
    expect(burst).toContain('min(440px, 100vw)');
    expect(burst).toMatch(/height:\s*280px/);
    expect(burst).not.toMatch(/inset:\s*0/);
  });

  test('.route-enter entra con el reloj único desde opacity 0', () => {
    expect(ruleFor(motionCss, '.route-enter')).toMatch(
      /animation:\s*atelierFadeRise\s+var\(--dur-med\)\s+var\(--ease\)\s+both/,
    );
    const from =
      /from\s*\{([^}]*)\}/.exec(
        blockFor(motionCss, '@keyframes atelierFadeRise'),
      )?.[1] ?? '';
    expect(from).toMatch(/opacity:\s*0\s*;/);
    expect(from).not.toMatch(/0\.01/);
  });

  test('no queda .content.content-wide en motion.css', () => {
    expect(motionCss).not.toContain('content-wide');
  });

  test('.hoy-compass-slot mide 96px y la ceja y .week-counts usan --sp-2', () => {
    const slot = ruleFor(motionCss, '.hoy-compass-slot');
    expect(slot).toMatch(/width:\s*96px/);
    expect(slot).toMatch(/height:\s*96px/);
    expect(slot).not.toMatch(/88px/);
    expect(ruleFor(motionCss, '.auth-cover-eyebrow')).toMatch(
      /gap:\s*var\(--sp-2\)/,
    );
    expect(ruleFor(motionCss, '.auth-cover-eyebrow')).not.toMatch(/gap:\s*6px/);
    expect(ruleFor(motionCss, '.week-counts')).toMatch(/gap:\s*var\(--sp-2\)/);
    expect(ruleFor(motionCss, '.week-counts')).not.toMatch(/gap:\s*6px/);
  });

  test('.auth-cover h1 usa font-weight 700', () => {
    expect(ruleFor(motionCss, '.auth-cover h1')).toMatch(/font-weight:\s*700/);
  });
});
