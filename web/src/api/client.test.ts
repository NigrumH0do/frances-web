import { HttpError, OfflineError, createApiClient, toUiError } from './client';
import { fakeTransport, jsonResponse, offline } from './testing';

afterEach(() => {
  vi.restoreAllMocks();
});

test('csrf header only on unsafe methods and one retry after csrf 403', async () => {
  // REVIEW FOCUS P09-1
  let first = true;
  const t = fakeTransport({
    'GET /api/plan/today': {
      day: '2026-11-02',
      entries: [],
      generated_at: 'x',
    },
    'POST /api/reviews': () => {
      if (first) {
        first = false;
        return jsonResponse({ code: 'csrf', message_es: 'x' }, 403);
      }
      return jsonResponse({ card_id: 'c1' });
    },
  });
  const refreshCsrf = vi.fn(async () => 'nuevo');
  const c = createApiClient({
    transport: t,
    onUnauthenticated: vi.fn(),
    refreshCsrf,
  });
  c.setCsrfToken('viejo');
  await c.get('/api/plan/today');
  await c.send('POST', '/api/reviews', { card_id: 'c1' });
  expect(t.calls[0]!.headers.has('X-CSRF-Token')).toBe(false);
  expect(t.calls.slice(1).map((x) => x.headers.get('X-CSRF-Token'))).toEqual([
    'viejo',
    'nuevo',
  ]);
  expect(t.calls).toHaveLength(3);
  expect(refreshCsrf).toHaveBeenCalledTimes(1);
});

test('csrf 403 persists after one retry and is surfaced as HttpError', async () => {
  const t = fakeTransport({
    'POST /api/reviews': () =>
      jsonResponse({ code: 'csrf', message_es: 'no' }, 403),
  });
  const c = createApiClient({
    transport: t,
    onUnauthenticated: vi.fn(),
    refreshCsrf: async () => 'otro',
  });
  c.setCsrfToken('viejo');
  const err = await c.send('POST', '/api/reviews', {}).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).code).toBe('csrf');
  expect(t.calls).toHaveLength(2);
});

test('401 calls onUnauthenticated once', async () => {
  // REVIEW FOCUS P09-2
  const onUnauth = vi.fn();
  const c = createApiClient({
    transport: fakeTransport({
      'GET /api/me/stats': () =>
        jsonResponse({ code: 'unauthenticated', message_es: 'x' }, 401),
    }),
    onUnauthenticated: onUnauth,
  });
  await Promise.allSettled([c.get('/api/me/stats'), c.get('/api/me/stats')]);
  expect(onUnauth).toHaveBeenCalledTimes(1);
});

test('after a successful response a new 401 fires onUnauthenticated again', async () => {
  const onUnauth = vi.fn();
  let n = 0;
  const c = createApiClient({
    transport: fakeTransport({
      'GET /api/x': () => {
        n += 1;
        return n === 2
          ? jsonResponse({ ok: true })
          : jsonResponse({ code: 'unauthenticated', message_es: '' }, 401);
      },
    }),
    onUnauthenticated: onUnauth,
  });
  await expect(c.get('/api/x')).rejects.toBeInstanceOf(HttpError);
  await expect(c.get('/api/x')).resolves.toEqual({ ok: true });
  await expect(c.get('/api/x')).rejects.toBeInstanceOf(HttpError);
  expect(onUnauth).toHaveBeenCalledTimes(2);
});

test('red caída es OfflineError', async () => {
  const c = createApiClient({
    transport: fakeTransport({ 'GET /api/x': offline() }),
    onUnauthenticated: vi.fn(),
  });
  await expect(c.get('/api/x')).rejects.toBeInstanceOf(OfflineError);
});

test('503 busy en GET se reintenta una vez tras 500 ms', async () => {
  let n = 0;
  const c = createApiClient({
    transport: fakeTransport({
      'GET /api/x': () => {
        n += 1;
        return n === 1
          ? jsonResponse({ code: 'busy', message_es: '' }, 503)
          : jsonResponse({ ok: 1 });
      },
    }),
    onUnauthenticated: vi.fn(),
  });
  const started = Date.now();
  await expect(c.get('/api/x')).resolves.toEqual({ ok: 1 });
  expect(n).toBe(2);
  expect(Date.now() - started).toBeGreaterThanOrEqual(450);
});

test('503 busy en POST no se reintenta', async () => {
  const t = fakeTransport({
    'POST /api/reviews': () =>
      jsonResponse({ code: 'busy', message_es: '' }, 503),
  });
  const c = createApiClient({ transport: t, onUnauthenticated: vi.fn() });
  await expect(c.send('POST', '/api/reviews', {})).rejects.toMatchObject({
    code: 'busy',
    status: 503,
  });
  expect(t.calls).toHaveLength(1);
});

test('HttpError toma code y message del ApiError sin registrar el cuerpo', async () => {
  const logs = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'info').mockImplementation(() => {}),
  ];
  const c = createApiClient({
    transport: fakeTransport({
      'POST /api/auth/login': () =>
        jsonResponse(
          { code: 'rate_limited', message_es: 'Demasiados intentos' },
          429,
        ),
    }),
    onUnauthenticated: vi.fn(),
  });
  const err = (await c
    .send('POST', '/api/auth/login', { email: 'a@b.c', password: 'secreto' })
    .catch((e: unknown) => e)) as HttpError;
  expect(err).toBeInstanceOf(HttpError);
  expect(err.status).toBe(429);
  expect(err.code).toBe('rate_limited');
  expect(err.messageEs).toBe('Demasiados intentos');
  for (const spy of logs) expect(spy).not.toHaveBeenCalled();
});

test('sin cuerpo JSON el código es http_<status>', async () => {
  const c = createApiClient({
    transport: fakeTransport({
      'GET /api/x': () => new Response('<html>', { status: 500 }),
    }),
    onUnauthenticated: vi.fn(),
  });
  const err = (await c.get('/api/x').catch((e: unknown) => e)) as HttpError;
  expect(err.code).toBe('http_500');
});

test('204 devuelve undefined y blob devuelve el cuerpo binario', async () => {
  const t = fakeTransport({
    'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    'GET /api/files/abc': () =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
  });
  const c = createApiClient({ transport: t, onUnauthenticated: vi.fn() });
  await expect(c.send('POST', '/api/auth/logout')).resolves.toBeUndefined();
  const blob = await c.blob('/api/files/abc');
  expect(blob.size).toBe(3);
});

test('cada llamada usa credentials same-origin y JSON con Content-Type', async () => {
  const t = fakeTransport({ 'PUT /api/me/prefs': { daily_new_cards: 5 } });
  const c = createApiClient({ transport: t, onUnauthenticated: vi.fn() });
  c.setCsrfToken('tok');
  await c.send('PUT', '/api/me/prefs', { daily_new_cards: 5 });
  const call = t.calls[0]!;
  expect(call.credentials).toBe('same-origin');
  expect(call.headers.get('Content-Type')).toBe('application/json');
  expect(call.headers.get('X-CSRF-Token')).toBe('tok');
  expect(call.body).toEqual({ daily_new_cards: 5 });
});

test('la query omite undefined y ordena las claves', async () => {
  const t = fakeTransport({ 'GET /api/x?a=1&b=2': {} });
  const c = createApiClient({ transport: t, onUnauthenticated: vi.fn() });
  await c.get('/api/x', { b: 2, skip: undefined, a: 1 });
  expect(t.calls[0]!.url).toBe('/api/x?a=1&b=2');
});

test('toUiError mapea red, HTTP y errores desconocidos', () => {
  expect(toUiError(new OfflineError())).toEqual({ kind: 'offline' });
  expect(toUiError(new HttpError(418, 'x', 'Mensaje'))).toEqual({
    kind: 'http',
    status: 418,
    code: 'x',
    message: 'Mensaje',
  });
  expect(toUiError(new Error('boom'))).toEqual({
    kind: 'http',
    status: 0,
    code: 'internal',
    message: '',
  });
});
