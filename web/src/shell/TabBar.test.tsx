import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import { TabBar } from './TabBar';

test('las 5 pestañas, aria-current y texto visible', () => {
  render(
    <MemoryRouter>
      <TabBar active="repasar" badges={{ repasar: 7 }} />
    </MemoryRouter>,
  );

  const nav = screen.getByRole('navigation', { name: 'Secciones' });
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['Hoy', 'Temas', 'Repasar7', 'Chat', 'Más']);
  expect(within(nav).getByRole('link', { name: /Repasar/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(within(nav).getByLabelText('7 por repasar')).toBeVisible();
});

test('solo la pestaña activa lleva aria-current', () => {
  render(
    <MemoryRouter>
      <TabBar active="temas" />
    </MemoryRouter>,
  );

  const nav = screen.getByRole('navigation', { name: 'Secciones' });
  const current = within(nav)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page');
  expect(current).toHaveLength(1);
  expect(current[0]).toHaveTextContent('Temas');
});

test('sin insignia, Repasar no muestra número', () => {
  render(
    <MemoryRouter>
      <TabBar active="hoy" />
    </MemoryRouter>,
  );

  const nav = screen.getByRole('navigation', { name: 'Secciones' });
  expect(within(nav).getByRole('link', { name: 'Repasar' })).toHaveTextContent(
    /^Repasar$/,
  );
  expect(within(nav).queryByLabelText(/por repasar/)).toBeNull();
});
