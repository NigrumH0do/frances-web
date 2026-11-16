import type {
  DefaultVoicesIn,
  StudyTopic,
  TopicItemsIn,
  TopicSplitIn,
  TopicUpdateIn,
  TopicsMergeIn,
  VoiceOut,
} from '../contracts/generated';
import { createApiClient } from './client';
import { endpoints } from './endpoints';
import { fakeTransport, jsonResponse } from './testing';

// Transporte que acepta cualquier ruta: estos tests solo miran lo que se
// llama, no el cuerpo de la respuesta.
function makeEndpoints() {
  const routes = new Proxy({} as Record<string, unknown>, {
    has: () => true,
    get: () => null,
  });
  const transport = fakeTransport(routes);
  const api = endpoints(
    createApiClient({ transport, onUnauthenticated: vi.fn() }),
  );
  return { transport, api };
}

test('endpoints arman rutas y query exactas', async () => {
  const t = fakeTransport({
    'GET /api/quizzes?scope_id=tp_1&scope_kind=topic': [],
  });
  await endpoints(
    createApiClient({ transport: t, onUnauthenticated: vi.fn() }),
  ).quizzes('topic', 'tp_1');
  expect(t.calls[0]!.url).toBe('/api/quizzes?scope_id=tp_1&scope_kind=topic');
});

test('ids de ruta se codifican con encodeURIComponent', async () => {
  const t = fakeTransport({
    'GET /api/items/a%2Fb%3F': {},
    'POST /api/plan/2026-11-02/3/done': {},
  });
  const api = endpoints(
    createApiClient({ transport: t, onUnauthenticated: vi.fn() }),
  );
  await api.item('a/b?');
  await api.planDone('2026-11-02', 3);
  expect(t.calls.map((c) => c.url)).toEqual([
    '/api/items/a%2Fb%3F',
    '/api/plan/2026-11-02/3/done',
  ]);
});

test('reviewQueue y review usan las rutas de P09', async () => {
  const t = fakeTransport({
    'GET /api/review/queue?limit=20': [],
    'POST /api/reviews': () => jsonResponse({ card_id: 'c1' }),
    'PATCH /api/cards/c1/flags': () => jsonResponse({ card_id: 'c1' }),
  });
  const api = endpoints(
    createApiClient({ transport: t, onUnauthenticated: vi.fn() }),
  );
  await api.reviewQueue(20);
  await api.review({ card_id: 'c1' } as never);
  await api.cardFlags('c1', { suspended: true } as never);
  expect(t.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
    'GET /api/review/queue?limit=20',
    'POST /api/reviews',
    'PATCH /api/cards/c1/flags',
  ]);
});

test('fileUrl y audioUrl solo arman rutas relativas', () => {
  const api = endpoints(
    createApiClient({
      transport: fakeTransport({}),
      onUnauthenticated: vi.fn(),
    }),
  );
  expect(api.fileUrl('abc')).toBe('/api/files/abc');
  expect(api.audioUrl('k 1')).toBe('/api/audio/k%201');
});

test('expone los métodos de admin y arma las rutas con ids codificados', async () => {
  const { transport, api } = makeEndpoints();
  await api.adminJobs({ state: 'failed', limit: 10 });
  await api.regenerateAudio('a'.repeat(32));
  await api.updateTopic('tp/1', { title: 'Salutations' });
  expect(transport.calls[0]).toMatchObject({
    method: 'GET',
    url: '/api/admin/jobs?limit=10&state=failed',
  });
  expect(transport.calls[1]).toMatchObject({
    method: 'POST',
    url: `/api/admin/audio/${'a'.repeat(32)}/regenerate`,
  });
  expect(transport.calls[2]).toMatchObject({
    method: 'PATCH',
    url: '/api/admin/topics/tp%2F1',
  });
});

test('los métodos de tarjetas y temas usan el verbo y el cuerpo correctos', async () => {
  const { transport, api } = makeEndpoints();
  await api.createCard({
    kind: 'vocab',
    front_fr: 'le chien',
    back_es: 'el perro',
  });
  await api.saveMyCard('c_1', { front_fr: 'x', back_es: 'y' });
  await api.mergeTopics({ topic_ids: ['tp_1', 'tp_2'], title: 'Tout' });
  expect(transport.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
    'POST /api/cards',
    'PUT /api/cards/c_1/mine',
    'POST /api/admin/topics/merge',
  ]);
  expect(transport.calls[0]!.body).toEqual({
    kind: 'vocab',
    front_fr: 'le chien',
    back_es: 'el perro',
  });
  expect(transport.calls[1]!.body).toEqual({ front_fr: 'x', back_es: 'y' });
  expect(transport.calls[2]!.body).toEqual({
    topic_ids: ['tp_1', 'tp_2'],
    title: 'Tout',
  });
});

test('las rutas de gestión coinciden con la tabla de P11 y las de admin viven en /api/admin', async () => {
  const { transport, api } = makeEndpoints();
  await api.adminUsers();
  await api.disableUser('u/1');
  await api.enableUser('u/1');
  await api.adminInvites();
  await api.createInvite({ role: 'user' });
  await api.revokeInvite('inv/1');
  await api.adminPipeline();
  await api.runPipeline({ kind: 'pipeline.daily' });
  await api.adminJobs({
    state: 'failed',
    kind: 'audio.regenerate',
    limit: 10,
  });
  await api.retryJob(7);
  await api.adminUsage();
  await api.audioQueue();
  await api.regenerateAudio('a/b');
  await api.setDefaultVoices({ voice_ids: ['fr-FR-DeniseNeural'] });
  await api.regenerateItem('i/1');
  await api.createCard({
    kind: 'vocab',
    front_fr: 'le chat',
    back_es: 'el gato',
  });
  await api.saveMyCard('c/1', { front_fr: 'x', back_es: 'y' });
  await api.deleteMyCard('c/1');
  await api.deleteCard('c/1');
  await api.adminUpdateCard('c/1', { front_fr: 'x', back_es: 'y' });
  await api.adminDeleteCard('c/1');
  await api.updateTopic('tp/1', { title: 'Salutations' });
  await api.mergeTopics({ topic_ids: ['tp_1', 'tp_2'], title: 'Tout' });
  await api.splitTopic('tp/1', { item_ids: ['i/1'], title: 'Salutations' });
  await api.moveTopicItems('tp/1', { item_ids: ['i/1'] });
  expect(transport.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
    'GET /api/admin/users',
    'POST /api/admin/users/u%2F1/disable',
    'POST /api/admin/users/u%2F1/enable',
    'GET /api/admin/invites',
    'POST /api/admin/invites',
    'DELETE /api/admin/invites/inv%2F1',
    'GET /api/admin/pipeline',
    'POST /api/admin/pipeline/run',
    'GET /api/admin/jobs?kind=audio.regenerate&limit=10&state=failed',
    'POST /api/admin/jobs/7/retry',
    'GET /api/admin/usage',
    'GET /api/admin/audio/queue',
    'POST /api/admin/audio/a%2Fb/regenerate',
    'PUT /api/admin/voices/default',
    'POST /api/admin/items/i%2F1/regenerate',
    'POST /api/cards',
    'PUT /api/cards/c%2F1/mine',
    'DELETE /api/cards/c%2F1/mine',
    'DELETE /api/cards/c%2F1',
    'PATCH /api/admin/cards/c%2F1',
    'DELETE /api/admin/cards/c%2F1',
    'PATCH /api/admin/topics/tp%2F1',
    'POST /api/admin/topics/merge',
    'POST /api/admin/topics/tp%2F1/split',
    'POST /api/admin/topics/tp%2F1/items',
  ]);
});

test('adminJobs omite los filtros no definidos', async () => {
  const { transport, api } = makeEndpoints();
  await api.adminJobs({});
  await api.adminJobs({ state: 'failed' });
  await api.adminJobs({ kind: 'audio.regenerate', limit: 5 });
  expect(transport.calls.map((c) => c.url)).toEqual([
    '/api/admin/jobs',
    '/api/admin/jobs?state=failed',
    '/api/admin/jobs?kind=audio.regenerate&limit=5',
  ]);
});

test('los métodos de gestión usan los tipos de CHG-17', () => {
  const api = endpoints(
    createApiClient({
      transport: fakeTransport({}),
      onUnauthenticated: vi.fn(),
    }),
  );
  const voices: (body: DefaultVoicesIn) => Promise<VoiceOut[]> =
    api.setDefaultVoices;
  const update: (topicId: string, body: TopicUpdateIn) => Promise<StudyTopic> =
    api.updateTopic;
  const merge: (body: TopicsMergeIn) => Promise<StudyTopic> = api.mergeTopics;
  const split: (topicId: string, body: TopicSplitIn) => Promise<StudyTopic[]> =
    api.splitTopic;
  const move: (topicId: string, body: TopicItemsIn) => Promise<StudyTopic> =
    api.moveTopicItems;
  expect([voices, update, merge, split, move]).toHaveLength(5);
});

test('los métodos existentes conservan sus rutas', async () => {
  const { transport, api } = makeEndpoints();
  await api.me();
  await api.courses();
  await api.cards({ limit: 2 });
  await api.topic('tp_1');
  await api.planDone('2026-11-02', 3);
  await api.deleteThread('th_1');
  expect(transport.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
    'GET /api/auth/me',
    'GET /api/courses',
    'GET /api/cards?limit=2',
    'GET /api/topics/tp_1',
    'POST /api/plan/2026-11-02/3/done',
    'DELETE /api/chat/threads/th_1',
  ]);
});

test('practiceTts hace POST /api/practice/tts con texto y voz', async () => {
  const { transport, api } = makeEndpoints();
  await api.practiceTts({ text: 'Bonjour', voice_id: 'fr-FR-DeniseNeural' });
  const call = transport.calls[0]!;
  expect(call.method).toBe('POST');
  expect(call.url).toBe('/api/practice/tts');
  expect(call.body).toEqual({
    text: 'Bonjour',
    voice_id: 'fr-FR-DeniseNeural',
  });
});
