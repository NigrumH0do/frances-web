import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  CardView,
  Health,
  UserPrefs,
  UserStats,
  VoiceOut,
} from '../../contracts/generated';
import { jsonResponse } from '../../api/testing';
import { closeV2DbForTests } from '../../offline/db';
import { renderScreen } from '../../shell/testing';
import Mas from './Mas';

const STATS: UserStats = {
  cards_learned: 412,
  due_now: 18,
  reviews_today: 24,
  retention_30d: 0.91,
  streak_days: 6,
  week: [
    { day: '2026-11-02', reviews: 3, quiz_attempts: 0 },
    { day: '2026-11-03', reviews: 4, quiz_attempts: 1 },
    { day: '2026-11-04', reviews: 5, quiz_attempts: 0 },
    { day: '2026-11-05', reviews: 2, quiz_attempts: 0 },
    { day: '2026-11-06', reviews: 6, quiz_attempts: 0 },
    { day: '2026-11-07', reviews: 0, quiz_attempts: 0 },
    { day: '2026-11-08', reviews: 0, quiz_attempts: 0 },
  ],
  quiz_best: [
    {
      quiz_id: 'qz_1',
      title_es: 'Le passé composé',
      best_score: 0.9,
      attempts: 2,
      last_at: '2026-11-05T15:00:00.000Z',
    },
  ],
};

const PREFS: UserPrefs = {
  preferred_voice_ids: [],
  daily_new_cards: 10,
  theme: 'system',
};

const HEALTH: Health = {
  status: 'ok',
  version: '2.0.0',
  schema_version: 4,
  db_ok: true,
  worker_seen_at: null,
};

const VOICES: VoiceOut[] = [
  {
    id: 'voice-a',
    label: 'Denise',
    accent: 'fr-FR',
    age: 'adult',
    gender: 'female',
  },
  {
    id: 'voice-b',
    label: 'Henri',
    accent: 'fr-FR',
    age: 'adult',
    gender: 'male',
  },
];

const CARD: CardView = {
  id: 'card-1',
  kind: 'phrase',
  front_fr: 'Bonjour',
  back_es: 'Hola',
  example_fr: null,
  example_es: null,
  notes: null,
  ipa: null,
  phonemes: [],
  tags: [],
  stale: false,
  source_item_ids: ['item-1'],
  audio: [
    {
      field: 'front',
      voice_id: 'voice-a',
      url: '/api/audio/k1',
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

function routes(overrides: Record<string, unknown> = {}) {
  return {
    'GET /api/me/stats': STATS,
    'GET /api/me/prefs': PREFS,
    'PUT /api/me/prefs': (request: { body: unknown }) =>
      jsonResponse(request.body),
    'GET /api/voices': VOICES,
    'GET /api/health': HEALTH,
    'GET /api/review/queue?limit=20': [],
    ...overrides,
  };
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
  document.documentElement.className = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.className = '';
});

test('muestra la cabecera con nombre, email, rol de admin y versión', async () => {
  renderScreen(<Mas />, {
    user: {
      display_name: 'Marta Ibáñez',
      email: 'marta@example.test',
      role: 'admin',
    },
    routes: routes(),
  });

  expect(await screen.findByRole('heading', { name: 'Más' })).toBeVisible();
  expect(await screen.findByText('Marta Ibáñez')).toBeVisible();
  expect(screen.getByText('marta@example.test')).toBeVisible();
  expect(screen.getByText('Admin')).toBeVisible();
  expect(await screen.findByText('Versión 2.0.0')).toBeVisible();
});

test('tema oscuro se aplica al instante y se guarda en el servidor', async () => {
  const { transport } = renderScreen(<Mas />, { routes: routes() });

  await userEvent.click(await screen.findByRole('radio', { name: 'Oscuro' }));

  expect(document.documentElement).toHaveClass('theme-dark');
  await waitFor(() => {
    const put = transport.calls.find((call) => call.method === 'PUT');
    expect(put?.body).toMatchObject({
      theme: 'dark',
      daily_new_cards: 10,
    });
  });
});

test('retención nula se explica en texto y muestra las notas de quiz', async () => {
  renderScreen(<Mas />, {
    routes: routes({
      'GET /api/me/stats': { ...STATS, retention_30d: null },
    }),
  });

  expect(await screen.findByText('—')).toBeVisible();
  expect(screen.getByText('hacen falta 10 repasos')).toBeVisible();
  expect(screen.getByText('412')).toBeVisible();
  expect(screen.getByText('tarjetas aprendidas')).toBeVisible();
  expect(screen.getByText('6')).toBeVisible();
  expect(screen.getByText('días de racha')).toBeVisible();
  expect(screen.getByText('Le passé composé')).toBeVisible();
  expect(screen.getByText('9/10')).toBeVisible();
});

test('elegir y ordenar voces preferidas', async () => {
  const { transport } = renderScreen(<Mas />, {
    routes: routes({ 'GET /api/review/queue?limit=20': [CARD] }),
  });

  expect(await screen.findByText('Muestra de audio')).toBeVisible();
  await userEvent.click(
    await screen.findByRole('checkbox', { name: 'Preferida: Denise' }),
  );
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Preferida: Henri' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Subir Henri' }));
  await userEvent.click(screen.getByRole('button', { name: 'Guardar voces' }));

  await waitFor(() => {
    const puts = transport.calls.filter((call) => call.method === 'PUT');
    expect(puts.at(-1)?.body).toMatchObject({
      preferred_voice_ids: ['voice-b', 'voice-a'],
    });
  });
});

test('muestra carga, vacío y error con reintentar', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  let fail = false;

  renderScreen(<Mas />, {
    routes: routes({
      'GET /api/me/stats': async () => {
        if (first) {
          first = false;
          await gate;
        }
        if (fail) {
          return jsonResponse({ code: 'internal', message_es: 'fallo' }, 500);
        }
        return jsonResponse(STATS);
      },
      'GET /api/voices': [],
    }),
  });

  expect(screen.getAllByText('Cargando…').length).toBeGreaterThan(0);

  fail = true;
  await act(async () => {
    release();
  });

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Algo salió mal en el servidor',
  );

  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

  expect(await screen.findByText('412')).toBeVisible();
  expect(
    await screen.findByText('Todavía no hay voces disponibles'),
  ).toBeVisible();
});
