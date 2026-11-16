import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useAuth } from '../auth/AuthContext';
import { closeV2DbForTests } from '../offline/db';
import { ME_ADMIN, ME_USER, renderScreen } from '../shell/testing';
import AdminSection from './AdminSection';
import type { AdminModules } from './adminNav';

function AdminHarness() {
  const { status } = useAuth();
  return (
    <>
      <p>estado:{status}</p>
      <AdminSection />
    </>
  );
}

const ONLY_PIPELINE: AdminModules = {
  './screens/AdminPipeline.tsx': async () => ({
    default: () => <p>pipeline de prueba</p>,
  }),
};

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('user_never_sees_admin_section', async () => {
  renderScreen(<AdminHarness />, { user: ME_USER, path: '/mas' });

  expect(await screen.findByText('estado:authenticated')).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'Pipeline' }),
  ).not.toBeInTheDocument();
  expect(document.querySelector('.card')).toBeNull();
});

test('admin ve la navegación de gestión y pipeline', async () => {
  renderScreen(<AdminSection />, { user: ME_ADMIN, path: '/mas' });

  expect(await screen.findByRole('link', { name: 'Pipeline' })).toHaveAttribute(
    'href',
    '/mas/admin/pipeline',
  );
  expect(screen.getByRole('link', { name: 'Audio' })).toHaveAttribute(
    'href',
    '/mas/admin/audio',
  );
});

test('solo lista las pantallas cuyo módulo existe', async () => {
  renderScreen(<AdminSection modules={ONLY_PIPELINE} />, {
    user: ME_ADMIN,
    path: '/mas',
  });

  expect(await screen.findByRole('link', { name: 'Pipeline' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Audio' })).not.toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Usuarios' }),
  ).not.toBeInTheDocument();
});
