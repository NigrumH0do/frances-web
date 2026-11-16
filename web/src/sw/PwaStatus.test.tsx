import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { UpdatePrompt } from './PwaStatus';

const updateServiceWorker = vi.fn();

beforeEach(() => {
  updateServiceWorker.mockClear();
});

test('UpdatePrompt sin needRefresh no muestra nada', () => {
  const { container } = render(
    <UpdatePrompt
      needRefresh={false}
      updateServiceWorker={updateServiceWorker}
    />,
  );
  expect(container.innerHTML).toBe('');
  expect(
    screen.queryByText('Sin conexión: mostrando lo último descargado'),
  ).toBeNull();
});

test('UpdatePrompt muestra el aviso con needRefresh y llama a updateServiceWorker', async () => {
  render(
    <UpdatePrompt
      needRefresh={true}
      updateServiceWorker={updateServiceWorker}
    />,
  );
  expect(screen.getByText('Hay una versión nueva')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  expect(updateServiceWorker).toHaveBeenCalledTimes(1);
  expect(updateServiceWorker).toHaveBeenCalledWith(true);
});
