import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { CompassFallback, NotebookFallback, OrbFallback } from './fallbacks';

const here = dirname(fileURLToPath(import.meta.url));

function ruleBody(css: string, selector: string): string {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
  );
  return (pattern.exec(css)?.[1] ?? '').replace(/\s+/g, ' ').trim();
}

function marks(streak: number): HTMLElement[] {
  const { container } = render(<CompassFallback streak={streak} />);
  return [
    ...container.querySelectorAll<HTMLElement>('[data-part="milestone"]'),
  ];
}

describe('CompassFallback', () => {
  test('hitos 0, 2, 3, 7, 14 y 30 y aguja sin animar', () => {
    const hidden = marks(0);
    expect(hidden.map((node) => node.getAttribute('data-day'))).toEqual([
      '3',
      '7',
      '30',
    ]);
    expect(hidden.map((node) => node.getAttribute('stroke-opacity'))).toEqual([
      '0',
      '0',
      '0',
    ]);
    expect(marks(2).map((node) => node.getAttribute('stroke-opacity'))).toEqual(
      ['0', '0', '0'],
    );
    expect(marks(3).map((node) => node.getAttribute('stroke-opacity'))).toEqual(
      ['1', '0', '0'],
    );
    expect(marks(7).map((node) => node.getAttribute('stroke-opacity'))).toEqual(
      ['1', '1', '0'],
    );

    const { container: at14 } = render(<CompassFallback streak={14} />);
    const ring14 = at14.querySelector('[data-part="ring"]');
    expect(ring14).toHaveClass('compass-milestone-14');
    expect(ring14).toHaveAttribute('stroke', 'var(--c-gold-3d, #d3ac41)');
    expect(
      [...at14.querySelectorAll('[data-part="milestone"]')].map((node) =>
        node.getAttribute('stroke-opacity'),
      ),
    ).toEqual(['1', '1', '0']);

    const { container: at30 } = render(<CompassFallback streak={30} />);
    expect(
      [...at30.querySelectorAll('[data-part="milestone"]')].map((node) =>
        node.getAttribute('stroke-opacity'),
      ),
    ).toEqual(['1', '1', '1']);

    const { container } = render(<CompassFallback streak={0} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 96 96');
    expect(svg).toHaveAttribute('width', '100%');
    expect(svg).toHaveAttribute('height', '100%');
    expect(container.querySelector('[data-part="cross"]')).not.toBeNull();
    expect(
      container.querySelector('[data-part="needle-north"]'),
    ).toHaveAttribute('fill', 'var(--c-accent)');
    expect(
      container.querySelector('[data-part="needle-south"]'),
    ).toHaveAttribute('fill', 'var(--c-text)');
    expect(container.querySelector('[data-part="ring"]')).not.toHaveClass(
      'compass-milestone-14',
    );
    expect(container.querySelector('animate')).toBeNull();
    expect(container.querySelector('animateTransform')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('OrbFallback', () => {
  test('bandas 90, 85, 75, 60 y 59.9; active no usa danger', () => {
    const cases = [
      [90, 'excelente'],
      [85, 'bien'],
      [75, 'bien'],
      [60, 'mejorable'],
      [59.9, 'repetir'],
    ] as const;
    const bands = ['excelente', 'bien', 'mejorable', 'repetir'] as const;

    for (const [score, band] of cases) {
      const { container, unmount } = render(<OrbFallback score={score} />);
      const orb = container.querySelector('.orb-fallback');
      expect(orb).not.toBeNull();
      for (const other of bands) {
        if (other === band) expect(orb).toHaveClass(`orb-band-${other}`);
        else expect(orb).not.toHaveClass(`orb-band-${other}`);
      }
      unmount();
    }

    const { container } = render(<OrbFallback active />);
    const orb = container.querySelector('.orb-fallback');
    expect(orb).toHaveClass('orb-fallback');
    expect(orb?.className).not.toMatch(/danger/);
    expect(orb?.className).not.toMatch(/orb-band-/);
    expect(orb?.getAttribute('style') ?? '').not.toContain('--c-danger');
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('NotebookFallback', () => {
  test('lomo, dos tapas y cinta, estáticos', () => {
    const { container } = render(<NotebookFallback />);
    const root = container.querySelector('.notebook-fallback');
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('aria-hidden', 'true');
    for (const part of ['spine', 'cover-left', 'cover-right', 'ribbon']) {
      expect(root?.querySelector(`[data-part="${part}"]`)).not.toBeNull();
    }
    expect(container.querySelector('animate')).toBeNull();
  });

  test('la hoja no importa three, no anima y no pinta el metal como texto', () => {
    const tsx = readFileSync(join(here, 'fallbacks.tsx'), 'utf8');
    const css = readFileSync(join(here, 'fallbacks.css'), 'utf8');
    expect(tsx).not.toMatch(/from\s+['"]three['"]/);
    expect(tsx).not.toContain('<animate');
    expect(css).not.toMatch(/(^|[^-])color:\s*var\(\s*--c-gold-3d/);
    expect(css).not.toContain('.hoy-compass-slot');
    expect(css).not.toContain('.orb-wrap');
    expect(css).not.toMatch(/\banimation\s*:/);
    expect(css).not.toMatch(/@keyframes/);
    expect(css).not.toMatch(/\btransition\s*:/);
    expect(css).toContain('color-mix(in srgb, var(--c-text) 8%, transparent)');
    expect(css).toContain('.scene-fallback-overlay');
    expect(css).toContain('.scene-contact');

    const ribbon = ruleBody(css, "[data-part='ribbon']");
    expect(ribbon).toContain('linear-gradient(');
    expect(ribbon).toContain('var(--c-accent)');

    const tip = ruleBody(css, "[data-part='ribbon-tip']").replace(/\s+/g, '');
    expect(tip).toContain('width:8px');
    expect(tip).toContain('height:8px');
    expect(tip).toContain('background:var(--c-gold-3d,#d3ac41)');

    const notebook = ruleBody(css, '.notebook-fallback');
    expect(notebook).toContain('height: 100%');

    const orb = ruleBody(css, '.orb-fallback');
    expect(orb).toContain('width: 96px');
    expect(orb).toContain('height: 96px');
    expect(orb).toContain('background: var(--c-accent)');
    for (const band of ['excelente', 'bien', 'mejorable', 'repetir']) {
      expect(css).toContain(`var(--c-score-${band})`);
      expect(css).toContain(`orb-band-${band}`);
    }
  });
});
