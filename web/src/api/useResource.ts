import { useEffect, useRef, useState } from 'react';
import { OfflineError, toUiError, type UiError } from './client';

// Estado de un recurso de la API. `StateView` (UI-03) lo consume.
export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T; stale: boolean }
  | { status: 'error'; error: UiError };

function isAbort(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError';
}

/**
 * Carga un recurso al cambiar `key`. Aborta la carga anterior al cambiar de
 * clave o desmontar. Sin conexión con datos previos del mismo `key`, conserva
 * esos datos marcados como `stale`. No guarda caché propia: la caché sin
 * conexión es la del service worker (CHG-15).
 */
export function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): ResourceState<T> & { reload: () => void } {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const lastRef = useRef<{ key: string; data: T } | null>(null);

  useEffect(() => {
    if (key === null) return;
    const ctrl = new AbortController();
    const previous =
      lastRef.current?.key === key ? lastRef.current.data : undefined;
    if (previous === undefined) setState({ status: 'loading' });

    loadRef.current(ctrl.signal).then(
      (data) => {
        if (ctrl.signal.aborted) return;
        lastRef.current = { key, data };
        setState({ status: 'ready', data, stale: false });
      },
      (e: unknown) => {
        if (ctrl.signal.aborted || isAbort(e)) return;
        if (e instanceof OfflineError && previous !== undefined) {
          setState({ status: 'ready', data: previous, stale: true });
          return;
        }
        setState({ status: 'error', error: toUiError(e) });
      },
    );
    return () => ctrl.abort();
  }, [key, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
