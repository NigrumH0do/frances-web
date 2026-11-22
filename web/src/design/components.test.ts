// Lee components.css como texto: objetivos de 44 px, riel a 960 px y
// movimiento reducido (incluye la paridad de html.motion-off).
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

function normalized(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

function transitionDeclarations(text: string): string[] {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/transition\s*:\s*([^;]*);/g)].map((m) =>
    normalized(m[1] as string),
  );
}

function transitionProperties(value: string): string[] {
  return value.split(',').map((part) => part.trim().split(/\s+/)[0] ?? '');
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

  test('el riel lateral arranca en 960 px a 232 px de ancho', () => {
    expect(css).toContain('@media (min-width: 960px)');
    const wide = mediaBlock(css, 'min-width: 960px');
    expect(wide).toMatch(/\.tabbar\s*\{[^}]*position:\s*sticky/);
    expect(wide).toMatch(/\.tabbar\s*\{[^}]*width:\s*var\(--rail-w\)/);
    expect(wide).toMatch(/\.tabbar\s*\{[^}]*height:\s*100dvh/);
    expect(wide).toMatch(/\.tabbar-brand\s*\{[^}]*display:\s*block/);
    expect(wide).toMatch(/\.tabbar a\s*\{[^}]*flex-direction:\s*row/);
    expect(wide).toMatch(
      /\.tabbar a\[aria-current='page'\]\s*\{[^}]*background:\s*var\(--c-accent-soft\)/,
    );
    expect(wide).toMatch(/\.tab-count\s*\{[^}]*position:\s*static/);
    expect(wide).toMatch(/\.content\s*\{[^}]*max-width:\s*720px/);
    expect(wide).toMatch(/\.content\s*\{[^}]*padding-bottom:\s*var\(--sp-10\)/);
    expect(wide).toMatch(
      /\.content\.content-repasar\s*\{[^}]*max-width:\s*840px/,
    );
    expect(wide).toMatch(
      /\.content\.content-split\s*\{[^}]*max-width:\s*1120px/,
    );
    expect(css).not.toContain('width: 88px');
    expect(css).not.toContain('max-width: 760px');
    expect(css).not.toContain('max-width: 1080px');
    expect(css).not.toContain('content-wide');
    expect(css).not.toContain('min-width: 900px');
    expect(css).not.toContain('min-width: 1200px');
  });

  test('bajo 960 px la barra es fija y el contenido reserva su altura', () => {
    const tabbar = ruleFor(css, '.tabbar');
    expect(tabbar).toMatch(/position:\s*fixed/);
    expect(tabbar).toMatch(/bottom:\s*0/);
    expect(tabbar).toMatch(/left:\s*0/);
    expect(tabbar).toMatch(/right:\s*0/);
    expect(tabbar).toMatch(/width:\s*100%/);
    expect(tabbar).toMatch(/z-index:\s*30/);
    expect(tabbar).toMatch(
      /height:\s*calc\(var\(--tabbar-h\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\s*\+\s*8px\)/,
    );
    expect(ruleFor(css, '.content')).toMatch(
      /padding-bottom:\s*calc\(\s*var\(--tabbar-h\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\s*\+\s*8px\s*\)/,
    );
  });

  test('el IPA va en monoespaciado recto y el francés del frente en 700', () => {
    for (const sel of ['.flip-face .ipa', '.flip-recap-ipa']) {
      const body = ruleFor(css, sel);
      expect(body, sel).toMatch(/font-family:\s*var\(--font-mono\)/);
      expect(body, sel).toMatch(/font-style:\s*normal/);
      expect(body, sel).not.toMatch(/italic/);
    }
    expect(ruleFor(css, '.flip-face .front-fr')).toMatch(/font-weight:\s*700/);
  });

  test('FSRS pasa a rejilla 2×2 bajo 380 px', () => {
    const narrow = mediaBlock(css, 'max-width: 379px');
    expect(narrow).toMatch(
      /\.rating\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*1fr\)/,
    );
  });

  test('las transiciones no animan background, border-color, box-shadow ni width', () => {
    const properties =
      transitionDeclarations(css).flatMap(transitionProperties);
    expect(properties).toContain('transform');
    for (const property of properties) {
      expect(property, property).not.toMatch(
        /^(?:background|background-color|background-position|border-color|box-shadow|width)$/,
      );
    }
    expect(ruleFor(css, '.btn')).toMatch(
      /transition:\s*transform\s+var\(--dur-fast\)\s+var\(--ease\)/,
    );
    expect(ruleFor(css, '.tabbar a .pill')).not.toMatch(/transition\s*:/);
    expect(ruleFor(css, '.progress > span')).not.toMatch(/transition\s*:/);
  });

  test('html.motion-off espeja prefers-reduced-motion', () => {
    const reduced = mediaBlock(css, 'prefers-reduced-motion: reduce');
    const rules = [...reduced.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      sel: (m[1] as string).trim(),
      body: normalized(m[2] as string),
    }));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const sel of rule.sel.split(',').map((s) => s.trim())) {
        const mirrored = `html.motion-off ${sel}`;
        expect(normalized(ruleFor(css, mirrored)), mirrored).toBe(rule.body);
      }
    }
  });

  test('las barras usan el hueco de la rejilla de 8', () => {
    for (const sel of ['.bars', '.bars-labels']) {
      const body = ruleFor(css, sel);
      expect(body, sel).toMatch(/gap:\s*var\(--sp-2\)/);
      expect(body, sel).not.toMatch(/gap:\s*6px/);
    }
  });

  test('.sr-only no reserva caja', () => {
    const sr = ruleFor(css, '.sr-only');
    expect(sr).toMatch(/padding:\s*0/);
    expect(sr).toMatch(/margin:\s*-1px/);
    expect(sr).toMatch(/border:\s*0/);
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

describe('components.css: sin reglas v1 que colisionen con la v3', () => {
  test('no queda el .score-ring de conic-gradient (solo el SVG de motion.css)', () => {
    expect(ruleFor(css, '.score-ring')).toBe('');
    expect(css).not.toContain('.score-ring > span');
    expect(css).not.toContain('conic-gradient');
  });
});

describe('components.css: esqueletos sin animar background-position', () => {
  test('el brillo del esqueleto se anima con opacity', () => {
    expect(css).not.toContain('@keyframes shimmer');
    expect(css).toMatch(/@keyframes skeletonPulse\s*\{[\s\S]*?opacity/);
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

describe('legacy.css: cifra de pronunciación y transiciones', () => {
  test('el total usa color de texto y peso 700, sin el color de la banda', () => {
    const total = ruleFor(legacyCss, '.pron-score-total');
    expect(total).toMatch(/color:\s*var\(--c-text\)/);
    expect(total).toMatch(/font-weight:\s*700/);
  });

  test('no transiciona box-shadow, width ni background-position', () => {
    const properties =
      transitionDeclarations(legacyCss).flatMap(transitionProperties);
    for (const property of properties) {
      expect(property, property).not.toMatch(
        /^(?:box-shadow|width|background-position)$/,
      );
    }
  });
});
