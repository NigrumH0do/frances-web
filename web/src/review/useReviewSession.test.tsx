import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, renderHook, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import type {
  CardView,
  FsrsCard,
  ReviewIn,
  UserCardStateOut,
} from '../contracts/generated';
import { ApiProvider } from '../api/ApiContext';
import { createApiClient } from '../api/client';
import { fakeTransport, jsonResponse, offline } from '../api/testing';
import { closeV2DbForTests } from '../offline/db';
import { OfflineProvider } from '../offline/OfflineContext';
import { pendingCount } from '../offline/outbox';
import { useReviewSession } from './useReviewSession';

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

function state(cardId: string, fsrs: FsrsCard = FSRS): UserCardStateOut {
  return {
    card_id: cardId,
    fsrs,
    suspended: false,
    flagged_hard: false,
    updated_at: '2026-11-01T10:00:00.000000Z',
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

const CARD_A = card('a');
const CARD_B = card('b');

function setup(routes: Record<string, unknown>) {
  const transport = fakeTransport(routes);
  const client = createApiClient({
    transport,
    onUnauthenticated: vi.fn(),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiProvider client={client}>
      <OfflineProvider userId="u1">{children}</OfflineProvider>
    </ApiProvider>
  );
  return {
    transport,
    ...renderHook(() => useReviewSession(), { wrapper }),
  };
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('sin red la reseña va a la cola y la sesión avanza', async () => {
  const { result, transport } = setup({
    'GET /api/review/queue': [CARD_A, CARD_B],
    'POST /api/reviews': offline(),
  });
  await waitFor(() => expect(result.current.state.queue).toHaveLength(2));

  await act(async () => {
    await result.current.grade(3);
  });

  expect(result.current.state.index).toBe(1);
  expect(result.current.state.done).toBe(1);
  expect(result.current.announcement).toBe('Guardado sin conexión');
  expect(await pendingCount('u1')).toBe(1);

  const body = transport.calls.find((c) => c.url === '/api/reviews')!
    .body as ReviewIn;
  expect(body.card_id).toBe('a');
  expect(body.rating).toBe(3);
  expect(body.next.stability).toBeGreaterThan(0);
  expect(body.next.difficulty).toBeGreaterThanOrEqual(1);
  expect(new Date(body.next.due).getTime()).toBeGreaterThanOrEqual(
    new Date(body.reviewed_at).getTime(),
  );
  expect(body.next.last_review).toBe(body.reviewed_at);
});

test('con red la reseña se envía al servidor y avisa Guardado', async () => {
  const { result, transport } = setup({
    'GET /api/review/queue': [CARD_A, CARD_B],
    'POST /api/reviews': state('a'),
  });
  await waitFor(() => expect(result.current.state.queue).toHaveLength(2));

  await act(async () => {
    await result.current.grade(3);
  });

  expect(result.current.state.index).toBe(1);
  expect(result.current.announcement).toBe('Guardado');
  expect(transport.calls.map((c) => `${c.method} ${c.url}`)).toContain(
    'POST /api/reviews',
  );
});

test('409 recarga la tarjeta y avanza sin encolar', async () => {
  const refreshed = card('a', { back_es: 'es-a (recargada)' });
  const { result, transport } = setup({
    'GET /api/review/queue': [CARD_A, CARD_B],
    'POST /api/reviews': () =>
      jsonResponse({ code: 'conflict', message_es: 'Reseña repetida' }, 409),
    'GET /api/cards/a': refreshed,
  });
  await waitFor(() => expect(result.current.state.queue).toHaveLength(2));

  await act(async () => {
    await result.current.grade(3);
  });

  expect(result.current.state.index).toBe(1);
  expect(result.current.state.queue[0].back_es).toBe('es-a (recargada)');
  expect(
    transport.calls.some((c) => c.method === 'GET' && c.url === '/api/cards/a'),
  ).toBe(true);
  expect(await pendingCount('u1')).toBe(0);
});

test('suspender quita la tarjeta y envía PATCH flags', async () => {
  const { result, transport } = setup({
    'GET /api/review/queue': [CARD_A, CARD_B],
    'PATCH /api/cards/a/flags': state('a'),
  });
  await waitFor(() => expect(result.current.state.queue).toHaveLength(2));

  await act(async () => {
    await result.current.suspend();
  });

  expect(result.current.state.queue.map((c) => c.id)).toEqual(['b']);
  expect(result.current.state.index).toBe(0);
  const call = transport.calls.find(
    (c) => c.method === 'PATCH' && c.url === '/api/cards/a/flags',
  )!;
  expect(call.body).toEqual({ suspended: true });
});

test('marcar difícil sin red encola PATCH flags y conserva la tarjeta', async () => {
  const { result } = setup({
    'GET /api/review/queue': [CARD_A, CARD_B],
    'PATCH /api/cards/a/flags': offline(),
  });
  await waitFor(() => expect(result.current.state.queue).toHaveLength(2));

  await act(async () => {
    await result.current.markHard();
  });

  expect(result.current.state.queue.map((c) => c.id)).toEqual(['a', 'b']);
  expect(result.current.announcement).toBe('Guardado sin conexión');
  expect(await pendingCount('u1')).toBe(1);
});
