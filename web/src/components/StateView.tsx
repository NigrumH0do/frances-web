import type { ReactNode } from 'react';
import { messageFor } from '../l10n/errors';
import { common } from '../l10n/es';
import { Button } from './Button';
import { Icon } from './Icon';
import type { ResourceState } from './resource';
import { Skeleton } from './Skeleton';

export interface StateViewProps<T> {
  state: ResourceState<T>;
  empty?: (data: T) => boolean;
  emptyText: string;
  emptyAction?: ReactNode;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
  onRetry: () => void;
}

// Muestra carga, vacío, error o datos. Con datos guardados sin conexión avisa, y el error
// siempre ofrece reintentar.
export function StateView<T>({
  state,
  empty,
  emptyText,
  emptyAction,
  skeleton,
  children,
  onRetry,
}: StateViewProps<T>) {
  if (state.status === 'loading') {
    return (
      <div role="status">
        <span className="sr-only">{common.loading}</span>
        {skeleton ?? (
          <div className="stack" aria-hidden="true">
            <Skeleton variant="title" />
            <Skeleton />
            <Skeleton />
            <Skeleton variant="block" />
          </div>
        )}
      </div>
    );
  }

  if (state.status === 'error') {
    const offline = state.error.kind === 'offline';
    return (
      <div className="state error" role="alert">
        <div className="art">
          <Icon name={offline ? 'offline' : 'alert'} />
        </div>
        <p className="small muted">{messageFor(state.error)}</p>
        <Button variant="secondary" onClick={onRetry}>
          {common.retry}
        </Button>
      </div>
    );
  }

  const { data, stale } = state;
  const isEmpty = empty?.(data) ?? false;
  return (
    <>
      {stale ? (
        <div className="callout" role="status">
          <Icon name="offline" size="sm" />
          <p className="small grow">{common.offlineStale}</p>
        </div>
      ) : null}
      {isEmpty ? (
        <div className="state">
          <p>{emptyText}</p>
          {emptyAction}
        </div>
      ) : (
        children(data)
      )}
    </>
  );
}
