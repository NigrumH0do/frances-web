import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Me } from '../contracts/generated';
import { useApi } from '../api/ApiContext';
import { fakeTransport, jsonResponse } from '../api/testing';
import { closeV2DbForTests } from '../offline/db';
import { AuthProvider, useAuth } from './AuthContext';

const ME_U1: Me = {
  csrf_token: 'csrf-u1',
  user: {
    id: 'u1',
    email: 'ana@example.test',
    display_name: 'Ana',
    role: 'user',
    created_at: '2026-11-01T00:00:00.000Z',
    last_login_at: null,
    disabled: false,
  },
};

const UNAUTHENTICATED = { code: 'unauthenticated', message_es: '' };

function Probe() {
  const { status, user } = useAuth();
  return (
    <>
      <output data-testid="status">{status}</output>
      <output data-testid="user">{user?.display_name ?? ''}</output>
    </>
  );
}

function CallPrivate() {
  const { client } = useApi();
  return (
    <button
      type="button"
      onClick={() => void client.get('/api/private').catch(() => undefined)}
    >
      Llamar
    </button>
  );
}

function fail(): Promise<never> {
  return Promise.reject(new TypeError('Failed to fetch'));
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('sin red al arrancar usa el último usuario y entra en modo offline', async () => {
  localStorage.setItem('fc-last-me', JSON.stringify(ME_U1.user));
  let online = false;
  const transport = fakeTransport({
    'GET /api/auth/me': () => (online ? jsonResponse(ME_U1) : fail()),
  });

  render(
    <AuthProvider transport={transport}>
      <Probe />
    </AuthProvider>,
  );

  await waitFor(() =>
    expect(screen.getByTestId('status')).toHaveTextContent('offline'),
  );
  expect(screen.getByTestId('user')).toHaveTextContent('Ana');

  online = true;
  window.dispatchEvent(new Event('online'));

  await waitFor(() =>
    expect(
      transport.calls.filter((call) => call.url === '/api/auth/me'),
    ).toHaveLength(2),
  );
  await waitFor(() =>
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
  );
  expect(
    transport.calls.filter((call) => call.url === '/api/auth/me'),
  ).toHaveLength(2);
});

test('sin red y sin último usuario queda anónimo', async () => {
  const transport = fakeTransport({
    'GET /api/auth/me': fail,
  });

  render(
    <AuthProvider transport={transport}>
      <Probe />
    </AuthProvider>,
  );

  await waitFor(() =>
    expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
  );
  expect(screen.getByTestId('user')).toBeEmptyDOMElement();
});

test('401 del arranque deja la sesión anónima', async () => {
  const transport = fakeTransport({
    'GET /api/auth/me': () => jsonResponse(UNAUTHENTICATED, 401),
  });

  render(
    <AuthProvider transport={transport}>
      <Probe />
    </AuthProvider>,
  );

  await waitFor(() =>
    expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
  );
  expect(screen.getByTestId('user')).toBeEmptyDOMElement();
});

test('un 401 de otra llamada deja la sesión anónima', async () => {
  const transport = fakeTransport({
    'GET /api/auth/me': ME_U1,
    'GET /api/private': () => jsonResponse(UNAUTHENTICATED, 401),
  });

  render(
    <AuthProvider transport={transport}>
      <Probe />
      <CallPrivate />
    </AuthProvider>,
  );

  await waitFor(() =>
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Llamar' }));
  await waitFor(() =>
    expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
  );
  expect(screen.getByTestId('user')).toBeEmptyDOMElement();
});
