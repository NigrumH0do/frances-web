import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { PronScores } from '../../contracts/generated';
import { ScoreSummary } from './ScoreSummary';

const RADIUS = 30;

const BANDS = [
  { pron: 92, token: '--c-score-excelente', label: 'Excelente' },
  { pron: 80, token: '--c-score-bien', label: 'Bien' },
  { pron: 65, token: '--c-score-mejorable', label: 'Mejorable' },
  { pron: 40, token: '--c-score-repetir', label: 'A repetir' },
] as const;

function scores(pron: number): PronScores {
  return {
    pron,
    accuracy: pron,
    fluency: pron,
    completeness: pron,
  };
}

test('puntajes 92, 80, 65 y 40 usan las cuatro bandas, arco continuo e icono', () => {
  for (const band of BANDS) {
    const view = render(<ScoreSummary scores={scores(band.pron)} />);
    const region = screen.getByRole('region', { name: 'Puntaje global' });
    expect(region.className).not.toMatch(/pron-band-/);
    const total = region.querySelector('.pron-score-total');
    expect(total).not.toBeNull();
    expect(total?.className ?? '').not.toMatch(/pron-band-/);
    expect(region).toHaveTextContent(band.label);
    const arc = region.querySelector('.score-ring-fg');
    expect(arc).toHaveAttribute('stroke', `var(${band.token})`);
    const dash = arc?.getAttribute('stroke-dasharray') ?? '';
    expect(dash).not.toMatch(/2\s+6/);
    expect(dash).not.toMatch(/8\s+6/);
    expect(dash).not.toMatch(/2\s+4/);
    expect(
      dash
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean),
    ).toHaveLength(1);
    expect(Number(dash)).toBeCloseTo(2 * Math.PI * RADIUS, 4);
    expect(arc?.getAttribute('stroke-dashoffset')).not.toBeNull();
    expect(region.querySelector('svg.score-band-icon')).not.toBeNull();
    expect(
      region.querySelector('svg.score-band-icon')?.getAttribute('aria-hidden'),
    ).toBe('true');
    view.unmount();
  }
});
