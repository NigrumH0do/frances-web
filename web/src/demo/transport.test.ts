import type { Transport } from '../api/transport';
import type {
  CardView,
  ChatEvent,
  Me,
  PlanEntry,
  Quiz,
  ReviewIn,
  StudyPlanDay,
  UserCardStateOut,
  UserPrefs,
} from '../contracts/generated';
import { parseSse } from '../study/sse';
import type { DemoIndex } from './snapshot';
import { routeKey } from './snapshot';
import { createDemoTransport } from './transport';

const CARD_ID = 'c1';
const T0 = '2026-11-06T15:00:00.000Z';
const SHA = 'a'.repeat(64);

const ME: Me = {
  csrf_token: 'demo-csrf',
  user: {
    id: 'u_demo',
    email: 'demo@example.com',
    display_name: 'Demo',
    role: 'user',
    created_at: '2026-01-01T00:00:00.000Z',
    last_login_at: null,
    disabled: false,
  },
};

const BASE_STATE = {
  card_id: CARD_ID,
  fsrs: {
    difficulty: 0,
    due: '2026-11-06T12:00:00.000Z',
    elapsed_days: 0,
    lapses: 0,
    last_review: null,
    learning_steps: 0,
    reps: 0,
    scheduled_days: 0,
    stability: 0,
    state: 0,
  },
  flagged_hard: false,
  suspended: false,
  updated_at: '2026-11-06T12:00:00.000Z',
} as UserCardStateOut;

const CARD = {
  id: CARD_ID,
  front_fr: 'bonjour',
  back_es: 'hola',
  state: BASE_STATE,
} as unknown as CardView;

const OTHER_CARD = {
  id: 'c2',
  front_fr: 'merci',
  back_es: 'gracias',
  state: { ...BASE_STATE, card_id: 'c2' },
} as unknown as CardView;

const REVIEW: ReviewIn = {
  card_id: CARD_ID,
  rating: 3,
  reviewed_at: T0,
  next: {
    difficulty: 5,
    due: '2026-11-07T15:00:00.000Z',
    elapsed_days: 0,
    lapses: 0,
    last_review: T0,
    learning_steps: 0,
    reps: 1,
    scheduled_days: 1,
    stability: 2,
    state: 2,
  },
};

const QUIZ = {
  id: 'qz1',
  title_es: 'Quiz de prueba',
  scope_kind: 'topic',
  scope_id: 't1',
  stale: false,
  questions: [
    {
      id: 'q1',
      kind: 'translate',
      prompt_es: 'Manzana',
      prompt_fr: null,
      options: [],
      audio: null,
      source_item_id: null,
    },
    {
      id: 'q2',
      kind: 'order',
      prompt_es: 'Ordena',
      prompt_fr: null,
      options: ['je', 'vais'],
      audio: null,
      source_item_id: null,
    },
  ],
} as unknown as Quiz;

const PLAN: StudyPlanDay = {
  day: '2026-11-06',
  generated_at: T0,
  entries: [
    {
      done: false,
      kind: 'review',
      position: 0,
      reason_es: 'Toca repasar.',
      ref_id: CARD_ID,
      title_es: 'Repasar vocabulario',
      why_llm_es: null,
    },
    {
      done: false,
      kind: 'quiz',
      position: 1,
      reason_es: 'Un quiz corto.',
      ref_id: 'qz1',
      title_es: 'Quiz del tema',
      why_llm_es: null,
    },
  ],
};

const PREFS: UserPrefs = {
  daily_new_cards: 20,
  preferred_voice_ids: [],
  theme: 'system',
};

const CITATION = {
  block_id: 1,
  item_id: 'it1',
  page: 2,
  snippet: 'Bonjour',
  source: 'item',
};

const CHAT_EVENTS: ChatEvent[] = [
  { kind: 'meta', message_id: 10 },
  { kind: 'token', text: 'Hola, ' },
  { kind: 'token', text: '¿qué tal?' },
  { kind: 'citation', citation: CITATION },
  { kind: 'done', message_id: 11 },
];

const INDEX: DemoIndex = {
  version: 1,
  generated_at: T0,
  me: ME,
  demo_credentials: {
    email: 'demo@example.com',
    password: 'demo-demo-demo',
  },
  invite_token: 'demo',
  routes: {
    'GET /api/auth/me': 'r/me.json',
    'GET /api/health': 'r/health.json',
    'GET /api/review/queue?limit=50': 'r/queue.json',
    'GET /api/cards/c1': 'r/card.json',
    'GET /api/me/prefs': 'r/prefs.json',
    'GET /api/plan/today': 'r/plan.json',
    'GET /api/plan/week': 'r/week.json',
    'GET /api/quizzes/qz1': 'r/quiz.json',
    'GET /api/quizzes/qz1/attempts': 'r/attempts.json',
    'GET /api/chat/threads': 'r/threads.json',
  },
  quiz_keys: {
    qz1: { q1: 'manzana', q2: ['je', 'vais'] },
  },
  chat: [
    { question: '¿Qué dice «Bonjour»?', events: CHAT_EVENTS },
    { question: 'Pregunta sin material', events: [] },
  ],
};

const FILES: Record<string, unknown> = {
  'index.json': INDEX,
  'r/me.json': ME,
  'r/health.json': {
    status: 'ok',
    version: '1',
    schema_version: 1,
    db_ok: true,
    worker_seen_at: T0,
  },
  'r/queue.json': [CARD, OTHER_CARD],
  'r/card.json': CARD,
  'r/prefs.json': PREFS,
  'r/plan.json': PLAN,
  'r/week.json': [PLAN],
  'r/quiz.json': QUIZ,
  'r/attempts.json': [],
  'r/threads.json': [],
  [`files/${SHA}`]: 'PDF-SINTETICO',
  'audio/aud1.mp3': 'MP3-SINTETICO',
};

function post(
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

const CSRF = { 'X-CSRF-Token': 'demo-csrf' };

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockSnapshot(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const marker = '/demo-api/';
      const at = url.indexOf(marker);
      if (at < 0) return new Response('', { status: 404 });
      const relative = url.slice(at + marker.length);
      if (!(relative in FILES)) return new Response('', { status: 404 });
      const value = FILES[relative];
      return typeof value === 'string'
        ? new Response(value, { status: 200 })
        : json(value);
    }),
  );
}

async function login(t: Transport): Promise<Me> {
  const res = await t(
    '/api/auth/login',
    post({ email: 'demo@example.com', password: 'demo-demo-demo' }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Me;
}

async function readEvents(res: Response): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  if (!res.body) throw new Error('sin cuerpo SSE');
  for await (const item of parseSse(res.body)) {
    events.push(JSON.parse(item.data) as ChatEvent);
  }
  return events;
}

beforeEach(() => {
  sessionStorage.clear();
  mockSnapshot();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as { __francesDemo?: unknown }).__francesDemo;
});

describe('demo transport', () => {
  test('login demo, CSRF obligatorio y 404 fuera de la instantánea', async () => {
    const t = createDemoTransport({ delayMs: 0 });
    const anonymous = await t('/api/auth/me', { method: 'GET' });
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).code).toBe('unauthenticated');

    const me = await login(t);
    expect(me.csrf_token).toBe('demo-csrf');

    const noCsrf = await t('/api/reviews', post(REVIEW));
    expect(noCsrf.status).toBe(403);
    expect((await noCsrf.json()).code).toBe('csrf');
    expect((await t('/api/reviews', post(REVIEW, CSRF))).status).toBe(200);
    const missing = await t('/api/no-existe', { method: 'GET' });
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe('not_found');
  });

  test('la sesión demo persiste y logout la cierra', async () => {
    const first = createDemoTransport({ delayMs: 0 });
    await login(first);

    const second = createDemoTransport({ delayMs: 0 });
    expect((await second('/api/auth/me', { method: 'GET' })).status).toBe(200);

    expect(
      (
        await second('/api/auth/logout', {
          method: 'POST',
          headers: CSRF,
        })
      ).status,
    ).toBe(204);
    expect((await second('/api/auth/me', { method: 'GET' })).status).toBe(401);
  });

  test('la invitación demo válida entra sin sesión', async () => {
    const t = createDemoTransport({ delayMs: 0 });
    const check = await t('/api/auth/invite/check', post({ token: 'demo' }));
    expect(await check.json()).toMatchObject({ valid: true });

    const bad = await t(
      '/api/auth/invite/accept',
      post({
        token: 'otro',
        email: 'nuevo@example.com',
        display_name: 'Nuevo',
        password: 'demo-demo-demo',
      }),
    );
    expect(bad.status).toBe(400);

    const accepted = await t(
      '/api/auth/invite/accept',
      post({
        token: 'demo',
        email: 'nuevo@example.com',
        display_name: 'Nuevo',
        password: 'demo-demo-demo',
      }),
    );
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).csrf_token).toBe('demo-csrf');
    expect((await t('/api/auth/me', { method: 'GET' })).status).toBe(200);
  });

  test('una reseña saca la tarjeta de la cola del overlay', async () => {
    const t = createDemoTransport({ delayMs: 0 });
    await login(t);

    const before = (await (
      await t('/api/review/queue?limit=50', { method: 'GET' })
    ).json()) as CardView[];
    expect(before.map((c) => c.id)).toContain(CARD_ID);

    expect((await t('/api/reviews', post(REVIEW, CSRF))).status).toBe(200);

    const after = (await (
      await t('/api/review/queue?limit=50', { method: 'GET' })
    ).json()) as CardView[];
    expect(after.map((c) => c.id)).not.toContain(CARD_ID);

    const card = (await (
      await t('/api/cards/c1', { method: 'GET' })
    ).json()) as CardView;
    expect(card.state?.fsrs.last_review).toBe(T0);
  });

  test('dificultad inválida es 400 y reseña fuera de orden es 409', async () => {
    const t = createDemoTransport({ delayMs: 0 });
    await login(t);

    const invalid = {
      ...REVIEW,
      next: { ...REVIEW.next, difficulty: 0 },
    };
    expect((await t('/api/reviews', post(invalid, CSRF))).status).toBe(400);

    expect((await t('/api/reviews', post(REVIEW, CSRF))).status).toBe(200);
    expect((await t('/api/reviews', post(REVIEW, CSRF))).status).toBe(200);

    const older = {
      ...REVIEW,
      reviewed_at: '2026-11-05T15:00:00.000Z',
      next: { ...REVIEW.next, last_review: '2026-11-05T15:00:00.000Z' },
    };
    const res = await t('/api/reviews', post(older, CSRF));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('conflict');
  });

  test('sin red las escrituras fallan como fetch', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await expect(
      createDemoTransport()('/api/reviews', post(REVIEW, CSRF)),
    ).rejects.toThrow(TypeError);
  });

  test('admin es 403 y speech es 503', async () => {
    const t = createDemoTransport({ delayMs: 0 });
    await login(t);

    const admin = await t('/api/admin/pipeline', { method: 'GET' });
    expect(admin.status).toBe(403);
    expect((await admin.json()).code).toBe('forbidden');

    const speech = await t('/api/speech/token', post(undefined, CSRF));
    expect(speech.status).toBe(503);
    expect((await speech.json()).code).toBe('speech_unavailable');

    const tts = await t(
      '/api/practice/tts',
      post({ text: 'Bonjour', voice_id: 'fr-FR-DeniseNeural' }, CSRF),
    );
    expect(tts.status).toBe(503);
    expect((await tts.json()).code).toBe('tts_unavailable');
  });

  test('los archivos y el audio salen de demo-api', async () => {
    const t = createDemoTransport({ delayMs: 0 });
    await login(t);

    const file = await t(`/api/files/${SHA}`, { method: 'GET' });
    expect(await file.text()).toBe('PDF-SINTETICO');

    const audio = await t('/api/audio/aud1', { method: 'GET' });
    expect(await audio.text()).toBe('MP3-SINTETICO');
  });

  test('prefs, plan, flags e intentos se reflejan en los GET', async () => {
    const t = createDemoTransport({ delayMs: 0 });
    await login(t);

    const prefs = {
      daily_new_cards: 7,
      preferred_voice_ids: ['v1'],
      theme: 'dark',
    };
    expect(
      (await t('/api/me/prefs', { ...post(prefs, CSRF), method: 'PUT' }))
        .status,
    ).toBe(200);
    expect(
      (await (await t('/api/me/prefs', { method: 'GET' })).json()) as UserPrefs,
    ).toMatchObject(prefs);

    const done = await t('/api/plan/2026-11-06/1/done', post(undefined, CSRF));
    expect(done.status).toBe(200);
    expect(((await done.json()) as PlanEntry).done).toBe(true);
    const plan = (await (
      await t('/api/plan/today', { method: 'GET' })
    ).json()) as StudyPlanDay;
    expect(plan.entries[1]?.done).toBe(true);

    const flags = await t('/api/cards/c1/flags', {
      ...post({ suspended: true }, CSRF),
      method: 'PATCH',
    });
    expect(flags.status).toBe(200);
    expect(
      ((await (await t('/api/cards/c1', { method: 'GET' })).json()) as CardView)
        .state?.suspended,
    ).toBe(true);

    const attempt = await t(
      '/api/quizzes/qz1/attempts',
      post(
        {
          started_at: '2026-11-06T14:00:00.000Z',
          answers: [{ question_id: 'q1', answer: 'Manzana' }],
        },
        CSRF,
      ),
    );
    expect(attempt.status).toBe(200);
    const result = await attempt.json();
    expect(result.score).toBe(0.5);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      question_id: 'q1',
      correct: true,
      expected: 'manzana',
    });
    expect(
      await (await t('/api/quizzes/qz1/attempts', { method: 'GET' })).json(),
    ).toHaveLength(1);
  });

  test('chat emite el SSE grabado y se puede abortar', async () => {
    const t = createDemoTransport({ delayMs: 0 });
    await login(t);

    const created = await t('/api/chat/threads', {
      method: 'POST',
      headers: CSRF,
    });
    expect(created.status).toBe(201);
    const thread = await created.json();

    const res = await t(
      `/api/chat/threads/${thread.id}/messages`,
      post({ question: '¿Qué dice «Bonjour»?' }, CSRF),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(await readEvents(res)).toEqual(CHAT_EVENTS);

    const slow = createDemoTransport({ delayMs: 50 });
    const controller = new AbortController();
    const slowRes = await slow(`/api/chat/threads/${thread.id}/messages`, {
      ...post({ question: '¿Qué dice «Bonjour»?' }, CSRF),
      signal: controller.signal,
    });
    const reader = slowRes.body?.getReader();
    if (!reader) throw new Error('sin cuerpo');
    await reader.read();
    controller.abort();
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('chat sin coincidencia cierra con no_material', async () => {
    const t = createDemoTransport({ delayMs: 0 });
    await login(t);
    const thread = await (
      await t('/api/chat/threads', { method: 'POST', headers: CSRF })
    ).json();

    const res = await t(
      `/api/chat/threads/${thread.id}/messages`,
      post({ question: 'Una pregunta que no está' }, CSRF),
    );
    const events = await readEvents(res);
    expect(events.at(-1)?.kind).toBe('done');
    expect(events.at(-1)?.code).toBe('no_material');
    expect(events.some((e) => e.kind === 'token')).toBe(true);
  });

  test('los hilos se listan, leen y borran', async () => {
    const t = createDemoTransport({ delayMs: 0 });
    await login(t);
    const a = await (
      await t('/api/chat/threads', { method: 'POST', headers: CSRF })
    ).json();
    const b = await (
      await t('/api/chat/threads', { method: 'POST', headers: CSRF })
    ).json();

    const list = await (await t('/api/chat/threads', { method: 'GET' })).json();
    expect(list.map((x: { id: string }) => x.id)).toEqual([a.id, b.id]);

    const detail = await t(`/api/chat/threads/${a.id}`, { method: 'GET' });
    expect(detail.status).toBe(200);
    expect((await detail.json()).thread.id).toBe(a.id);

    expect(
      (
        await t(`/api/chat/threads/${a.id}`, {
          method: 'DELETE',
          headers: CSRF,
        })
      ).status,
    ).toBe(204);
    expect(
      (await t(`/api/chat/threads/${a.id}`, { method: 'GET' })).status,
    ).toBe(404);
  });

  test('routeKey ordena la query como la instantánea', () => {
    expect(routeKey('get', '/api/quizzes?scope_id=t1&scope_kind=topic')).toBe(
      'GET /api/quizzes?scope_id=t1&scope_kind=topic',
    );
    expect(routeKey('GET', '/api/cards?limit=200&item_id=it1')).toBe(
      'GET /api/cards?item_id=it1&limit=200',
    );
  });
});
