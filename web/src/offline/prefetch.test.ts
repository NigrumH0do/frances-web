import { createApiClient } from '../api/client';
import { endpoints } from '../api/endpoints';
import { fakeTransport } from '../api/testing';
import { prefetchForOffline } from './prefetch';

const card = {
  id: 'c1',
  audio: [
    {
      field: 'front',
      voice_id: 'v1',
      url: '/api/audio/a1',
      duration_ms: 1200,
    },
    {
      field: 'example',
      voice_id: 'v1',
      url: '/api/audio/a2',
      duration_ms: 900,
    },
  ],
};

function apiFor(t: ReturnType<typeof fakeTransport>) {
  const client = createApiClient({ transport: t, onUnauthenticated: vi.fn() });
  return { ...endpoints(client), client };
}

function routes() {
  return {
    'GET /api/plan/today': { day: '2026-11-06', entries: [] },
    'GET /api/review/queue?limit=50': [card],
    'GET /api/me/prefs': {},
    'GET /api/me/stats': {},
    'GET /api/voices': [],
    'GET /api/study/status': {},
    'GET /api/audio/a1': () => new Response('a1', { status: 200 }),
    'GET /api/audio/a2': () => new Response('a2', { status: 200 }),
  };
}

test('prefetch pide lo de hoy y, con audio, los clips de la cola', async () => {
  const t = fakeTransport(routes());
  await prefetchForOffline(apiFor(t), { audio: true });

  const calls = t.calls.map((c) => `${c.method} ${c.url}`);
  expect(calls).toEqual(
    expect.arrayContaining([
      'GET /api/plan/today',
      'GET /api/review/queue?limit=50',
      'GET /api/me/prefs',
      'GET /api/me/stats',
      'GET /api/voices',
      'GET /api/study/status',
      'GET /api/audio/a1',
      'GET /api/audio/a2',
    ]),
  );
  expect(t.calls.filter((c) => c.url.startsWith('/api/audio/'))).toHaveLength(
    2,
  );
});

test('prefetch sin audio no descarga clips', async () => {
  const t = fakeTransport(routes());
  await prefetchForOffline(apiFor(t), { audio: false });

  expect(t.calls.some((c) => c.url.startsWith('/api/audio/'))).toBe(false);
  expect(t.calls).toHaveLength(6);
});
