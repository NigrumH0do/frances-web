import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
  useNavigate,
} from 'react-router';
import { expect, test } from 'vitest';
import { RouteFocus } from './RouteFocus';

test('al cambiar de ruta pone el título y mueve el foco al h1', async () => {
  function Next() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => void navigate('/temas')}>
        Ir a temas
      </button>
    );
  }

  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <>
            <RouteFocus title="Hoy" />
            <h1>Hoy</h1>
            <Next />
          </>
        ),
      },
      {
        path: '/temas',
        element: (
          <>
            <RouteFocus title="Temas" />
            <h1>Temas</h1>
          </>
        ),
      },
    ],
    { initialEntries: ['/'] },
  );

  render(<RouterProvider router={router} />);

  const hoy = screen.getByRole('heading', { name: 'Hoy' });
  await waitFor(() => expect(hoy).toHaveFocus());
  expect(document.title).toBe('Hoy · Français');

  await userEvent.click(screen.getByRole('button', { name: 'Ir a temas' }));

  const temas = await screen.findByRole('heading', { name: 'Temas' });
  await waitFor(() => expect(temas).toHaveFocus());
  expect(document.title).toBe('Temas · Français');
});

test('sin h1 mueve el foco al main', async () => {
  render(
    <MemoryRouter>
      <RouteFocus title="Sin título" />
      <main id="main" tabIndex={-1}>
        Solo texto
      </main>
    </MemoryRouter>,
  );

  await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  expect(document.title).toBe('Sin título · Français');
});
