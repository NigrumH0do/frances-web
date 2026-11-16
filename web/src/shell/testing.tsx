import 'fake-indexeddb/auto';
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import type { Me, UserOut } from '../contracts/generated';
import { OfflineProvider } from '../offline/OfflineContext';
import { fakeTransport, type FakeTransport } from '../api/testing';

// Ayudas de test para las pantallas v2 (UI-12…UI-19): montan la pantalla con
// una sesión ya autenticada, el transporte falso y la cola sin conexión.
// El test que las usa debe reiniciar IndexedDB (`closeV2DbForTests`).

export type FakeRoute = unknown;

export const ME_USER: UserOut = {
  id: 'u1',
  email: 'ana@example.test',
  display_name: 'Ana',
  role: 'user',
  created_at: '2026-11-01T00:00:00.000Z',
  last_login_at: null,
  disabled: false,
};

export const ME_ADMIN: UserOut = {
  ...ME_USER,
  id: 'u_admin',
  email: 'admin@example.test',
  display_name: 'Admin',
  role: 'admin',
};

function installFakeCaches(): void {
  if (typeof globalThis.caches !== 'undefined') return;

  const cache = {
    match: vi.fn(() => Promise.resolve(undefined)),
    put: vi.fn(() => Promise.resolve()),
    add: vi.fn(() => Promise.resolve()),
    addAll: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve(true)),
    keys: vi.fn(() => Promise.resolve([])),
  } as unknown as Cache;

  const storage = {
    delete: vi.fn(() => Promise.resolve(true)),
    has: vi.fn(() => Promise.resolve(false)),
    keys: vi.fn(() => Promise.resolve([])),
    match: vi.fn(() => Promise.resolve(undefined)),
    open: vi.fn(() => Promise.resolve(cache)),
  } as unknown as CacheStorage;

  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: storage,
  });
}

export function renderScreen(
  ui: ReactElement,
  opts: {
    routes?: Record<string, FakeRoute>;
    path?: string;
    pattern?: string;
    user?: Partial<UserOut>;
    online?: boolean;
  } = {},
): { transport: FakeTransport; user: UserOut } {
  installFakeCaches();
  if (opts.online === false) {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  }

  const user: UserOut = { ...ME_USER, ...(opts.user ?? {}) };
  const me: Me = { csrf_token: 'csrf-test', user };
  const transport = fakeTransport({
    'GET /api/auth/me': me,
    ...(opts.routes ?? {}),
  });

  const path = opts.path ?? '/';
  const tree =
    opts.pattern === undefined ? (
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    ) : (
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={opts.pattern} element={ui} />
        </Routes>
      </MemoryRouter>
    );

  render(
    <AuthProvider transport={transport}>
      <OfflineProvider userId={user.id}>{tree}</OfflineProvider>
    </AuthProvider>,
  );

  return { transport, user };
}
