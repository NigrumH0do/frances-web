import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { closeV2DbForTests } from '../offline/db';
import { ME_ADMIN, ME_USER, renderScreen } from '../shell/testing';
import AdminRoutes from './AdminRoutes';
import { adminModules, type AdminModules } from './adminNav';

function PipelineStub() {
  return <h1>Pipeline de prueba</h1>;
}

const ONLY_PIPELINE: AdminModules = {
  './screens/AdminPipeline.tsx': async () => ({ default: PipelineStub }),
};

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('user_never_sees_admin_routes', async () => {
  renderScreen(<AdminRoutes modules={ONLY_PIPELINE} />, {
    user: ME_USER,
    path: '/mas/admin/pipeline',
    pattern: '/mas/admin/*',
  });

  expect(
    await screen.findByRole('heading', { name: 'Página no encontrada' }),
  ).toBeVisible();
  expect(screen.queryByText('Pipeline de prueba')).not.toBeInTheDocument();
});

test('admin en el índice ve la navegación de administración', async () => {
  renderScreen(<AdminRoutes modules={ONLY_PIPELINE} />, {
    user: ME_ADMIN,
    path: '/mas/admin',
    pattern: '/mas/admin/*',
  });

  expect(
    await screen.findByRole('heading', { name: 'Administración' }),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: 'Pipeline' })).toHaveAttribute(
    'href',
    '/mas/admin/pipeline',
  );
});

test('admin monta la pantalla existente de forma perezosa', async () => {
  renderScreen(<AdminRoutes modules={ONLY_PIPELINE} />, {
    user: ME_ADMIN,
    path: '/mas/admin/pipeline',
    pattern: '/mas/admin/*',
  });

  expect(
    await screen.findByRole('heading', { name: 'Pipeline de prueba' }),
  ).toBeVisible();
});

test('una pantalla sin módulo cae en 404', async () => {
  renderScreen(<AdminRoutes modules={ONLY_PIPELINE} />, {
    user: ME_ADMIN,
    path: '/mas/admin/users',
    pattern: '/mas/admin/*',
  });

  expect(
    await screen.findByRole('heading', { name: 'Página no encontrada' }),
  ).toBeVisible();
});

test('adminModules excluye los tests y encuentra las pantallas creadas', () => {
  const keys = Object.keys(adminModules());

  expect(keys).toContain('./screens/AdminPipeline.tsx');
  expect(keys).toContain('./screens/AdminAudio.tsx');
  expect(keys.filter((key) => key.includes('.test.'))).toEqual([]);
});
