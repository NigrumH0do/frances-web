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
import { ApiProvider } from '../api/ApiContext';
import {
  createApiClient,
  HttpError,
  OfflineError,
  type ApiClient,
} from '../api/client';
import { endpoints } from '../api/endpoints';
import { defaultTransport, type Transport } from '../api/transport';
import type { AcceptInviteRequest, Me, UserOut } from '../contracts/generated';
import { flush, pendingCount } from '../offline/outbox';
import { lastMe, purgeUserData, rememberUser } from '../offline/purge';

// Sesión de la web v2. El CSRF vive en memoria del cliente (nunca en
// `localStorage`); el último `UserOut` lo guarda UI-07 solo para el arranque
// sin conexión. Las contraseñas nunca pasan por este módulo.

export type AuthStatus = 'checking' | 'authenticated' | 'offline' | 'anonymous';

export interface LogoutResult {
  blocked: number;
}

export interface AuthValue {
  status: AuthStatus;
  user: UserOut | null;
  login(email: string, password: string): Promise<void>;
  acceptInvite(body: AcceptInviteRequest): Promise<void>;
  logout(opts?: { discardPending?: boolean }): Promise<LogoutResult>;
  refresh(): Promise<void>;
}

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({
  children,
  transport,
}: {
  children: ReactNode;
  transport?: Transport;
}) {
  const [resolvedTransport, setResolvedTransport] = useState<Transport | null>(
    () => transport ?? null,
  );
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<UserOut | null>(null);
  const generation = useRef(0);
  const checkingMe = useRef(0);
  const clientRef = useRef<ApiClient | null>(null);

  useEffect(() => {
    if (transport) {
      setResolvedTransport(() => transport);
      return;
    }
    let cancelled = false;
    void defaultTransport().then((next) => {
      if (!cancelled) setResolvedTransport(() => next);
    });
    return () => {
      cancelled = true;
    };
  }, [transport]);

  const client = useMemo(() => {
    if (resolvedTransport === null) return null;
    const created = createApiClient({
      transport: resolvedTransport,
      onUnauthenticated: () => {
        // Un 401 en cualquier llamada deja la sesión anónima (P09-2), salvo
        // que venga del `me` de arranque: ese ya lo maneja `loadMe` y puede
        // llegar tarde, después de un login correcto.
        if (checkingMe.current > 0) return;
        generation.current += 1;
        clientRef.current?.setCsrfToken(null);
        setUser(null);
        setStatus('anonymous');
      },
      refreshCsrf: async () => {
        const current = clientRef.current;
        if (current === null) return null;
        try {
          const me = await current.get<Me>('/api/auth/me');
          current.setCsrfToken(me.csrf_token);
          return me.csrf_token;
        } catch {
          return null;
        }
      },
    });
    clientRef.current = created;
    return created;
  }, [resolvedTransport]);

  const loadMe = useCallback(async () => {
    if (client === null) return;
    const request = generation.current + 1;
    generation.current = request;
    checkingMe.current += 1;
    try {
      const me = await client.get<Me>('/api/auth/me');
      if (request !== generation.current) return;
      client.setCsrfToken(me.csrf_token);
      await rememberUser(me).catch(() => undefined);
      if (request !== generation.current) return;
      setUser(me.user);
      setStatus('authenticated');
    } catch (error) {
      if (request !== generation.current) return;
      if (error instanceof OfflineError) {
        const remembered = lastMe();
        if (remembered !== null) {
          setUser(remembered);
          setStatus('offline');
          return;
        }
      }
      setUser(null);
      setStatus('anonymous');
    } finally {
      checkingMe.current -= 1;
    }
  }, [client]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const onOnline = () => {
      if (statusRef.current === 'offline') void loadMe();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [loadMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      if (client === null) throw new OfflineError();
      const me = await endpoints(client).login({ email, password });
      generation.current += 1;
      client.setCsrfToken(me.csrf_token);
      await rememberUser(me).catch(() => undefined);
      setUser(me.user);
      setStatus('authenticated');
    },
    [client],
  );

  const acceptInvite = useCallback(
    async (body: AcceptInviteRequest) => {
      if (client === null) throw new OfflineError();
      const me = await endpoints(client).inviteAccept(body);
      generation.current += 1;
      client.setCsrfToken(me.csrf_token);
      await rememberUser(me).catch(() => undefined);
      setUser(me.user);
      setStatus('authenticated');
    },
    [client],
  );

  const logout = useCallback(
    async (opts: { discardPending?: boolean } = {}) => {
      const closeLocally = async (): Promise<LogoutResult> => {
        await purgeUserData().catch(() => undefined);
        client?.setCsrfToken(null);
        generation.current += 1;
        setUser(null);
        setStatus('anonymous');
        return { blocked: 0 };
      };

      // Sin usuario (p. ej. un 401 anterior) o sin cliente, no hay sesión que
      // revocar, pero sí datos locales que borrar.
      if (client === null || user === null) {
        return closeLocally();
      }

      const api = endpoints(client);

      if (!opts.discardPending) {
        let pending = 0;
        try {
          pending = await pendingCount(user.id);
        } catch {
          pending = 0;
        }
        if (pending > 0) {
          const result = await flush(api, user.id).catch(() => null);
          // Un 401 en la cola ya invalidó la sesión: no tiene sentido ofrecer
          // «Cerrar sesión igual» con `user === null`; se cierra y se purga.
          if (result?.stoppedBy === 'unauthenticated') {
            return closeLocally();
          }
          let remaining = 0;
          try {
            remaining = await pendingCount(user.id);
          } catch {
            remaining = 0;
          }
          if (remaining > 0) return { blocked: remaining };
        }
      }

      try {
        await api.logout();
      } catch (error) {
        if (
          !(error instanceof OfflineError) &&
          !(error instanceof HttpError && error.status === 401)
        ) {
          throw error;
        }
      }

      return closeLocally();
    },
    [client, user],
  );

  const refresh = useCallback(async () => {
    await loadMe();
  }, [loadMe]);

  const value = useMemo<AuthValue>(
    () => ({ status, user, login, acceptInvite, logout, refresh }),
    [acceptInvite, login, logout, refresh, status, user],
  );

  return (
    <AuthCtx.Provider value={value}>
      {client === null ? null : (
        <ApiProvider client={client}>{children}</ApiProvider>
      )}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthCtx);
  if (value === null) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return value;
}
