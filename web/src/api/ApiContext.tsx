import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ApiClient } from './client';
import { endpoints } from './endpoints';

type Api = ReturnType<typeof endpoints> & { client: ApiClient };

const ApiCtx = createContext<Api | null>(null);

export function ApiProvider({
  client,
  children,
}: {
  client: ApiClient;
  children: ReactNode;
}) {
  const value = useMemo<Api>(
    () => ({ ...endpoints(client), client }),
    [client],
  );
  return <ApiCtx.Provider value={value}>{children}</ApiCtx.Provider>;
}

export function useApi(): Api {
  const api = useContext(ApiCtx);
  if (!api) throw new Error('useApi debe usarse dentro de ApiProvider');
  return api;
}
