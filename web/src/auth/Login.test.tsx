import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Me } from '../contracts/generated';
import { useApi } from '../api/ApiContext';
import { fakeTransport, jsonResponse } from '../api/testing';
import type { Transport } from '../api/transport';
import { closeV2DbForTests } from '../offline/db';
import { AuthProvider, useAuth } from './AuthContext';
import Login from './Login';
import { authStrings } from './strings';

const authDir = dirname(fileURLToPath(import.meta.url));
const authCss = readFileSync(join(authDir, 'auth.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

const ME_U1: Me = {
  csrf_token: 'csrf-u1',
  user: {
    id: 'u1',
    email: 'a@example.com',
    display_name: 'Ana',
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

function CsrfProbe() {
  const { status } = useAuth();
  const { client } = useApi();
  return (
    <span data-testid="csrf" data-status={status}>
      {client.csrfToken() ?? ''}
    </span>
  );
}

function renderLogin(transport: Transport, path = '/entrar') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider transport={transport}>
        <Login />
        <LocationProbe />
        <CsrfProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('login guarda el CSRF y navega a next', async () => {
  const transport = fakeTransport({
    'GET /api/auth/me': () => jsonResponse(UNAUTHENTICATED, 401),
    'POST /api/auth/login': ME_U1,
  });
  renderLogin(transport, '/entrar?next=%2Frepasar');

  await userEvent.type(screen.getByLabelText('Email'), 'a@example.com');
  await userEvent.type(
    screen.getByLabelText('Contraseña'),
    'contraseña-larga-1',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent('/repasar'),
  );
  expect(screen.getByTestId('csrf')).toHaveTextContent('csrf-u1');
  expect(
    transport.calls.find((call) => call.url === '/api/auth/login')?.body,
  ).toEqual({ email: 'a@example.com', password: 'contraseña-larga-1' });
});

test('401 del login muestra el mensaje genérico y 429 pide esperar', async () => {
  const routes: Record<string, unknown> = {
    'GET /api/auth/me': () => jsonResponse(UNAUTHENTICATED, 401),
    'POST /api/auth/login': () =>
      jsonResponse(
        {
          code: 'unauthenticated',
          message_es: 'Email o contraseña incorrectos.',
        },
        401,
      ),
  };
  const transport = fakeTransport(routes);
  renderLogin(transport);

  await userEvent.type(screen.getByLabelText('Email'), 'a@example.com');
  await userEvent.type(
    screen.getByLabelText('Contraseña'),
    'contraseña-larga-1',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Email o contraseña incorrectos.',
  );

  routes['POST /api/auth/login'] = () =>
    jsonResponse({ code: 'rate_limited', message_es: '' }, 429);
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(/espera un minuto/i),
  );
});

test('la contraseña no se guarda fuera del estado del formulario', async () => {
  const password = 'contraseña-larga-1';
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const logs = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
    vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
  ];

  const transport = fakeTransport({
    'GET /api/auth/me': () => jsonResponse(UNAUTHENTICATED, 401),
    'POST /api/auth/login': ME_U1,
  });
  const view = renderLogin(transport, '/entrar?next=%2Frepasar');

  await userEvent.type(screen.getByLabelText('Email'), 'a@example.com');
  await userEvent.type(screen.getByLabelText('Contraseña'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent('/repasar'),
  );

  expect(localStorage.getItem('fc-last-me')).not.toContain(password);
  expect(sessionStorage.length).toBe(0);
  for (const call of setItem.mock.calls) {
    expect(String(call[1])).not.toContain(password);
  }
  for (const log of logs) {
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining(password));
  }

  view.unmount();
  expect(localStorage.getItem('fc-last-me')).not.toContain(password);
});

test('muestra botón de Google si está habilitado y avisos de callback OAuth', async () => {
  const transport = fakeTransport({
    'GET /api/auth/me': () => jsonResponse(UNAUTHENTICATED, 401),
    'GET /api/auth/providers': {
      google_enabled: true,
      password_enabled: true,
    },
  });
  renderLogin(transport, '/entrar?next=%2Frepasar&status=pending');

  expect(screen.getByRole('status')).toHaveTextContent(
    'Espera a que el administrador apruebe tu acceso.',
  );
  const googleLink = await screen.findByRole('link', {
    name: /Continuar con Google/,
  });
  expect(googleLink).toHaveAttribute(
    'href',
    '/api/auth/google/start?next=%2Frepasar',
  );

  cleanup();
  renderLogin(transport, '/entrar?error=account_disabled');
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Tu cuenta está deshabilitada. Contacta al administrador.',
  );
});

test('max_users del alta con Google muestra el aviso de límite de cuentas', () => {
  const transport = fakeTransport({
    'GET /api/auth/me': () => jsonResponse(UNAUTHENTICATED, 401),
  });
  renderLogin(transport, '/entrar?error=max_users');

  expect(screen.getByRole('alert')).toHaveTextContent(
    'No se creó tu cuenta: se alcanzó el número máximo de usuarios. Contacta al administrador.',
  );
});

test('el aviso pending es espera en oro, con reloj decorativo y formulario', async () => {
  const transport = fakeTransport({
    'GET /api/auth/me': () => jsonResponse(UNAUTHENTICATED, 401),
  });
  renderLogin(transport, '/entrar?status=pending');
  await waitFor(() =>
    expect(screen.getByTestId('csrf')).toHaveAttribute(
      'data-status',
      'anonymous',
    ),
  );

  const status = screen.getByRole('status');
  expect(status).toHaveClass('auth-wait');
  expect(status).toHaveTextContent(authStrings.login.pendingNotice);
  expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Entrar' }).closest('form'),
  ).not.toBeNull();
  expect(document.querySelector('.auth-fallback-badge')).toBeNull();
  expect(document.querySelector('.notebook-fallback')).not.toBeNull();
});

test('los errores OAuth se anuncian como alerta', () => {
  const cases = [
    ['google_denied', authStrings.login.googleDenied],
    ['oauth_state', authStrings.login.oauthState],
    ['google_unverified', authStrings.login.googleUnverified],
    ['google_failed', authStrings.login.googleFailed],
    ['max_users', authStrings.login.maxUsers],
  ] as const;
  const transport = fakeTransport({
    'GET /api/auth/me': () => jsonResponse(UNAUTHENTICATED, 401),
  });

  for (const [code, text] of cases) {
    cleanup();
    renderLogin(transport, `/entrar?error=${code}`);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(text);
    expect(alert).toHaveClass('callout', 'error');
    expect(screen.queryByRole('status')).toBeNull();
  }
});

test('con Google apagado no hay botón ni raya divisoria', async () => {
  const transport = fakeTransport({
    'GET /api/auth/me': () => jsonResponse(UNAUTHENTICATED, 401),
    'GET /api/auth/providers': {
      google_enabled: false,
      password_enabled: true,
    },
  });
  renderLogin(transport);

  await waitFor(() =>
    expect(
      transport.calls.some((call) => call.url === '/api/auth/providers'),
    ).toBe(true),
  );
  expect(
    screen.queryByRole('link', { name: /Continuar con Google/ }),
  ).toBeNull();
  expect(document.querySelector('.auth-divider')).toBeNull();
  expect(screen.getByLabelText('Email')).toBeVisible();
});

test('auth.css apila la portada bajo 720px y agranda el botón de Google', () => {
  const at = authCss.search(/@media\s*\(\s*min-width:\s*720px\s*\)/);
  expect(at).toBeGreaterThan(-1);
  const before = authCss.slice(0, at);
  const from = authCss.slice(at);

  expect(before).toMatch(/grid-template-columns:\s*1fr\s*;/);
  expect(before).not.toMatch(/minmax\(\s*108px\s*,\s*148px\s*\)/);
  expect(before).toMatch(/\.auth-cover-visual\s*\{[^}]*height:\s*160px/);
  expect(from).toMatch(
    /grid-template-columns:\s*1fr\s+minmax\(\s*108px\s*,\s*148px\s*\)/,
  );
  expect(authCss).toMatch(
    /\.btn-google\s*\{[^}]*min-height:\s*var\(--tap-lg\)/,
  );

  const wait = /\.auth-wait\s*\{([^}]*)\}/.exec(authCss)?.[1] ?? '';
  expect(wait).toMatch(/background:\s*var\(--c-gold-soft\)/);
  expect(wait).toMatch(/color:\s*var\(--c-gold\)\s*;/);
  expect(wait).not.toMatch(/--c-gold-3d/);
  expect(wait).not.toMatch(/transition/);
  expect(authCss).not.toMatch(/color:\s*[^;]*var\(--c-gold-3d\)/);
});
