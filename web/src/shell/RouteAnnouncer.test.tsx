import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { RouteAnnouncer } from './RouteAnnouncer';

test('el primer render deja el anuncio vacío', () => {
  const { container } = render(<RouteAnnouncer title="Hoy" />);
  const live = container.querySelector('p');

  expect(live).not.toBeNull();
  expect(live).toHaveAttribute('aria-live', 'polite');
  expect(live).toHaveAttribute('aria-atomic', 'true');
  expect(live).toHaveClass('sr-only');
  expect(live?.textContent).toBe('');
});

test('al cambiar el título anuncia el nuevo', () => {
  const { container, rerender } = render(<RouteAnnouncer title="Hoy" />);
  rerender(<RouteAnnouncer title="Temas" />);

  const live = container.querySelector('p');
  expect(live).toHaveTextContent('Temas');
  expect(live).toHaveAttribute('aria-live', 'polite');
});
