import { describe, expect, test, vi } from 'vitest';
import { ChatHttpError, askChat } from './chatStream';

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      parts.forEach((p) => c.enqueue(enc.encode(p)));
      c.close();
    },
  });
}

describe('askChat', () => {
  test('manda CSRF y corta en done', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          streamOf(
            'event: meta\ndata: {"kind":"meta","message_id":1}\n\n',
            'event: done\ndata: {"kind":"done","message_id":2}\n\n',
            'event: token\ndata: {"kind":"token","text":"tarde"}\n\n',
          ),
          { status: 200 },
        ),
    );
    const kinds: string[] = [];
    for await (const e of askChat('th_1', 'hola', {
      csrfToken: 'c',
      fetchImpl,
    })) {
      kinds.push(e.kind);
    }
    expect(kinds).toEqual(['meta', 'done']);
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('c');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      '/api/chat/threads/th_1/messages',
    );
    expect(init.method).toBe('POST');
  });

  test('credentials same-origin y Accept text/event-stream', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(streamOf('event: done\ndata: {"kind":"done"}\n\n'), {
          status: 200,
        }),
    );
    for await (const event of askChat('th_1', 'hola', {
      csrfToken: 'c',
      fetchImpl,
    })) {
      expect(event.kind).toBe('done');
    }
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('Accept')).toBe('text/event-stream');
  });

  test('cualquier status distinto de 200 lanza ChatHttpError, también un 2xx', async () => {
    const fetchImpl = async () =>
      new Response(streamOf('event: done\ndata: {"kind":"done"}\n\n'), {
        status: 201,
      });
    await expect(
      askChat('th_1', 'hola', {
        csrfToken: 'c',
        fetchImpl: fetchImpl as typeof fetch,
      }).next(),
    ).rejects.toMatchObject({ status: 201, code: 'http_201' });
  });

  test('abortar a mitad del stream lanza AbortError', async () => {
    const ctrl = new AbortController();
    const enc = new TextEncoder();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const signal = init?.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(
            enc.encode('event: token\ndata: {"kind":"token","text":"a"}\n\n'),
          );
          signal.addEventListener('abort', () =>
            c.error(new DOMException('aborted', 'AbortError')),
          );
        },
      });
      return new Response(body, { status: 200 });
    });
    const gen = askChat('th_1', 'hola', {
      csrfToken: 'c',
      signal: ctrl.signal,
      fetchImpl,
    });
    const first = await gen.next();
    expect(first.value).toMatchObject({ kind: 'token' });
    ctrl.abort();
    await expect(gen.next()).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('cerrar el generador a mitad cancela el reader del body', async () => {
    const enc = new TextEncoder();
    const cancelled = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(
            enc.encode('event: token\ndata: {"kind":"token","text":"a"}\n\n'),
          );
        },
        cancel: cancelled,
      });
      return new Response(body, { status: 200 });
    });
    const gen = askChat('th_1', 'hola', { csrfToken: 'c', fetchImpl });
    await gen.next();
    await gen.return(undefined);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  test.each(['no_material', 'partial'])(
    'done con code %s pasa tal cual y termina el stream',
    async (code) => {
      const fetchImpl = vi.fn<typeof fetch>(
        async () =>
          new Response(
            streamOf(
              `event: done\ndata: {"kind":"done","code":"${code}"}\n\n`,
              'event: token\ndata: {"kind":"token","text":"tarde"}\n\n',
            ),
            { status: 200 },
          ),
      );
      const events: unknown[] = [];
      for await (const e of askChat('th_1', 'hola', {
        csrfToken: 'c',
        fetchImpl,
      })) {
        events.push(e);
      }
      expect(events).toEqual([{ kind: 'done', code }]);
    },
  );

  test('stream cerrado sin done ni error lanza stream_truncated', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          streamOf('event: token\ndata: {"kind":"token","text":"a"}\n\n'),
          { status: 200 },
        ),
    );
    const kinds: string[] = [];
    await expect(
      (async () => {
        for await (const e of askChat('th_1', 'hola', {
          csrfToken: 'c',
          fetchImpl,
        })) {
          kinds.push(e.kind);
        }
      })(),
    ).rejects.toMatchObject({
      name: 'ChatHttpError',
      code: 'stream_truncated',
    });
    expect(kinds).toEqual(['token']);
  });

  test('un 429 lanza ChatHttpError con el código', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ code: 'rate_limited', message_es: 'x' }), {
        status: 429,
      });
    const gen = askChat('th_1', 'hola', {
      csrfToken: 'c',
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(gen.next()).rejects.toBeInstanceOf(ChatHttpError);
    await expect(
      askChat('th_1', 'hola', {
        csrfToken: 'c',
        fetchImpl: fetchImpl as typeof fetch,
      }).next(),
    ).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
  });

  test('sin JSON de error usa http_<status> como código', async () => {
    const fetchImpl = async () => new Response('boom', { status: 500 });
    await expect(
      askChat('th_1', 'hola', {
        csrfToken: 'c',
        fetchImpl: fetchImpl as typeof fetch,
      }).next(),
    ).rejects.toMatchObject({ status: 500, code: 'http_500' });
  });

  test('ignora data que no parsea y termina en error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          streamOf(
            'event: token\ndata: {no json\n\n',
            'event: error\ndata: {"kind":"error","code":"llm_unavailable"}\n\n',
            'event: done\ndata: {"kind":"done"}\n\n',
          ),
          { status: 200 },
        ),
    );
    const kinds: string[] = [];
    for await (const e of askChat('th_1', 'hola', {
      csrfToken: 'c',
      fetchImpl,
    })) {
      kinds.push(e.kind);
    }
    expect(kinds).toEqual(['error']);
  });
});
