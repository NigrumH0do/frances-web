import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useAuth } from '../../auth/AuthContext';
import { closeV2DbForTests } from '../../offline/db';
import { ME_ADMIN, ME_USER, renderScreen } from '../../shell/testing';
import AdminSlot, { type AdminModules } from './AdminSlot';

function AdminStub() {
  return <p>Panel de administración</p>;
}

const WITH_ADMIN: AdminModules = {
  '../../admin/AdminSection.tsx': { default: AdminStub },
};

function Harness({ modules }: { modules?: AdminModules }) {
  const { status } = useAuth();
  return (
    <>
      <p>estado:{status}</p>
      <AdminSlot modules={modules} />
    </>
  );
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test('el rol admin sale del servidor y no de un dato local editable', async () => {
  localStorage.setItem('role', 'admin');
  localStorage.setItem('fc-role', 'admin');

  renderScreen(<Harness modules={WITH_ADMIN} />, { user: ME_USER });

  expect(await screen.findByText('estado:authenticated')).toBeVisible();
  expect(screen.queryByText('Panel de administración')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'Administración' }),
  ).not.toBeInTheDocument();
});

test('AdminSlot: user no ve nada aunque exista el módulo de P11', async () => {
  renderScreen(<Harness modules={WITH_ADMIN} />, { user: ME_USER });

  expect(await screen.findByText('estado:authenticated')).toBeVisible();
  expect(screen.queryByText('Panel de administración')).not.toBeInTheDocument();
});

test('AdminSlot: admin con módulo ve la sección de administración', async () => {
  renderScreen(<Harness modules={WITH_ADMIN} />, { user: ME_ADMIN });

  expect(await screen.findByText('estado:authenticated')).toBeVisible();
  expect(await screen.findByText('Panel de administración')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Administración' })).toBeVisible();
});

test('AdminSlot: admin sin módulo P11 tampoco ve la sección', async () => {
  renderScreen(<Harness modules={{}} />, { user: ME_ADMIN });

  expect(await screen.findByText('estado:authenticated')).toBeVisible();
  expect(screen.queryByText('Panel de administración')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'Administración' }),
  ).not.toBeInTheDocument();
});
