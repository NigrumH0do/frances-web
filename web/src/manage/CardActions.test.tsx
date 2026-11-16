import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { jsonResponse } from '../api/testing';
import type {
  CardView,
  JobOut,
  UserPrefs,
  VoiceOut,
} from '../contracts/generated';
import { closeV2DbForTests } from '../offline/db';
import { ME_ADMIN, ME_USER, renderScreen } from '../shell/testing';
import { CardActions } from './CardActions';

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

const STATE = {
  card_id: 'c_1',
  fsrs: {
    due: '2026-11-07T12:00:00.000Z',
    stability: 2.5,
    difficulty: 5,
    elapsed_days: 1,
    scheduled_days: 2,
    learning_steps: 0,
    reps: 3,
    lapses: 0,
    state: 2 as const,
    last_review: '2026-11-06T12:00:00.000Z',
  },
  suspended: false,
  flagged_hard: true,
  updated_at: '2026-11-06T12:00:00.000Z',
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
  state: STATE,
};

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

const OWN_CARD: CardView = {
  ...SHARED_CARD,
  id: 'uc_1',
  owner: 'mine',
  source_item_ids: [],
  mine: null,
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

test('el usuario normal no ve acciones de admin', async () => {
  renderScreen(<CardActions card={SHARED_CARD} />, { user: ME_USER });
  await settledAuth();

  expect(
    await screen.findByRole('button', { name: 'Editar mi copia' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: /tarjeta compartida/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /Regenerar tarjetas/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Borrar tarjeta' }),
  ).not.toBeInTheDocument();
});

test('la tarjeta propia no ofrece editar mi copia ni restaurar', async () => {
  renderScreen(<CardActions card={OWN_CARD} />, { user: ME_USER });
  await settledAuth();

  expect(
    await screen.findByRole('button', { name: 'Borrar tarjeta' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Editar mi copia' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Restaurar original' }),
  ).not.toBeInTheDocument();
});

test('admin no ve acciones de compartida en una tarjeta propia', async () => {
  renderScreen(<CardActions card={OWN_CARD} />, { user: ME_ADMIN });
  await settledAuth();

  expect(
    await screen.findByRole('button', { name: 'Borrar tarjeta' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Editar tarjeta compartida' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Borrar tarjeta compartida' }),
  ).not.toBeInTheDocument();
});

test('usuario edita su copia sin enviar id ni estado FSRS', async () => {
  const onChanged = vi.fn();
  const { transport } = renderScreen(
    <CardActions card={SHARED_CARD} onChanged={onChanged} />,
    {
      user: ME_USER,
      routes: {
        'GET /api/voices': VOICES,
        'GET /api/me/prefs': PREFS,
        'PUT /api/cards/c_1/mine': CARD_WITH_COPY,
      },
    },
  );
  await settledAuth();

  await userEvent.click(
    await screen.findByRole('button', { name: 'Editar mi copia' }),
  );
  const front = await screen.findByLabelText('Francés');
  await userEvent.clear(front);
  await userEvent.type(front, 'le chat noir');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

  await waitFor(() => {
    expect(
      transport.calls.some(
        (call) => call.method === 'PUT' && call.url === '/api/cards/c_1/mine',
      ),
    ).toBe(true);
  });
  const call = transport.calls.find(
    (item) => item.method === 'PUT' && item.url === '/api/cards/c_1/mine',
  );
  expect(call?.body).toEqual({
    front_fr: 'le chat noir',
    back_es: 'el gato',
    example_fr: 'Le chat dort.',
    example_es: 'El gato duerme.',
    notes: null,
  });
  expect(call?.body).not.toHaveProperty('id');
  expect(call?.body).not.toHaveProperty('state');
  expect(onChanged).toHaveBeenCalled();
});

test('usuario restaura la copia original', async () => {
  const onChanged = vi.fn();
  const { transport } = renderScreen(
    <CardActions card={CARD_WITH_COPY} onChanged={onChanged} />,
    {
      user: ME_USER,
      routes: {
        'GET /api/voices': VOICES,
        'GET /api/me/prefs': PREFS,
        'DELETE /api/cards/c_1/mine': SHARED_CARD,
      },
    },
  );
  await settledAuth();

  await userEvent.click(
    await screen.findByRole('button', { name: 'Restaurar original' }),
  );

  await waitFor(() => {
    expect(
      transport.calls.some(
        (call) =>
          call.method === 'DELETE' && call.url === '/api/cards/c_1/mine',
      ),
    ).toBe(true);
  });
  expect(onChanged).toHaveBeenCalled();
});

test('borrar la tarjeta propia pide confirmación', async () => {
  const onChanged = vi.fn();
  const { transport } = renderScreen(
    <CardActions card={OWN_CARD} onChanged={onChanged} />,
    {
      user: ME_USER,
      routes: {
        'GET /api/voices': VOICES,
        'GET /api/me/prefs': PREFS,
        'DELETE /api/cards/uc_1': () => new Response(null, { status: 204 }),
      },
    },
  );
  await settledAuth();

  await userEvent.click(
    await screen.findByRole('button', { name: 'Borrar tarjeta' }),
  );
  expect(screen.getByText('¿Borrar esta tarjeta?')).toBeVisible();
  expect(transport.calls.some((call) => call.method === 'DELETE')).toBe(false);

  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

  await waitFor(() => {
    expect(
      transport.calls.some(
        (call) => call.method === 'DELETE' && call.url === '/api/cards/uc_1',
      ),
    ).toBe(true);
  });
  expect(onChanged).toHaveBeenCalled();
});

test('admin ve las acciones de tarjeta compartida', async () => {
  renderScreen(<CardActions card={SHARED_CARD} />, { user: ME_ADMIN });
  await settledAuth();

  expect(
    await screen.findByRole('button', { name: 'Editar tarjeta compartida' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Borrar tarjeta compartida' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', {
      name: 'Regenerar tarjetas de la publicación',
    }),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Regenerar audio' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Editar mi copia' })).toBeVisible();
});

test('admin con copia personal no puede editar la tarjeta compartida', async () => {
  const onChanged = vi.fn();
  const { transport } = renderScreen(
    <CardActions card={CARD_WITH_COPY} onChanged={onChanged} />,
    {
      user: ME_ADMIN,
      routes: {
        'GET /api/voices': VOICES,
        'GET /api/me/prefs': PREFS,
      },
    },
  );
  await settledAuth();

  expect(
    screen.queryByRole('button', { name: 'Editar tarjeta compartida' }),
  ).not.toBeInTheDocument();
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Quita tu copia personal para editar la tarjeta compartida.',
  );
  expect(
    screen.getByRole('button', { name: 'Borrar tarjeta compartida' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', {
      name: 'Regenerar tarjetas de la publicación',
    }),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Regenerar audio' })).toBeVisible();
  expect(transport.calls.some((call) => call.method === 'PATCH')).toBe(false);
  expect(onChanged).not.toHaveBeenCalled();
});

test('admin edita la tarjeta compartida sin enviar el estado FSRS', async () => {
  const onChanged = vi.fn();
  const { transport } = renderScreen(
    <CardActions card={SHARED_CARD} onChanged={onChanged} />,
    {
      user: ME_ADMIN,
      routes: {
        'GET /api/voices': VOICES,
        'GET /api/me/prefs': PREFS,
        'PATCH /api/admin/cards/c_1': {
          ...SHARED_CARD,
          front_fr: 'le chat',
          edited_by_human: true,
        },
      },
    },
  );
  await settledAuth();

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
  const call = transport.calls.find(
    (item) => item.method === 'PATCH' && item.url === '/api/admin/cards/c_1',
  );
  expect(call?.body).toEqual({
    front_fr: 'le chat',
    back_es: 'el gato',
    example_fr: 'Le chat dort.',
    example_es: 'El gato duerme.',
    notes: null,
  });
  expect(call?.body).not.toHaveProperty('id');
  expect(call?.body).not.toHaveProperty('state');
  expect(call?.body).not.toHaveProperty('mine');
  expect(onChanged).toHaveBeenCalled();
});

test('admin regenera cada audio y las tarjetas de la publicación', async () => {
  const onChanged = vi.fn();
  const card: CardView = {
    ...SHARED_CARD,
    audio: [
      ...SHARED_CARD.audio,
      {
        field: 'example',
        voice_id: 'voice-a',
        url: '/api/audio/bbbb',
        duration_ms: 900,
      },
    ],
  };
  const { transport } = renderScreen(
    <CardActions card={card} onChanged={onChanged} />,
    {
      user: ME_ADMIN,
      routes: {
        'GET /api/voices': VOICES,
        'GET /api/me/prefs': PREFS,
        'POST /api/admin/audio/aaaa/regenerate': JOB,
        'POST /api/admin/audio/bbbb/regenerate': JOB,
        'POST /api/admin/items/cw_1/regenerate': {
          ...JOB,
          kind: 'cards.regenerate_item',
        },
      },
    },
  );
  await settledAuth();

  const audioButtons = await screen.findAllByRole('button', {
    name: 'Regenerar audio',
  });
  expect(audioButtons).toHaveLength(2);
  await userEvent.click(audioButtons[0]!);
  await userEvent.click(audioButtons[1]!);
  await userEvent.click(
    screen.getByRole('button', {
      name: 'Regenerar tarjetas de la publicación',
    }),
  );

  await waitFor(() => {
    const urls = transport.calls.map((call) => call.url);
    expect(urls).toContain('/api/admin/audio/aaaa/regenerate');
    expect(urls).toContain('/api/admin/audio/bbbb/regenerate');
    expect(urls).toContain('/api/admin/items/cw_1/regenerate');
  });
  expect(onChanged).toHaveBeenCalled();
});

test('borrar la tarjeta compartida pide confirmación', async () => {
  const onChanged = vi.fn();
  const { transport } = renderScreen(
    <CardActions card={SHARED_CARD} onChanged={onChanged} />,
    {
      user: ME_ADMIN,
      routes: {
        'GET /api/voices': VOICES,
        'GET /api/me/prefs': PREFS,
        'DELETE /api/admin/cards/c_1': () =>
          new Response(null, { status: 204 }),
      },
    },
  );
  await settledAuth();

  await userEvent.click(
    await screen.findByRole('button', { name: 'Borrar tarjeta compartida' }),
  );
  expect(screen.getByText('¿Borrar esta tarjeta compartida?')).toBeVisible();
  expect(transport.calls.some((call) => call.method === 'DELETE')).toBe(false);

  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

  await waitFor(() => {
    expect(
      transport.calls.some(
        (call) =>
          call.method === 'DELETE' && call.url === '/api/admin/cards/c_1',
      ),
    ).toBe(true);
  });
  expect(onChanged).toHaveBeenCalled();
});

test('las acciones fallidas avisan y se pueden reintentar', async () => {
  let fail = true;
  const onChanged = vi.fn();
  const { transport } = renderScreen(
    <CardActions card={CARD_WITH_COPY} onChanged={onChanged} />,
    {
      user: ME_USER,
      routes: {
        'GET /api/voices': VOICES,
        'GET /api/me/prefs': PREFS,
        'DELETE /api/cards/c_1/mine': () =>
          Promise.resolve(
            fail
              ? jsonResponse({ code: 'busy', message_es: '' }, 503)
              : jsonResponse(SHARED_CARD),
          ),
      },
    },
  );
  await settledAuth();

  await userEvent.click(
    await screen.findByRole('button', { name: 'Restaurar original' }),
  );

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'El servidor está ocupado; inténtalo de nuevo',
  );
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(
    transport.calls.filter(
      (call) => call.method === 'DELETE' && call.url === '/api/cards/c_1/mine',
    ),
  ).toHaveLength(2);
});
