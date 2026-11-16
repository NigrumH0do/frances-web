import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  CardView,
  FsrsCard,
  StudyPlanDay,
  UserCardStateOut,
} from '../../contracts/generated';
import { closeV2DbForTests } from '../../offline/db';
import { ME_ADMIN, ME_USER, renderScreen } from '../../shell/testing';
import Repasar from './Repasar';

const FSRS: FsrsCard = {
  due: '2026-11-05T10:00:00.000000Z',
  stability: 3.1,
  difficulty: 5.2,
  elapsed_days: 0,
  scheduled_days: 3,
  learning_steps: 0,
  reps: 1,
  lapses: 0,
  state: 2,
  last_review: '2026-11-01T10:00:00.000000Z',
};

function state(
  cardId: string,
  overrides: Partial<UserCardStateOut> = {},
): UserCardStateOut {
  return {
    card_id: cardId,
    fsrs: FSRS,
    suspended: false,
    flagged_hard: false,
    updated_at: '2026-11-01T10:00:00.000000Z',
    ...overrides,
  };
}

function card(id: string, overrides: Partial<CardView> = {}): CardView {
  return {
    id,
    kind: 'vocab',
    front_fr: `fr-${id}`,
    back_es: `es-${id}`,
    example_fr: null,
    example_es: null,
    notes: null,
    ipa: null,
    phonemes: [],
    tags: [],
    stale: false,
    source_item_ids: [`i-${id}`],
    audio: [],
    audio_pending: [],
    owner: 'shared',
    edited_by_human: false,
    source_changed: false,
    mine: null,
    state: state(id),
    ...overrides,
  };
}

const CARD_A = card('a', { front_fr: 'bonjour', back_es: 'hola' });
const CARD_B = card('b', { front_fr: 'merci', back_es: 'gracias' });

const CARD_WITH_AUDIO: CardView = {
  ...CARD_A,
  audio: [
    {
      field: 'front',
      voice_id: 'voice-a',
      url: '/api/audio/a',
      duration_ms: 1000,
    },
  ],
};

const PLAN_WITHOUT_REVIEW: StudyPlanDay = {
  day: '2026-11-06',
  entries: [],
  generated_at: '2026-11-06T05:45:00.000000Z',
};

function baseRoutes(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    'GET /api/review/queue': [CARD_A, CARD_B],
    'GET /api/plan/today': PLAN_WITHOUT_REVIEW,
    ...overrides,
  };
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('Repasar no ofrece acciones de admin', async () => {
  renderScreen(<Repasar />, {
    user: ME_ADMIN,
    routes: baseRoutes({
      'GET /api/review/queue': [CARD_WITH_AUDIO, CARD_B],
    }),
  });

  expect(await screen.findByText('bonjour')).toBeVisible();
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
    screen.queryByRole('button', { name: /Regenerar audio/ }),
  ).not.toBeInTheDocument();
});

test('un usuario normal no ve ninguna acción de admin en Repasar', async () => {
  renderScreen(<Repasar />, { user: ME_USER, routes: baseRoutes() });

  expect(await screen.findByText('bonjour')).toBeVisible();
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
    screen.queryByRole('button', { name: /Regenerar audio/ }),
  ).not.toBeInTheDocument();
});

test('editar mi copia conserva la tarjeta y no reinicia la sesión', async () => {
  const editedB: CardView = {
    ...CARD_B,
    front_fr: 'merci beaucoup',
    back_es: 'muchas gracias',
    mine: {
      front_fr: 'merci beaucoup',
      back_es: 'muchas gracias',
      example_fr: null,
      example_es: null,
      notes: null,
      base_updated_at: '2026-11-06T12:00:00.000Z',
      updated_at: '2026-11-07T12:00:00.000Z',
    },
  };
  const { transport } = renderScreen(<Repasar />, {
    user: ME_USER,
    routes: baseRoutes({
      'POST /api/reviews': state('a'),
      'PUT /api/cards/b/mine': editedB,
      'GET /api/cards/b': editedB,
    }),
  });

  expect(await screen.findByText('bonjour')).toBeVisible();

  // Avanza la sesión para que la tarjeta actual sea la segunda.
  await userEvent.click(
    screen.getByRole('button', { name: 'Mostrar respuesta' }),
  );
  await userEvent.click(screen.getByRole('button', { name: /^Bien/ }));
  expect(await screen.findByText('merci')).toBeVisible();
  expect(screen.getByText('2/2')).toBeVisible();

  await userEvent.click(
    screen.getByRole('button', { name: 'Editar mi copia' }),
  );
  const front = await screen.findByLabelText('Francés');
  await userEvent.clear(front);
  await userEvent.type(front, 'merci beaucoup');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

  // La vista se refresca con la copia guardada y la sesión sigue en 2/2.
  expect(await screen.findByText('merci beaucoup')).toBeVisible();
  expect(screen.getByText('2/2')).toBeVisible();
  expect(screen.queryByText('bonjour')).not.toBeInTheDocument();
  expect(
    transport.calls.filter(
      (call) => call.method === 'GET' && call.url === '/api/review/queue',
    ),
  ).toHaveLength(1);
  expect(
    transport.calls.some(
      (call) => call.method === 'GET' && call.url === '/api/cards/b',
    ),
  ).toBe(true);
});
