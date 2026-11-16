import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StateView } from './StateView';

describe('StateView', () => {
  test('StateView muestra carga, vacío, error y datos guardados', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <StateView
        state={{ status: 'loading' }}
        emptyText="Nada"
        onRetry={onRetry}
      >
        {(d: string[]) => d.join()}
      </StateView>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Cargando');
    rerender(
      <StateView
        state={{ status: 'ready', data: [], stale: false }}
        empty={(d) => d.length === 0}
        emptyText="Nada"
        onRetry={onRetry}
      >
        {(d) => d.join()}
      </StateView>,
    );
    expect(screen.getByText('Nada')).toBeVisible();
    rerender(
      <StateView
        state={{
          status: 'error',
          error: { kind: 'http', status: 503, code: 'busy', message: '' },
        }}
        emptyText="Nada"
        onRetry={onRetry}
      >
        {(d: string[]) => d.join()}
      </StateView>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(
      <StateView
        state={{ status: 'ready', data: ['a'], stale: true }}
        emptyText="Nada"
        onRetry={onRetry}
      >
        {(d) => d.join()}
      </StateView>,
    );
    expect(screen.getByText(/Sin conexión: datos guardados/)).toBeVisible();
  });
});
