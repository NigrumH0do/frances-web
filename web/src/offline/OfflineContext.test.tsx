import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ReviewIn } from '../contracts/generated';
import { ApiProvider } from '../api/ApiContext';
import { createApiClient } from '../api/client';
import { fakeTransport, jsonResponse } from '../api/testing';
import { closeV2DbForTests } from './db';
import type { OutboxOp } from './outbox';
import { OfflineProvider, useOffline } from './OfflineContext';

const reviewOp = (cardId: string): OutboxOp => ({
  kind: 'review',
  body: {
    card_id: cardId,
    rating: 3,
    reviewed_at: '2026-11-06T10:00:00.000Z',
    next: {
      due: '2026-11-06T10:00:00.000Z',
      stability: 1,
      difficulty: 5,
      elapsed_days: 0,
      scheduled_days: 1,
      learning_steps: 0,
      reps: 1,
      lapses: 0,
      state: 2,
      last_review: '2026-11-06T10:00:00.000Z',
    },
  } as ReviewIn,
});

type Offline = ReturnType<typeof useOffline>;
let offline: Offline;

function Probe() {
  offline = useOffline();
  return <output data-testid="pending">{offline.pending}</output>;
}

function setup(routes: Record<string, unknown>, userId = 'u1') {
  const transport = fakeTransport(routes);
  const client = createApiClient({
    transport,
    onUnauthenticated: vi.fn(),
  });
  render(
    <ApiProvider client={client}>
      <OfflineProvider userId={userId}>
        <Probe />
      </OfflineProvider>
    </ApiProvider>,
  );
  return transport;
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('OfflineProvider envía al montar y tras encolar con red', async () => {
  const t = setup({
    'POST /api/reviews': () => jsonResponse({ card_id: 'c1' }),
  });
  await waitFor(() => expect(offline.pending).toBe(0));

  await act(async () => {
    await offline.enqueue(reviewOp('c1'));
  });

  expect(t.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
    'POST /api/reviews',
  ]);
  expect(offline.lastFlush).toMatchObject({ sent: 1, stoppedBy: null });
  expect(offline.pending).toBe(0);
});

test('OfflineProvider encola sin red y envía al volver la conexión', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const t = setup({
    'POST /api/reviews': () => jsonResponse({ card_id: 'c1' }),
  });
  await waitFor(() => expect(offline.pending).toBe(0));

  await act(async () => {
    await offline.enqueue(reviewOp('c1'));
  });
  expect(t.calls).toHaveLength(0);
  expect(offline.pending).toBe(1);

  online.mockReturnValue(true);
  await act(async () => {
    window.dispatchEvent(new Event('online'));
  });

  await waitFor(() => expect(offline.pending).toBe(0));
  expect(t.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
    'POST /api/reviews',
  ]);
});
