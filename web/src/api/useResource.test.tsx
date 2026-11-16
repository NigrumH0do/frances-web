import { act, renderHook, waitFor } from '@testing-library/react';
import { OfflineError, HttpError } from './client';
import { useResource } from './useResource';

test('useResource: carga, datos, datos guardados sin conexión y abort al cambiar de clave', async () => {
  const signals: AbortSignal[] = [];
  let mode: 'ok' | 'offline' = 'ok';
  const load = vi.fn(async (signal: AbortSignal) => {
    signals.push(signal);
    if (mode === 'offline') throw new OfflineError();
    return { n: signals.length };
  });

  const { result, rerender } = renderHook(
    ({ key }: { key: string | null }) => useResource(key, load),
    { initialProps: { key: 'a' as string | null } },
  );

  expect(result.current.status).toBe('loading');
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current).toMatchObject({
    status: 'ready',
    stale: false,
    data: { n: 1 },
  });

  // Sin conexión con datos previos del mismo recurso: sigue mostrando los datos, marcados como guardados.
  mode = 'offline';
  await act(async () => {
    result.current.reload();
  });
  await waitFor(() =>
    expect(result.current).toMatchObject({ status: 'ready', stale: true }),
  );
  expect(result.current).toMatchObject({ data: { n: 1 } });

  // Cambiar de clave aborta la carga anterior y no reutiliza datos de otra clave.
  mode = 'ok';
  rerender({ key: 'b' });
  await waitFor(() =>
    expect(result.current).toMatchObject({ status: 'ready', stale: false }),
  );
  expect(signals[0]!.aborted).toBe(true);
  expect(result.current).toMatchObject({ data: { n: 3 } });
});

test('useResource sin datos previos y sin conexión da error offline', async () => {
  const { result } = renderHook(() =>
    useResource('x', async () => {
      throw new OfflineError();
    }),
  );
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current).toMatchObject({
    status: 'error',
    error: { kind: 'offline' },
  });
});

test('useResource con HttpError da error http tipado', async () => {
  const { result } = renderHook(() =>
    useResource('x', async () => {
      throw new HttpError(404, 'not_found', 'No existe');
    }),
  );
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current).toMatchObject({
    status: 'error',
    error: {
      kind: 'http',
      status: 404,
      code: 'not_found',
      message: 'No existe',
    },
  });
});

test('key null no carga', () => {
  const load = vi.fn(async () => 1);
  renderHook(() => useResource(null, load));
  expect(load).not.toHaveBeenCalled();
});
