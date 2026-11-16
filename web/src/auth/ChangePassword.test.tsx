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
import { AuthProvider } from './AuthContext';
import { ChangePassword } from './ChangePassword';

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

function renderChangePassword(transport: Transport) {
  return render(
    <AuthProvider transport={transport}>
      <ChangePassword />
    </AuthProvider>,
  );
}

function noContent(): Response {
  return new Response(null, { status: 204 });
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

test('no envía una contraseña corta ni una confirmación distinta', async () => {
  const transport = fakeTransport({
    'GET /api/auth/me': ME_U1,
    'POST /api/auth/password': noContent,
  });
  renderChangePassword(transport);

  await userEvent.type(
    screen.getByLabelText('Contraseña actual'),
    'actual-larga-1',
  );
  await userEvent.type(screen.getByLabelText('Nueva contraseña'), 'corta');
  await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'otra');
  await userEvent.click(
    screen.getByRole('button', { name: 'Cambiar contraseña' }),
  );

  expect(
    screen.getByText('La contraseña necesita al menos 12 caracteres'),
  ).toBeVisible();
  expect(screen.getByText('Las contraseñas no coinciden')).toBeVisible();
  expect(
    transport.calls.some((call) => call.url === '/api/auth/password'),
  ).toBe(false);
});

test('cambia la contraseña, avisa y limpia el formulario sin persistirla', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const transport = fakeTransport({
    'GET /api/auth/me': ME_U1,
    'POST /api/auth/password': noContent,
  });
  renderChangePassword(transport);

  const current = screen.getByLabelText('Contraseña actual');
  const next = screen.getByLabelText('Nueva contraseña');
  const confirm = screen.getByLabelText('Confirmar contraseña');
  await userEvent.type(current, 'actual-larga-1');
  await userEvent.type(next, 'nueva-larga-12');
  await userEvent.type(confirm, 'nueva-larga-12');
  await userEvent.click(
    screen.getByRole('button', { name: 'Cambiar contraseña' }),
  );

  expect(await screen.findByRole('status')).toHaveTextContent(
    'Contraseña cambiada; las demás sesiones se cerraron',
  );
  expect(
    transport.calls.find((call) => call.url === '/api/auth/password')?.body,
  ).toEqual({
    current_password: 'actual-larga-1',
    new_password: 'nueva-larga-12',
  });
  expect(current).toHaveValue('');
  expect(next).toHaveValue('');
  expect(confirm).toHaveValue('');
  expect(localStorage.getItem('fc-last-me')).not.toContain('nueva-larga-12');
  for (const call of setItem.mock.calls) {
    expect(String(call[1])).not.toContain('nueva-larga-12');
  }
});

test('400 con la contraseña actual incorrecta muestra el mensaje del servidor', async () => {
  const transport = fakeTransport({
    'GET /api/auth/me': ME_U1,
    'POST /api/auth/password': () =>
      jsonResponse(
        {
          code: 'bad_request',
          message_es: 'La contraseña actual no es correcta.',
        },
        400,
      ),
  });
  renderChangePassword(transport);

  await userEvent.type(
    screen.getByLabelText('Contraseña actual'),
    'actual-equivocada',
  );
  await userEvent.type(
    screen.getByLabelText('Nueva contraseña'),
    'nueva-larga-12',
  );
  await userEvent.type(
    screen.getByLabelText('Confirmar contraseña'),
    'nueva-larga-12',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Cambiar contraseña' }),
  );

  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'La contraseña actual no es correcta.',
    ),
  );
});
