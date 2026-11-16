import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { ReviewIn } from '../contracts/generated';
import { createApiClient } from '../api/client';
import { endpoints } from '../api/endpoints';
import { fakeTransport, jsonResponse, offline } from '../api/testing';
import { closeV2DbForTests } from './db';
import { enqueue, flush, pendingCount, type OutboxOp } from './outbox';

const T1 = '2026-11-06T10:00:00.000Z';
const T2 = '2026-11-06T10:05:00.000Z';

function reviewOp(
  cardId: string,
  reviewedAt: string,
  rating: 1 | 2 | 3 | 4 = 3,
): OutboxOp {
  return {
    kind: 'review',
    body: {
      card_id: cardId,
      rating,
      reviewed_at: reviewedAt,
      next: {
        due: reviewedAt,
        stability: 1,
        difficulty: 5,
        elapsed_days: 0,
        scheduled_days: 1,
        learning_steps: 0,
        reps: 1,
        lapses: 0,
        state: 2,
        last_review: reviewedAt,
      },
    } as ReviewIn,
  };
}

function flagsOp(cardId: string): OutboxOp {
  return { kind: 'flags', cardId, body: { suspended: true } };
}

function apiFor(t: ReturnType<typeof fakeTransport>) {
  return endpoints(
    createApiClient({ transport: t, onUnauthenticated: vi.fn() }),
  );
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
});

test('flush sends in order and exactly once', async () => {
  await enqueue('u1', reviewOp('c1', T1));
  await enqueue('u1', reviewOp('c2', T2));
  await enqueue('u1', flagsOp('c1'));
  const t = fakeTransport({
    'POST /api/reviews': { card_id: 'x' },
    'PATCH /api/cards/c1/flags': { card_id: 'c1' },
  });
  const api = apiFor(t);
  const [a, b] = await Promise.all([flush(api, 'u1'), flush(api, 'u1')]);
  expect(a.sent + b.sent).toBe(3);
  expect(t.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
    'POST /api/reviews',
    'POST /api/reviews',
    'PATCH /api/cards/c1/flags',
  ]);
  expect((t.calls[0]!.body as ReviewIn).card_id).toBe('c1');
  expect(await pendingCount('u1')).toBe(0);
});

test('sin red se detiene y conserva; 409 se descarta y cuenta', async () => {
  await enqueue('u1', reviewOp('c1', T1));

  const withoutNetwork = fakeTransport({ 'POST /api/reviews': offline() });
  const stopped = await flush(apiFor(withoutNetwork), 'u1');
  expect(stopped).toEqual({
    sent: 0,
    dropped: 0,
    conflicts: 0,
    stoppedBy: 'offline',
  });
  expect(await pendingCount('u1')).toBe(1);

  const conflict = fakeTransport({
    'POST /api/reviews': () =>
      jsonResponse({ code: 'conflict', message_es: 'reseña repetida' }, 409),
  });
  const result = await flush(apiFor(conflict), 'u1');
  expect(result).toEqual({
    sent: 0,
    dropped: 0,
    conflicts: 1,
    stoppedBy: null,
  });
  expect(await pendingCount('u1')).toBe(0);
});

test('flush ignora las operaciones de otro usuario', async () => {
  await enqueue('u1', reviewOp('c1', T1));
  await enqueue('u2', reviewOp('c2', T2));

  const t = fakeTransport({ 'POST /api/reviews': { card_id: 'x' } });
  const result = await flush(apiFor(t), 'u1');

  expect(result.sent).toBe(1);
  expect(t.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
    'POST /api/reviews',
  ]);
  expect((t.calls[0]!.body as ReviewIn).card_id).toBe('c1');
  expect(await pendingCount('u1')).toBe(0);
  expect(await pendingCount('u2')).toBe(1);
});

test('enqueue no duplica una reseña con el mismo reviewed_at', async () => {
  await enqueue('u1', reviewOp('c1', T1));
  await enqueue('u1', reviewOp('c1', T1, 4));
  expect(await pendingCount('u1')).toBe(1);

  await enqueue('u1', reviewOp('c1', T2));
  expect(await pendingCount('u1')).toBe(2);
});

test('400 y 404 se descartan y se cuentan como dropped', async () => {
  await enqueue('u1', reviewOp('c1', T1));
  const badRequest = fakeTransport({
    'POST /api/reviews': () =>
      jsonResponse({ code: 'bad_request', message_es: 'inválida' }, 400),
  });
  const first = await flush(apiFor(badRequest), 'u1');
  expect(first.dropped).toBe(1);
  expect(first.stoppedBy).toBeNull();

  await enqueue('u1', reviewOp('c2', T2));
  const notFound = fakeTransport({
    'POST /api/reviews': () =>
      jsonResponse({ code: 'not_found', message_es: 'no está' }, 404),
  });
  const second = await flush(apiFor(notFound), 'u1');
  expect(second.dropped).toBe(1);
  expect(await pendingCount('u1')).toBe(0);
});

test('401 se detiene sin borrar y lo marca unauthenticated', async () => {
  await enqueue('u1', reviewOp('c1', T1));
  const t = fakeTransport({
    'POST /api/reviews': () =>
      jsonResponse({ code: 'unauthenticated', message_es: 'entra' }, 401),
  });
  const result = await flush(apiFor(t), 'u1');
  expect(result.stoppedBy).toBe('unauthenticated');
  expect(result.sent).toBe(0);
  expect(await pendingCount('u1')).toBe(1);
});

test('un 5xx para sin borrar la operación', async () => {
  await enqueue('u1', reviewOp('c1', T1));
  const t = fakeTransport({
    'POST /api/reviews': () =>
      jsonResponse({ code: 'busy', message_es: 'ocupado' }, 503),
  });
  const result = await flush(apiFor(t), 'u1');
  expect(result.stoppedBy).toBeNull();
  expect(result.sent).toBe(0);
  expect(await pendingCount('u1')).toBe(1);
});
