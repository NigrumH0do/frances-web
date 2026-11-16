import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { PlanEntry } from '../../contracts/generated';
import { PlanList } from './PlanList';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../design/components.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

function ruleFor(selector: string): string {
  let body = '';
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] as string).split(',').map((s) => s.trim());
    if (selectors.includes(selector)) body += match[2] as string;
  }
  return body;
}

const ENTRY: PlanEntry = {
  position: 1,
  kind: 'review',
  ref_id: 'deck_1',
  title_es: 'Repasar 18 tarjetas',
  reason_es: '12 vencidas · 6 nuevas',
  why_llm_es: null,
  done: false,
};

const ENTRIES: PlanEntry[] = [
  ENTRY,
  {
    ...ENTRY,
    position: 2,
    kind: 'quiz',
    ref_id: 'qz_1',
    title_es: 'Quiz: Le passé composé',
  },
  {
    ...ENTRY,
    position: 3,
    kind: 'read',
    ref_id: 'it_1',
    title_es: 'Leer la ficha «Leçon 7»',
  },
  {
    ...ENTRY,
    position: 4,
    kind: 'drill',
    ref_id: null,
    title_es: 'Practicar pronunciación',
  },
];

function renderPlan(entries: PlanEntry[], onToggle = vi.fn()) {
  render(
    <MemoryRouter>
      <PlanList day="2026-11-02" entries={entries} onToggle={onToggle} />
    </MemoryRouter>,
  );
  return onToggle;
}

afterEach(() => {
  vi.restoreAllMocks();
});

test('la casilla Hecho y el enlace son objetivos separados de 44 px', async () => {
  const onToggle = renderPlan([ENTRY]);

  const checkbox = screen.getByRole('checkbox', { name: 'Hecho' });
  const checkboxTarget = checkbox.closest('label');
  expect(checkboxTarget).not.toBeNull();
  expect(checkboxTarget).toHaveClass('btn', 'btn-icon');
  expect(ruleFor('.btn-icon')).toMatch(/min-height:\s*var\(--tap\)/);
  expect(ruleFor('.btn-icon')).toMatch(/width:\s*var\(--tap\)/);

  const link = screen.getByRole('link', { name: /Repasar 18 tarjetas/ });
  expect(link).toHaveClass('list-item');
  expect(ruleFor('.list-item')).toMatch(/min-height:\s*var\(--tap-lg\)/);
  expect(link).not.toContainElement(checkbox);
  expect(checkboxTarget).not.toContainElement(link);

  await userEvent.click(link);
  expect(onToggle).not.toHaveBeenCalled();
});

test('marcar hecho llama a onToggle con su entrada', async () => {
  const onToggle = renderPlan([ENTRY]);

  await userEvent.click(screen.getByRole('checkbox', { name: 'Hecho' }));

  expect(onToggle).toHaveBeenCalledWith(ENTRY);
});

test('el estado hecho se anuncia con texto y con el checkbox marcado', () => {
  renderPlan([{ ...ENTRY, done: true }]);

  expect(screen.getByRole('checkbox', { name: 'Hecho' })).toBeChecked();
  expect(screen.getByText('Hecho')).toBeVisible();
});

test('muestra el progreso en texto y en la barra', () => {
  renderPlan([{ ...ENTRIES[0], done: true }, ...ENTRIES.slice(1)]);

  expect(screen.getByText('1 de 4 hecho')).toBeVisible();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '4');
});

test('arma el enlace de cada tipo de entrada', () => {
  renderPlan(ENTRIES);

  expect(
    screen.getByRole('link', { name: /Repasar 18 tarjetas/ }),
  ).toHaveAttribute('href', '/repasar');
  expect(
    screen.getByRole('link', { name: /Quiz: Le passé composé/ }),
  ).toHaveAttribute('href', '/quiz/qz_1');
  expect(
    screen.getByRole('link', { name: /Leer la ficha «Leçon 7»/ }),
  ).toHaveAttribute('href', '/publicaciones/it_1');
  expect(
    screen.getByRole('link', { name: /Practicar pronunciación/ }),
  ).toHaveAttribute('href', '/repasar/pronunciacion');
});

test('plan vacío muestra su texto', () => {
  renderPlan([]);

  expect(screen.getByText('No hay tareas para hoy.')).toBeVisible();
  expect(screen.getByText('0 de 0 hecho')).toBeVisible();
});
