import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { UserOut, UserStats } from '../contracts/generated';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { fakeTransport, jsonResponse } from '../api/testing';
import { closeV2DbForTests } from '../offline/db';
import { enqueue } from '../offline/outbox';
import { OfflineProvider } from '../offline/OfflineContext';
import {
  buildRoutes,
  SCREENS,
  SCREEN_MODULES,
  type ScreenModuleLoader,
  type ScreenModules,
} from './routes';
import routesSource from './routes.tsx?raw';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));

const ME_USER: UserOut = {
  id: 'u1',
  email: 'ana@example.test',
  display_name: 'Ana',
  role: 'user',
  created_at: '2026-11-01T00:00:00.000Z',
  last_login_at: null,
  disabled: false,
};

const ME_ADMIN: UserOut = {
  ...ME_USER,
  id: 'u_admin',
  email: 'admin@example.test',
  display_name: 'Admin',
  role: 'admin',
};

const STATS: UserStats = {
  cards_learned: 0,
  due_now: 7,
  reviews_today: 0,
  retention_30d: null,
  streak_days: 0,
  week: [
    { day: '2026-11-02', reviews: 0, quiz_attempts: 0 },
    { day: '2026-11-03', reviews: 0, quiz_attempts: 0 },
    { day: '2026-11-04', reviews: 0, quiz_attempts: 0 },
    { day: '2026-11-05', reviews: 0, quiz_attempts: 0 },
    { day: '2026-11-06', reviews: 0, quiz_attempts: 0 },
    { day: '2026-11-07', reviews: 0, quiz_attempts: 0 },
    { day: '2026-11-08', reviews: 0, quiz_attempts: 0 },
  ],
  quiz_best: [],
};

function Harness({
  router,
}: {
  router: ReturnType<typeof createMemoryRouter>;
}) {
  const { user } = useAuth();
  return (
    <OfflineProvider userId={user?.id ?? ''}>
      <RouterProvider router={router} />
    </OfflineProvider>
  );
}

async function renderShell(
  path: string,
  routes: Record<string, unknown> = {},
  opts: {
    user?: UserOut;
    anonymous?: boolean;
    online?: boolean;
    pending?: number;
    modules?: ScreenModules;
  } = {},
) {
  const user = opts.anonymous ? null : (opts.user ?? ME_USER);
  const transport = fakeTransport({
    'GET /api/auth/me':
      user === null
        ? () => jsonResponse({ code: 'unauthenticated', message_es: '' }, 401)
        : { csrf_token: 'csrf-test', user },
    'GET /api/me/stats': STATS,
    ...routes,
  });

  if (opts.online === false) {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  }

  if (opts.pending !== undefined && opts.pending > 0 && user !== null) {
    for (let position = 0; position < opts.pending; position += 1) {
      await enqueue(user.id, {
        kind: 'plan_done',
        day: '2026-11-06',
        position,
      });
    }
  }

  const router = createMemoryRouter(buildRoutes(opts.modules ?? {}), {
    initialEntries: [path],
  });

  render(
    <AuthProvider transport={transport}>
      <Harness router={router} />
    </AuthProvider>,
  );

  return { router, transport, user };
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('las 5 pestañas, aria-current y texto visible', async () => {
  await renderShell('/repasar');
  await screen.findByLabelText('7 por repasar');

  const nav = screen.getByRole('navigation', { name: 'Secciones' });
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['Hoy', 'Temas', 'Repasar7', 'Chat', 'Más']);
  expect(within(nav).getByRole('link', { name: /Repasar/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(within(nav).getByLabelText('7 por repasar')).toBeVisible();
});

test('una pantalla ausente muestra Placeholder', async () => {
  await renderShell('/temas');

  expect(await screen.findByText('Esta sección llega pronto')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Temas' })).toBeVisible();
});

test('la ruta de admin ausente es 404 aunque el usuario sea admin', async () => {
  await renderShell('/mas/admin/usuarios', {}, { user: ME_ADMIN });

  expect(
    await screen.findByRole('heading', { name: 'Página no encontrada' }),
  ).toBeVisible();
  expect(screen.getByText('404')).toBeVisible();
});

test('anónimo va a /entrar con next', async () => {
  const { router } = await renderShell('/temas/tp_1', {}, { anonymous: true });

  expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeVisible();
  expect(
    `${router.state.location.pathname}${router.state.location.search}`,
  ).toBe('/entrar?next=%2Ftemas%2Ftp_1');
});

test('rol user no ve /mas/admin aunque el módulo exista', async () => {
  function AdminStub() {
    return <div>Admin de prueba</div>;
  }
  const adminLoader: ScreenModuleLoader = vi.fn(() =>
    Promise.resolve({ default: AdminStub }),
  );

  await renderShell(
    '/mas/admin/usuarios',
    {},
    {
      user: ME_USER,
      modules: { '../admin/AdminRoutes.tsx': adminLoader },
    },
  );

  expect(
    await screen.findByRole('heading', { name: 'Página no encontrada' }),
  ).toBeVisible();
  expect(adminLoader).not.toHaveBeenCalled();
});

test('admin ve el módulo de admin cuando existe', async () => {
  function AdminStub() {
    return <div>Admin de prueba</div>;
  }
  const adminLoader: ScreenModuleLoader = vi.fn(() =>
    Promise.resolve({ default: AdminStub }),
  );

  await renderShell(
    '/mas/admin/usuarios',
    {},
    {
      user: ME_ADMIN,
      modules: { '../admin/AdminRoutes.tsx': adminLoader },
    },
  );

  expect(await screen.findByText('Admin de prueba')).toBeVisible();
  expect(adminLoader).toHaveBeenCalledTimes(1);
});

test('al resolverse una pantalla perezosa el foco va a su h1', async () => {
  function AdminStub() {
    return <h1>Admin cargado</h1>;
  }
  const adminLoader: ScreenModuleLoader = vi.fn(() =>
    Promise.resolve({ default: AdminStub }),
  );

  await renderShell(
    '/mas/admin/usuarios',
    {},
    {
      user: ME_ADMIN,
      modules: { '../admin/AdminRoutes.tsx': adminLoader },
    },
  );

  const heading = await screen.findByRole('heading', { name: 'Admin cargado' });
  await waitFor(() => expect(heading).toHaveFocus());
});

test('banner sin conexión con cambios esperando', async () => {
  await renderShell('/', {}, { online: false, pending: 2 });

  await screen.findByText(/2 cambios esperando/);
  const status = screen
    .getAllByRole('status')
    .find((element) => element.textContent?.includes('Sin conexión'));
  expect(status).toBeDefined();
  expect(status).toHaveTextContent(
    'Sin conexión. Verás lo último que se guardó',
  );
  expect(status).toHaveTextContent('2 cambios esperando');
});

test('el foco va al h1 y el título cambia al navegar', async () => {
  const { router } = await renderShell('/temas');

  const temas = await screen.findByRole('heading', { name: 'Temas' });
  await waitFor(() => expect(temas).toHaveFocus());
  expect(document.title).toBe('Temas · Français');

  await userEvent.click(screen.getByRole('link', { name: 'Chat' }));

  const chat = await screen.findByRole('heading', { name: 'Chat' });
  await waitFor(() => expect(chat).toHaveFocus());
  expect(document.title).toBe('Chat · Français');
  expect(router.state.location.pathname).toBe('/chat');
});

test('SCREENS cubre el mapa completo de la app v2', () => {
  expect(SCREENS.map((screen) => screen.path)).toEqual([
    '/',
    '/temas',
    '/temas/:topicId',
    '/publicaciones/:itemId',
    '/repasar',
    '/repasar/pronunciacion',
    '/repasar/texto',
    '/quiz/:quizId',
    '/chat',
    '/chat/:threadId',
    '/mas',
    '/mas/admin/*',
  ]);
});

test('el glob de rutas excluye los tests', () => {
  expect(routesSource).toContain("'!**/*.test.tsx'");
  expect(routesSource).toContain("'../screens/*/*.tsx'");
  expect(routesSource).toContain("'../admin/AdminRoutes.tsx'");
  expect(
    Object.keys(SCREEN_MODULES).filter((key) => key.includes('.test.')),
  ).toEqual([]);
});
