import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { jsonResponse } from '../../api/testing';
import type { JobOut, VoiceOut } from '../../contracts/generated';
import { closeV2DbForTests } from '../../offline/db';
import { ME_ADMIN, renderScreen } from '../../shell/testing';
import AdminAudio from './AdminAudio';

const VOICES: VoiceOut[] = [
  {
    id: 'fr-FR-DeniseNeural',
    label: 'Denise',
    accent: 'fr-FR',
    age: 'adult',
    gender: 'female',
  },
  {
    id: 'fr-FR-HenriNeural',
    label: 'Henri',
    accent: 'fr-FR',
    age: 'adult',
    gender: 'male',
  },
];

const AUDIO_JOB: JobOut = {
  id: 12,
  kind: 'audio.regenerate',
  state: 'failed',
  attempts: 5,
  max_attempts: 5,
  run_after: '2026-11-06T10:17:00.000Z',
  last_error: 'Leçon 3 — fallo sintético',
  created_at: '2026-11-06T10:17:00.000Z',
  updated_at: '2026-11-06T10:20:00.000Z',
  finished_at: '2026-11-06T10:20:00.000Z',
};

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('audio muestra carga mientras llegan las voces y la cola', () => {
  renderScreen(<AdminAudio />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/voices': () => new Promise<Response>(() => undefined),
      'GET /api/admin/audio/queue': () =>
        new Promise<Response>(() => undefined),
    },
  });

  expect(screen.getAllByText('Cargando…').length).toBeGreaterThan(0);
});

test('audio guarda las voces por defecto', async () => {
  const { transport } = renderScreen(<AdminAudio />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/voices': VOICES,
      'GET /api/admin/audio/queue': [],
      'PUT /api/admin/voices/default': VOICES.slice(0, 2),
    },
  });

  await userEvent.click(await screen.findByRole('switch', { name: 'Denise' }));
  await userEvent.click(screen.getByRole('button', { name: 'Guardar voces' }));

  await vi.waitFor(() => {
    const puts = transport.calls.filter((call) => call.method === 'PUT');
    expect(puts.at(-1)?.body).toEqual({
      voice_ids: ['fr-FR-DeniseNeural'],
    });
  });
});

test('audio no deja guardar sin ninguna voz seleccionada', async () => {
  const { transport } = renderScreen(<AdminAudio />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/voices': VOICES,
      'GET /api/admin/audio/queue': [],
    },
  });

  expect(await screen.findByRole('switch', { name: 'Denise' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Guardar voces' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Elige al menos una voz',
  );
  expect(transport.calls.some((call) => call.method === 'PUT')).toBe(false);
});

test('audio muestra la cola de trabajos y el vacío', async () => {
  renderScreen(<AdminAudio />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/voices': VOICES,
      'GET /api/admin/audio/queue': [AUDIO_JOB],
    },
  });

  expect(await screen.findByText('Regenerar audio')).toBeVisible();
  expect(screen.getByText('Trabajo 12 · intento 5 de 5')).toHaveClass('nums');
  expect(screen.getByText('Fallido')).toBeVisible();
  expect(screen.queryByText(/Leçon/)).not.toBeInTheDocument();
  cleanup();

  renderScreen(<AdminAudio />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/voices': VOICES,
      'GET /api/admin/audio/queue': [],
    },
  });

  expect(await screen.findByText('No hay trabajos de audio')).toBeVisible();
});

test('audio muestra error y Reintentar recarga', async () => {
  let fail = true;
  renderScreen(<AdminAudio />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/voices': VOICES,
      'GET /api/admin/audio/queue': () =>
        Promise.resolve(
          fail
            ? jsonResponse({ code: 'busy', message_es: '' }, 503)
            : jsonResponse([]),
        ),
    },
  });

  expect(
    await screen.findByText('El servidor está ocupado; inténtalo de nuevo'),
  ).toBeVisible();
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

  expect(await screen.findByText('No hay trabajos de audio')).toBeVisible();
});
