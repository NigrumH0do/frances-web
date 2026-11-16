import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Me } from '../contracts/generated';
import { fakeTransport, jsonResponse } from '../api/testing';
import type { Transport } from '../api/transport';
import { closeV2DbForTests } from '../offline/db';
import { enqueue, pendingCount, type OutboxOp } from '../offline/outbox';
import { lastMe } from '../offline/purge';
import { AuthProvider, useAuth } from './AuthContext';
import { LogoutButton } from './LogoutButton';

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

const reviewOp = (cardId: string): OutboxOp => ({
  kind: 'review',
  body: {
    card_id: cardId,
    rating: 3,
    reviewed_at: '2026-11-06T10:00:00.000Z',
    next: {
      due: '2026-11-06T10:00:00.000Z',
      stability: 1,
      difficulty: 5,
      elapsed_days: 0,
      scheduled_days: 1,
      learning_steps: 0,
      reps: 1,
      lapses: 0,
      state: 2,
      last_review: '2026-11-06T10:00:00.000Z',
    },
  },
});

function StatusProbe() {
  const { status } = useAuth();
  return <output data-testid="auth-status">{status}</output>;
}

function renderLogout(transport: Transport) {
  return render(
    <AuthProvider transport={transport}>
      <LogoutButton />
      <StatusProbe />
    </AuthProvider>,
  );
}

function noContent(): Response {
  return new Response(null, { status: 204 });
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

test('logout warns when outbox has pending writes', async () => {
  await enqueue('u1', reviewOp('c1'));
  const transport = fakeTransport({
    'GET /api/auth/me': ME_U1,
    'POST /api/reviews': fail,
    'POST /api/auth/logout': noContent,
  });
  renderLogout(transport);

  await waitFor(() =>
    expect(screen.getByTestId('auth-status')).toHaveTextContent(
      'authenticated',
    ),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

  expect(
    await screen.findByRole('dialog', {
      name: 'Hay 1 cambio sin sincronizar',
    }),
  ).toBeVisible();
  expect(transport.calls.some((call) => call.url === '/api/auth/logout')).toBe(
    false,
  );
  expect(await pendingCount('u1')).toBe(1);

  await userEvent.click(
    screen.getByRole('button', { name: 'Cerrar sesión igual' }),
  );

  await waitFor(() =>
    expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous'),
  );
  expect(transport.calls.some((call) => call.url === '/api/auth/logout')).toBe(
    true,
  );
  expect(await pendingCount('u1')).toBe(0);
  expect(localStorage.getItem('fc-last-me')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('logout envía la cola antes de cerrar la sesión', async () => {
  await enqueue('u1', reviewOp('c1'));
  const transport = fakeTransport({
    'GET /api/auth/me': ME_U1,
    'POST /api/reviews': { card_id: 'c1' },
    'POST /api/auth/logout': noContent,
  });
  renderLogout(transport);

  await waitFor(() =>
    expect(screen.getByTestId('auth-status')).toHaveTextContent(
      'authenticated',
    ),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

  await waitFor(() =>
    expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous'),
  );
  const urls = transport.calls.map((call) => call.url);
  expect(urls).toContain('/api/reviews');
  expect(urls.indexOf('/api/reviews')).toBeLessThan(
    urls.indexOf('/api/auth/logout'),
  );
  expect(await pendingCount('u1')).toBe(0);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('logout sin pendientes no pregunta y purga los datos locales', async () => {
  const transport = fakeTransport({
    'GET /api/auth/me': ME_U1,
    'POST /api/auth/logout': noContent,
  });
  renderLogout(transport);

  await waitFor(() =>
    expect(screen.getByTestId('auth-status')).toHaveTextContent(
      'authenticated',
    ),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

  await waitFor(() =>
    expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous'),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(localStorage.getItem('fc-last-me')).toBeNull();
});

test('logout con un 401 al vaciar la cola cierra igual y purga los datos', async () => {
  await enqueue('u1', reviewOp('c1'));
  const transport = fakeTransport({
    'GET /api/auth/me': ME_U1,
    'POST /api/reviews': () =>
      jsonResponse({ code: 'unauthenticated', message_es: '' }, 401),
    'POST /api/auth/logout': () =>
      jsonResponse({ code: 'unauthenticated', message_es: '' }, 401),
  });
  renderLogout(transport);

  await waitFor(() =>
    expect(screen.getByTestId('auth-status')).toHaveTextContent(
      'authenticated',
    ),
  );
  expect(await pendingCount('u1')).toBe(1);

  await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

  // Con el arreglo el 401 de la cola cierra directamente; si el diálogo
  // llegara a aparecer, «Cerrar sesión igual» también debe purgar.
  const discard = await screen
    .findByRole('button', { name: 'Cerrar sesión igual' }, { timeout: 300 })
    .catch(() => null);
  if (discard !== null) {
    await userEvent.click(discard);
  }

  await waitFor(() => expect(localStorage.getItem('fc-last-me')).toBeNull());
  expect(await pendingCount('u1')).toBe(0);
  expect(lastMe()).toBeNull();
  expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous');
});
