import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useApi } from '../api/ApiContext';
import {
  enqueue as enqueueOp,
  flush,
  pendingCount,
  type FlushResult,
  type OutboxOp,
} from './outbox';
import { useOnline } from './useOnline';

// Contexto de la cola sin conexión. `userId` es el de la sesión: la cola
// nunca mezcla operaciones de dos usuarios (P09-4/P09-9).

export interface OfflineValue {
  online: boolean;
  pending: number;
  lastFlush: FlushResult | null;
  enqueue: (op: OutboxOp) => Promise<void>;
  flushNow: () => Promise<void>;
}

const OfflineCtx = createContext<OfflineValue | null>(null);

export function OfflineProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const api = useApi();
  const online = useOnline();
  const [pending, setPending] = useState(0);
  const [lastFlush, setLastFlush] = useState<FlushResult | null>(null);

  const alive = useRef(true);
  const currentUserId = useRef(userId);
  currentUserId.current = userId;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void pendingCount(userId).then((count) => {
      if (!cancelled && alive.current) setPending(count);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const flushNow = useCallback(async () => {
    const result = await flush(api, userId);
    if (!alive.current || currentUserId.current !== userId) return;
    setLastFlush(result);

    const count = await pendingCount(userId);
    if (!alive.current || currentUserId.current !== userId) return;
    setPending(count);
  }, [api, userId]);

  const enqueue = useCallback(
    async (op: OutboxOp) => {
      await enqueueOp(userId, op);
      if (!alive.current || currentUserId.current !== userId) return;

      setPending(await pendingCount(userId));
      if (online) await flushNow();
    },
    [flushNow, online, userId],
  );

  // Al montar (o cambiar de usuario) y al volver la red.
  useEffect(() => {
    if (!online) return;
    void flushNow().catch(() => undefined);
  }, [flushNow, online]);

  // Al volver la pestaña a primer plano.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && online) {
        void flushNow().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flushNow, online]);

  const value = useMemo<OfflineValue>(
    () => ({ online, pending, lastFlush, enqueue, flushNow }),
    [enqueue, flushNow, lastFlush, online, pending],
  );

  return <OfflineCtx.Provider value={value}>{children}</OfflineCtx.Provider>;
}

export function useOffline(): OfflineValue {
  const value = useContext(OfflineCtx);
  if (value === null) {
    throw new Error('useOffline debe usarse dentro de OfflineProvider');
  }
  return value;
}
