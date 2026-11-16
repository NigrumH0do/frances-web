import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { jsonResponse } from '../../api/testing';
import type {
  CardView,
  JobOut,
  UserPrefs,
  VoiceOut,
} from '../../contracts/generated';
import { closeV2DbForTests } from '../../offline/db';
import { ME_ADMIN, renderScreen } from '../../shell/testing';
import AdminCards from './AdminCards';

const VOICES: VoiceOut[] = [
  {
    id: 'voice-a',
    label: 'Denise',
    accent: 'fr-FR',
    age: 'adult',
    gender: 'female',
  },
];

const PREFS: UserPrefs = {
  preferred_voice_ids: ['voice-a'],
  daily_new_cards: 10,
  theme: 'system',
};

const JOB: JobOut = {
  id: 21,
  kind: 'audio.regenerate',
  state: 'queued',
  attempts: 0,
  max_attempts: 5,
  run_after: '2026-11-07T10:00:00.000Z',
  last_error: null,
  created_at: '2026-11-07T10:00:00.000Z',
  updated_at: '2026-11-07T10:00:00.000Z',
  finished_at: null,
};

const SHARED_CARD: CardView = {
  id: 'c_1',
  kind: 'phrase',
  front_fr: 'le chat',
  back_es: 'el gato',
  example_fr: 'Le chat dort.',
  example_es: 'El gato duerme.',
  notes: null,
  ipa: null,
  phonemes: [],
  tags: [],
  stale: false,
  source_item_ids: ['cw_1'],
  audio: [
    {
      field: 'front',
      voice_id: 'voice-a',
      url: '/api/audio/aaaa',
      duration_ms: 1200,
    },
  ],
  audio_pending: [],
  owner: 'shared',
  edited_by_human: false,
  source_changed: false,
  mine: null,
  state: null,
};

const PAGE = { cards: [SHARED_CARD], next_cursor: null };

const CARD_WITH_COPY: CardView = {
  ...SHARED_CARD,
  front_fr: 'le chat (mi copia)',
  back_es: 'el gato (mi copia)',
  example_fr: null,
  example_es: null,
  notes: 'nota personal',
  mine: {
    front_fr: 'le chat (mi copia)',
    back_es: 'el gato (mi copia)',
    example_fr: null,
    example_es: null,
    notes: 'nota personal',
    base_updated_at: '2026-11-06T12:00:00.000Z',
    updated_at: '2026-11-06T13:00:00.000Z',
  },
};

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

async function settledAuth(): Promise<void> {
  await waitFor(() =>
    expect(localStorage.getItem('fc-last-me')).not.toBeNull(),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('admin edita la tarjeta compartida y regenera audio', async () => {
  const { transport } = renderScreen(<AdminCards />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/cards?limit=50': PAGE,
      'PATCH /api/admin/cards/c_1': {
        ...SHARED_CARD,
        front_fr: 'le chat',
        edited_by_human: true,
      },
      'POST /api/admin/audio/aaaa/regenerate': JOB,
      'GET /api/voices': VOICES,
      'GET /api/me/prefs': PREFS,
    },
  });
  await settledAuth();

  expect(
    await screen.findByText('le chat', {}, { timeout: 3000 }),
  ).toBeVisible();

  await userEvent.click(
    await screen.findByRole('button', { name: 'Editar tarjeta compartida' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

  await waitFor(() => {
    expect(
      transport.calls.some(
        (call) =>
          call.method === 'PATCH' && call.url === '/api/admin/cards/c_1',
      ),
    ).toBe(true);
  });

  await userEvent.click(
    await screen.findByRole('button', { name: 'Regenerar audio' }),
  );
  await waitFor(() => {
    expect(
      transport.calls.some(
        (call) =>
          call.method === 'POST' &&
          call.url === '/api/admin/audio/aaaa/regenerate',
      ),
    ).toBe(true);
  });
});

test('admin con copia personal no ve editar la tarjeta compartida', async () => {
  const { transport } = renderScreen(<AdminCards />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/cards?limit=50': { cards: [CARD_WITH_COPY], next_cursor: null },
    },
  });
  await settledAuth();

  expect(
    await screen.findByText(
      'Quita tu copia personal para editar la tarjeta compartida.',
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Editar tarjeta compartida' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Borrar tarjeta compartida' }),
  ).toBeVisible();
  expect(transport.calls.some((call) => call.method === 'PATCH')).toBe(false);
});

test('admin busca por texto y filtra por publicación', async () => {
  const { transport } = renderScreen(<AdminCards />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/cards?limit=50': PAGE,
      'GET /api/cards?limit=50&q=chat': PAGE,
      'GET /api/cards?item_id=cw_1&limit=50&q=chat': PAGE,
    },
  });
  await settledAuth();

  expect(await screen.findByText('le chat')).toBeVisible();
  await userEvent.type(screen.getByLabelText('Buscar tarjetas'), 'chat');
  await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));

  await waitFor(() => {
    expect(
      transport.calls.some((call) => call.url === '/api/cards?limit=50&q=chat'),
    ).toBe(true);
  });

  await userEvent.type(screen.getByLabelText('Publicación'), 'cw_1');
  await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));

  await waitFor(() => {
    expect(
      transport.calls.some(
        (call) => call.url === '/api/cards?item_id=cw_1&limit=50&q=chat',
      ),
    ).toBe(true);
  });
});

test('admin muestra carga, vacío y error con Reintentar', async () => {
  renderScreen(<AdminCards />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/cards?limit=50': () => new Promise<Response>(() => undefined),
    },
  });
  await settledAuth();
  expect(screen.getByRole('status')).toHaveTextContent('Cargando');
  cleanup();

  renderScreen(<AdminCards />, {
    user: ME_ADMIN,
    routes: { 'GET /api/cards?limit=50': { cards: [], next_cursor: null } },
  });
  await settledAuth();
  expect(await screen.findByText('No hay tarjetas')).toBeVisible();
  cleanup();

  let fail = true;
  renderScreen(<AdminCards />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/cards?limit=50': () =>
        Promise.resolve(
          fail
            ? jsonResponse({ code: 'busy', message_es: '' }, 503)
            : jsonResponse(PAGE),
        ),
    },
  });
  await settledAuth();
  expect(
    await screen.findByText('El servidor está ocupado; inténtalo de nuevo'),
  ).toBeVisible();
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('le chat')).toBeVisible();
});
