import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { jsonResponse } from '../../api/testing';
import type { UserOut } from '../../contracts/generated';
import { closeV2DbForTests } from '../../offline/db';
import { ME_ADMIN, ME_USER, renderScreen } from '../../shell/testing';
import AdminRoutes from '../AdminRoutes';
import AdminUsers from './AdminUsers';

const USER_ANA: UserOut = {
  id: 'u_ana',
  email: 'ana@example.test',
  display_name: 'Ana',
  role: 'admin',
  created_at: '2026-11-01T00:00:00.000Z',
  last_login_at: '2026-11-05T12:00:00.000Z',
  disabled: false,
};

const USER_LEO: UserOut = {
  id: 'u_leo',
  email: 'leo@example.test',
  display_name: 'Leo',
  role: 'user',
  created_at: '2026-11-02T00:00:00.000Z',
  last_login_at: null,
  disabled: false,
};

const USER_MARIA: UserOut = {
  id: 'u_maria',
  email: 'maria@example.test',
  display_name: 'María',
  role: 'user',
  created_at: '2026-11-03T00:00:00.000Z',
  last_login_at: null,
  disabled: true,
};

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('deshabilitar usuario pide confirmación y llama a la API', async () => {
  const { transport } = renderScreen(<AdminUsers />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/users': [USER_ANA, USER_LEO],
      'POST /api/admin/users/u_leo/disable': { ...USER_LEO, disabled: true },
    },
  });

  await userEvent.click(
    await screen.findByRole('button', { name: 'Deshabilitar Leo' }),
  );
  expect(
    transport.calls.some(
      (call) => call.url === '/api/admin/users/u_leo/disable',
    ),
  ).toBe(false);

  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

  await waitFor(() =>
    expect(
      transport.calls.some(
        (call) => call.url === '/api/admin/users/u_leo/disable',
      ),
    ).toBe(true),
  );
});

test('usuarios muestra nombre, correo, rol, estado y último acceso', async () => {
  renderScreen(<AdminUsers />, {
    user: ME_ADMIN,
    routes: { 'GET /api/admin/users': [USER_ANA, USER_LEO, USER_MARIA] },
  });

  expect(await screen.findByText('Ana')).toBeVisible();
  expect(screen.getByText('ana@example.test')).toBeVisible();
  expect(screen.getByText('Administrador')).toBeVisible();
  expect(screen.getAllByText('Usuario')).toHaveLength(2);
  expect(screen.getAllByText('Activo')).toHaveLength(2);
  expect(screen.getByText('Deshabilitado')).toBeVisible();
  expect(screen.getByText(/Último acceso:/)).toBeVisible();
  expect(screen.getAllByText('Nunca ha iniciado sesión')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Habilitar María' })).toBeVisible();
});

test('habilitar usuario llama a la API', async () => {
  const { transport } = renderScreen(<AdminUsers />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/users': [USER_ANA, USER_MARIA],
      'POST /api/admin/users/u_maria/enable': {
        ...USER_MARIA,
        disabled: false,
      },
    },
  });

  await userEvent.click(
    await screen.findByRole('button', { name: 'Habilitar María' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

  await waitFor(() =>
    expect(
      transport.calls.some(
        (call) => call.url === '/api/admin/users/u_maria/enable',
      ),
    ).toBe(true),
  );
});

test('el error del último admin se anuncia', async () => {
  renderScreen(<AdminUsers />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/users': [USER_ANA, USER_LEO],
      'POST /api/admin/users/u_ana/disable': () =>
        jsonResponse(
          {
            code: 'conflict',
            message_es:
              'no se puede deshabilitar al último administrador activo',
          },
          409,
        ),
    },
  });

  await userEvent.click(
    await screen.findByRole('button', { name: 'Deshabilitar Ana' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'último administrador activo',
  );
  expect(screen.getByText('Ana')).toBeVisible();
});

test('usuarios muestra carga, vacío y error con Reintentar', async () => {
  renderScreen(<AdminUsers />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/users': () => new Promise<Response>(() => undefined),
    },
  });
  expect(screen.getByRole('status')).toHaveTextContent('Cargando');

  cleanup();
  renderScreen(<AdminUsers />, {
    user: ME_ADMIN,
    routes: { 'GET /api/admin/users': [] },
  });
  expect(await screen.findByText('No hay usuarios')).toBeVisible();

  cleanup();
  let fail = true;
  renderScreen(<AdminUsers />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/users': () =>
        Promise.resolve(
          fail
            ? jsonResponse(
                { code: 'internal', message_es: 'fallo del servidor' },
                500,
              )
            : jsonResponse([]),
        ),
    },
  });
  expect(
    await screen.findByText('Algo salió mal en el servidor'),
  ).toBeVisible();
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('No hay usuarios')).toBeVisible();
});

test('un usuario normal no puede montar la pantalla de usuarios', async () => {
  renderScreen(<AdminRoutes />, {
    user: ME_USER,
    path: '/mas/admin/users',
    pattern: '/mas/admin/*',
  });

  expect(
    await screen.findByRole('heading', { name: 'Página no encontrada' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('heading', { name: 'Usuarios' }),
  ).not.toBeInTheDocument();
});
