import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { HttpError } from '../api/client';
import type { CardView, UserPrefs, VoiceOut } from '../contracts/generated';
import { closeV2DbForTests } from '../offline/db';
import { ME_USER, renderScreen } from '../shell/testing';
import { CardEditor, type CardEditorValues } from './CardEditor';
import { NewCardDialog } from './NewCardDialog';

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
      url: '/api/audio/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      duration_ms: 1200,
    },
  ],
  audio_pending: [],
  owner: 'shared',
  edited_by_human: false,
  source_changed: false,
  mine: null,
  state: {
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
      state: 2,
      last_review: '2026-11-06T12:00:00.000Z',
    },
    suspended: false,
    flagged_hard: true,
    updated_at: '2026-11-06T12:00:00.000Z',
  },
};

const CARD_WITH_COPY: CardView = {
  ...SHARED_CARD,
  front_fr: 'ma copie',
  back_es: 'mi copia',
  example_fr: 'Mon exemple.',
  example_es: 'Mi ejemplo.',
  notes: 'nota personal',
  mine: {
    front_fr: 'ma copie',
    back_es: 'mi copia',
    example_fr: 'Mon exemple.',
    example_es: 'Mi ejemplo.',
    notes: 'nota personal',
    base_updated_at: '2026-11-06T12:00:00.000Z',
    updated_at: '2026-11-06T13:00:00.000Z',
  },
};

const CREATED_CARD: CardView = {
  ...SHARED_CARD,
  id: 'uc_1',
  kind: 'vocab',
  front_fr: 'le chien',
  back_es: 'el perro',
  example_fr: null,
  example_es: null,
  source_item_ids: [],
  audio: [],
  state: null,
  owner: 'mine',
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

test('el editor guarda solo los campos editables y no toca id ni estado FSRS', async () => {
  const onSave = vi.fn<(values: CardEditorValues) => Promise<void>>(() =>
    Promise.resolve(),
  );
  render(
    <CardEditor
      mode="override"
      card={SHARED_CARD}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

  expect(onSave).toHaveBeenCalledTimes(1);
  const values = onSave.mock.calls[0]?.[0];
  expect(values).toEqual({
    kind: 'phrase',
    front_fr: 'le chat',
    back_es: 'el gato',
    example_fr: 'Le chat dort.',
    example_es: 'El gato duerme.',
    notes: '',
  });
  expect(values).not.toHaveProperty('id');
  expect(values).not.toHaveProperty('state');
  expect(values).not.toHaveProperty('owner');
  expect(values).not.toHaveProperty('mine');
  expect(localStorage.length).toBe(0);
});

test('el editor precarga la copia en override y la base cuando no hay copia', () => {
  render(
    <CardEditor
      mode="override"
      card={CARD_WITH_COPY}
      onSave={async () => undefined}
      onCancel={() => undefined}
    />,
  );
  expect(screen.getByLabelText('Francés')).toHaveValue('ma copie');
  cleanup();

  render(
    <CardEditor
      mode="admin"
      card={SHARED_CARD}
      onSave={async () => undefined}
      onCancel={() => undefined}
    />,
  );
  expect(screen.getByLabelText('Francés')).toHaveValue('le chat');
});

test('el editor valida campos obligatorios y largos antes de guardar', async () => {
  const onSave = vi.fn<(values: CardEditorValues) => Promise<void>>(() =>
    Promise.resolve(),
  );
  render(<CardEditor mode="override" onSave={onSave} onCancel={vi.fn()} />);

  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByText('Escribe el francés.')).toBeVisible();
  expect(screen.getByText('Escribe el español.')).toBeVisible();

  fireEvent.change(screen.getByLabelText('Francés'), {
    target: { value: 'a'.repeat(501) },
  });
  fireEvent.change(screen.getByLabelText('Español'), {
    target: { value: 'b'.repeat(501) },
  });
  fireEvent.change(screen.getByLabelText('Ejemplo en francés'), {
    target: { value: 'c'.repeat(2001) },
  });
  fireEvent.change(screen.getByLabelText('Notas'), {
    target: { value: 'd'.repeat(2001) },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

  expect(onSave).not.toHaveBeenCalled();
  expect(
    screen.getByText('El francés no puede pasar de 500 caracteres.'),
  ).toBeVisible();
  expect(
    screen.getByText('El español no puede pasar de 500 caracteres.'),
  ).toBeVisible();
  expect(
    screen.getByText(
      'El ejemplo en francés no puede pasar de 2000 caracteres.',
    ),
  ).toBeVisible();
  expect(
    screen.getByText('Las notas no pueden pasar de 2000 caracteres.'),
  ).toBeVisible();
});

test('el editor muestra el message_es del servidor', async () => {
  const onSave = vi.fn<(values: CardEditorValues) => Promise<void>>(() =>
    Promise.reject(
      new HttpError(409, 'conflict', 'La tarjeta cambió mientras la editabas.'),
    ),
  );
  render(
    <CardEditor
      mode="admin"
      card={SHARED_CARD}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'La tarjeta cambió mientras la editabas.',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
});

test('el editor de tarjeta propia elige el tipo y crea la tarjeta', async () => {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  const { transport } = renderScreen(
    <NewCardDialog open onClose={onClose} onCreated={onCreated} />,
    {
      user: ME_USER,
      routes: {
        'GET /api/voices': VOICES,
        'GET /api/me/prefs': PREFS,
        'POST /api/cards': CREATED_CARD,
      },
    },
  );
  await settledAuth();

  await userEvent.type(await screen.findByLabelText('Francés'), 'le chien');
  await userEvent.type(screen.getByLabelText('Español'), 'el perro');
  await userEvent.click(screen.getByRole('radio', { name: 'Frase' }));
  await userEvent.click(screen.getByRole('button', { name: 'Crear tarjeta' }));

  await waitFor(() => {
    expect(
      transport.calls.some(
        (call) => call.method === 'POST' && call.url === '/api/cards',
      ),
    ).toBe(true);
  });
  const call = transport.calls.find((item) => item.url === '/api/cards');
  expect(call?.body).toEqual({
    kind: 'phrase',
    front_fr: 'le chien',
    back_es: 'el perro',
    example_fr: null,
    example_es: null,
    notes: null,
  });
  expect(onCreated).toHaveBeenCalledWith(CREATED_CARD);
  expect(onClose).toHaveBeenCalled();
});
