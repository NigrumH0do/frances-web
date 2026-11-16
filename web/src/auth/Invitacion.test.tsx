import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Me } from '../contracts/generated';
import { fakeTransport, jsonResponse } from '../api/testing';
import type { Transport } from '../api/transport';
import { closeV2DbForTests } from '../offline/db';
import { AuthProvider } from './AuthContext';
import Invitacion from './Invitacion';

const ME_U1: Me = {
  csrf_token: 'csrf-u1',
  user: {
    id: 'u1',
    email: 'nueva@example.com',
    display_name: 'Nueva',
    role: 'user',
    created_at: '2026-11-01T00:00:00.000Z',
    last_login_at: null,
    disabled: false,
  },
};

const UNAUTHENTICATED = { code: 'unauthenticated', message_es: '' };

function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
    </span>
  );
}

function renderInvitacion(transport: Transport, path = '/invitacion#tok123') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider transport={transport}>
        <Invitacion />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function storedToken(): string | null {
  return findToken(localStorage);
}

function storedTokenInSession(): string | null {
  return findToken(sessionStorage);
}

function findToken(storage: Storage): string | null {
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (
      key !== null &&
      (key.includes('tok123') || storage.getItem(key)?.includes('tok123'))
    ) {
      return key;
    }
  }
  return null;
}

beforeEach(async () => {
  history.replaceState(null, '', '/');
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('invitación: borra el token de la URL, valida contraseña y entra', async () => {
  history.replaceState(null, '', '/invitacion#tok123');
  const logs = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
    vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
  ];
  const transport = fakeTransport({
    'GET /api/auth/me': () => jsonResponse(UNAUTHENTICATED, 401),
    'POST /api/auth/invite/check': {
      valid: true,
      expires_at: '2026-11-08T00:00:00.000Z',
    },
    'POST /api/auth/invite/accept': ME_U1,
  });
  renderInvitacion(transport);

  await waitFor(() => expect(window.location.hash).toBe(''));
  expect(window.location.href).not.toContain('tok123');
  expect(
    await screen.findByRole('heading', { name: 'Aceptar invitación' }),
  ).toBeVisible();
  await screen.findByLabelText('Email');

  const check = transport.calls.find(
    (call) => call.url === '/api/auth/invite/check',
  );
  expect(check?.body).toEqual({ token: 'tok123' });

  await userEvent.type(screen.getByLabelText('Email'), 'nueva@example.com');
  await userEvent.type(screen.getByLabelText('Nombre visible'), 'Nueva');
  await userEvent.type(screen.getByLabelText('Contraseña'), 'corta');
  await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'otra');
  await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

  expect(
    screen.getByText('La contraseña necesita al menos 12 caracteres'),
  ).toBeVisible();
  expect(screen.getByText('Las contraseñas no coinciden')).toBeVisible();
  expect(
    transport.calls.some((call) => call.url === '/api/auth/invite/accept'),
  ).toBe(false);

  await userEvent.clear(screen.getByLabelText('Contraseña'));
  await userEvent.type(
    screen.getByLabelText('Contraseña'),
    'contraseña-larga-1',
  );
  await userEvent.clear(screen.getByLabelText('Confirmar contraseña'));
  await userEvent.type(
    screen.getByLabelText('Confirmar contraseña'),
    'contraseña-larga-1',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/),
  );
  expect(
    transport.calls.find((call) => call.url === '/api/auth/invite/accept')
      ?.body,
  ).toEqual({
    token: 'tok123',
    email: 'nueva@example.com',
    display_name: 'Nueva',
    password: 'contraseña-larga-1',
  });
  expect(storedToken()).toBeNull();
  expect(storedTokenInSession()).toBeNull();
  for (const log of logs) {
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('tok123'));
  }
});

test('invitación inválida no muestra el formulario', async () => {
  history.replaceState(null, '', '/invitacion#tok123');
  const transport = fakeTransport({
    'GET /api/auth/me': () => jsonResponse(UNAUTHENTICATED, 401),
    'POST /api/auth/invite/check': { valid: false, expires_at: null },
  });
  renderInvitacion(transport);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'El enlace no vale o caducó.',
  );
  expect(screen.queryByLabelText('Email')).toBeNull();
});

test('email existente e invitación inválida dan el mismo 400 sin revelar cuentas', async () => {
  history.replaceState(null, '', '/invitacion#tok123');
  const transport = fakeTransport({
    'GET /api/auth/me': () => jsonResponse(UNAUTHENTICATED, 401),
    'POST /api/auth/invite/check': {
      valid: true,
      expires_at: '2026-11-08T00:00:00.000Z',
    },
    'POST /api/auth/invite/accept': () =>
      jsonResponse(
        { code: 'bad_request', message_es: 'la invitación no es válida' },
        400,
      ),
  });
  renderInvitacion(transport);

  await userEvent.type(
    await screen.findByLabelText('Email'),
    'nueva@example.com',
  );
  await userEvent.type(screen.getByLabelText('Nombre visible'), 'Nueva');
  await userEvent.type(
    screen.getByLabelText('Contraseña'),
    'contraseña-larga-1',
  );
  await userEvent.type(
    screen.getByLabelText('Confirmar contraseña'),
    'contraseña-larga-1',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'El enlace no vale o caducó.',
  );
  expect(screen.queryByText('Ese email ya tiene cuenta')).toBeNull();
});

test('sin token en la URL no se llama a la API', async () => {
  history.replaceState(null, '', '/invitacion');
  const transport = fakeTransport({
    'GET /api/auth/me': () => jsonResponse(UNAUTHENTICATED, 401),
  });
  renderInvitacion(transport, '/invitacion');

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'El enlace no vale o caducó.',
  );
  expect(
    transport.calls.some((call) => call.url === '/api/auth/invite/check'),
  ).toBe(false);
});
