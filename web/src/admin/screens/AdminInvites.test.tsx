import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { jsonResponse } from '../../api/testing';
import type { InviteOut } from '../../contracts/generated';
import { closeV2DbForTests } from '../../offline/db';
import { ME_ADMIN, renderScreen } from '../../shell/testing';
import AdminInvites from './AdminInvites';

const ACTIVE_INVITE: InviteOut = {
  id: 'inv_active',
  role: 'user',
  note: 'Compañero de clase',
  created_at: '2026-11-06T10:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z',
  used_at: null,
  revoked_at: null,
};

const USED_INVITE: InviteOut = {
  id: 'inv_used',
  role: 'admin',
  note: 'Invitación usada',
  created_at: '2026-11-04T10:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z',
  used_at: '2026-11-05T10:00:00.000Z',
  revoked_at: null,
};

const REVOKED_INVITE: InviteOut = {
  id: 'inv_revoked',
  role: 'user',
  note: 'Invitación revocada',
  created_at: '2026-11-03T10:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z',
  used_at: null,
  revoked_at: '2026-11-04T10:00:00.000Z',
};

const EXPIRED_INVITE: InviteOut = {
  id: 'inv_expired',
  role: 'user',
  note: 'Invitación vencida',
  created_at: '2020-01-01T10:00:00.000Z',
  expires_at: '2020-01-02T10:00:00.000Z',
  used_at: null,
  revoked_at: null,
};

const CREATED_INVITE = {
  invite: ACTIVE_INVITE,
  url: 'https://frances.example.org/invitacion#tok_123',
};

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard',
);

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (clipboardDescriptor === undefined) {
    Reflect.deleteProperty(navigator, 'clipboard');
  } else {
    Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  }
});

test('invite_url_is_shown_once_and_never_persisted', async () => {
  const log = vi.spyOn(console, 'log');
  const info = vi.spyOn(console, 'info');
  const warn = vi.spyOn(console, 'warn');
  const error = vi.spyOn(console, 'error');
  const debug = vi.spyOn(console, 'debug');

  const { transport } = renderScreen(<AdminInvites />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/invites': [],
      'POST /api/admin/invites': CREATED_INVITE,
    },
  });

  await userEvent.click(
    await screen.findByRole('button', { name: 'Crear invitación' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Crear enlace' }));

  expect(await screen.findByDisplayValue(/invitacion#tok_123/)).toBeVisible();
  expect(screen.getByText(/Este enlace solo se muestra una vez/)).toBeVisible();
  expect(JSON.stringify(localStorage)).not.toContain('tok_123');
  expect(JSON.stringify(sessionStorage)).not.toContain('tok_123');
  expect(transport.calls.some((call) => call.url.includes('tok_123'))).toBe(
    false,
  );
  for (const spy of [log, info, warn, error, debug]) {
    expect(spy.mock.calls.join(' ')).not.toContain('tok_123');
  }

  await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
  expect(
    screen.queryByDisplayValue(/invitacion#tok_123/),
  ).not.toBeInTheDocument();

  await userEvent.click(
    screen.getByRole('button', { name: 'Crear invitación' }),
  );
  expect(
    screen.queryByDisplayValue(/invitacion#tok_123/),
  ).not.toBeInTheDocument();
});

test('crear invitación envía rol, nota y vigencia', async () => {
  const { transport } = renderScreen(<AdminInvites />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/invites': [],
      'POST /api/admin/invites': CREATED_INVITE,
    },
  });

  await userEvent.click(
    await screen.findByRole('button', { name: 'Crear invitación' }),
  );
  await userEvent.click(screen.getByRole('radio', { name: 'Administrador' }));
  await userEvent.type(screen.getByLabelText('Nota'), 'Para Lucía');
  await userEvent.click(screen.getByRole('radio', { name: '72 horas' }));
  await userEvent.click(screen.getByRole('button', { name: 'Crear enlace' }));

  await waitFor(() => {
    const call = transport.calls.find(
      (entry) => entry.method === 'POST' && entry.url === '/api/admin/invites',
    );
    expect(call?.body).toEqual({
      role: 'admin',
      note: 'Para Lucía',
      ttl_hours: 72,
    });
  });
});

test('copiar enlace escribe en el portapapeles', async () => {
  const writeText = vi.fn(() => Promise.resolve());
  stubClipboard(writeText);

  renderScreen(<AdminInvites />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/invites': [],
      'POST /api/admin/invites': CREATED_INVITE,
    },
  });

  await userEvent.click(
    await screen.findByRole('button', { name: 'Crear invitación' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Crear enlace' }));
  await userEvent.click(
    await screen.findByRole('button', { name: 'Copiar enlace' }),
  );

  expect(writeText).toHaveBeenCalledWith(
    'https://frances.example.org/invitacion#tok_123',
  );
  expect(await screen.findByText('Enlace copiado.')).toBeVisible();
});

test('revocar invitación llama DELETE', async () => {
  const { transport } = renderScreen(<AdminInvites />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/invites': [ACTIVE_INVITE],
      'DELETE /api/admin/invites/inv_active': () =>
        new Response(null, { status: 204 }),
    },
  });

  await userEvent.click(await screen.findByRole('button', { name: 'Revocar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

  await waitFor(() =>
    expect(
      transport.calls.some(
        (call) =>
          call.method === 'DELETE' &&
          call.url === '/api/admin/invites/inv_active',
      ),
    ).toBe(true),
  );
  expect(await screen.findByText('Invitación revocada.')).toBeVisible();
});

test('invitaciones muestra rol, nota, vencimiento y estado', async () => {
  renderScreen(<AdminInvites />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/invites': [
        ACTIVE_INVITE,
        USED_INVITE,
        REVOKED_INVITE,
        EXPIRED_INVITE,
      ],
    },
  });

  expect(await screen.findByText('Compañero de clase')).toBeVisible();
  expect(screen.getByText(/Administrador · Vence:/)).toBeVisible();
  expect(screen.getAllByText(/Usuario · Vence:/)).toHaveLength(3);
  expect(screen.getAllByText(/Vence:/)).toHaveLength(4);
  expect(screen.getByText('Vigente')).toBeVisible();
  expect(screen.getByText('Usada')).toBeVisible();
  expect(screen.getByText('Revocada')).toBeVisible();
  expect(screen.getByText('Vencida')).toBeVisible();
  expect(screen.getAllByRole('button', { name: 'Revocar' })).toHaveLength(1);
});

test('invitaciones muestra carga, vacío y error con Reintentar', async () => {
  renderScreen(<AdminInvites />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/invites': () => new Promise<Response>(() => undefined),
    },
  });
  expect(screen.getByRole('status')).toHaveTextContent('Cargando');

  cleanup();
  renderScreen(<AdminInvites />, {
    user: ME_ADMIN,
    routes: { 'GET /api/admin/invites': [] },
  });
  expect(await screen.findByText('No hay invitaciones')).toBeVisible();

  cleanup();
  let fail = true;
  renderScreen(<AdminInvites />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/invites': () =>
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
  expect(await screen.findByText('No hay invitaciones')).toBeVisible();
});
