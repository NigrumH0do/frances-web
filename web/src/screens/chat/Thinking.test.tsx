import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { Thinking } from './Thinking';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('muestra cronómetro, pasos con su estado en texto y cancelar', async () => {
  const onCancel = vi.fn();
  render(
    <Thinking phase="writing" elapsedS={12} slow={false} onCancel={onCancel} />,
  );

  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Pensando… 12 s');
  expect(status).toHaveTextContent('Buscando en el material');
  expect(status).toHaveTextContent('hecho');
  expect(status).toHaveTextContent('Redactando la respuesta');
  expect(status).toHaveTextContent('en curso');
  expect(status).toHaveTextContent('Comprobando las citas');
  expect(status).toHaveTextContent('pendiente');
  expect(status).toHaveTextContent('Puede tardar hasta 30 s');
  expect(status.querySelector('[aria-live="polite"]')).toHaveTextContent(
    'Redactando la respuesta',
  );

  await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('a partir de 30 s avisa que está tardando más de lo normal', () => {
  render(
    <Thinking
      phase="searching"
      elapsedS={31}
      slow
      onCancel={() => undefined}
    />,
  );

  expect(screen.getByRole('status')).toHaveTextContent('31 s');
  expect(screen.getByText('Está tardando más de lo normal')).toBeVisible();
  expect(
    screen.getByRole('status').querySelector('[aria-live="polite"]'),
  ).toHaveTextContent('Buscando en el material');
});

test('con movimiento reducido no pinta los puntos animados', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  const { container } = render(
    <Thinking
      phase="sending"
      elapsedS={0}
      slow={false}
      onCancel={() => undefined}
    />,
  );

  expect(container.querySelector('.dots')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Pensando… 0 s');
});

test('con motion-off no pinta los puntos animados', () => {
  document.documentElement.classList.add('motion-off');
  const { container } = render(
    <Thinking
      phase="citing"
      elapsedS={4}
      slow={false}
      onCancel={() => undefined}
    />,
  );

  expect(container.querySelector('.dots')).toBeNull();
  expect(
    screen.getByRole('status').querySelector('[aria-live="polite"]'),
  ).toHaveTextContent('Comprobando las citas');
  document.documentElement.classList.remove('motion-off');
});
