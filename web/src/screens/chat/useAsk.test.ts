import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createApiClient } from '../../api/client';
import { fakeTransport, jsonResponse } from '../../api/testing';
import type { Transport } from '../../api/transport';
import type { ChatEvent, Citation } from '../../contracts/generated';
import { useAsk } from './useAsk';

const CITATION: Citation = {
  block_id: 17,
  item_id: 'cw_7',
  page: 3,
  snippet: 'Leçon 7 — Le passé composé',
  source: 'att_1',
};

function sseResponse(events: ChatEvent[]): Response {
  const body = events
    .map((event) => `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function wrapperFor(transport: Transport) {
  const client = createApiClient({
    transport,
    onUnauthenticated: vi.fn(),
  });
  client.setCsrfToken('csrf-test');
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(ApiProvider, { client, children });
  };
}

function hangingTransport(onAbort: () => void): Transport {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        onAbort();
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('mapea meta, token, citation y done con su estado', async () => {
  const transport = fakeTransport({
    'POST /api/chat/threads/th_1/messages': () =>
      sseResponse([
        { kind: 'meta', message_id: 1 },
        { kind: 'token', text: 'Con ' },
        { kind: 'token', text: 'être… [1]' },
        { kind: 'citation', citation: CITATION },
        { kind: 'done', message_id: 2 },
      ]),
  });
  const { result } = renderHook(() => useAsk('th_1'), {
    wrapper: wrapperFor(transport),
  });

  await act(async () => {
    await result.current.ask('¿Cuándo uso être?');
  });

  expect(result.current.phase).toBe('done');
  expect(result.current.text).toBe('Con être… [1]');
  expect(result.current.citations).toEqual([CITATION]);
  expect(result.current.status).toBe('ok');
  expect(result.current.error).toBeNull();
});

test.each(['no_material', 'partial'] as const)(
  'done con code %s termina con ese estado',
  async (code) => {
    const transport = fakeTransport({
      'POST /api/chat/threads/th_1/messages': () =>
        sseResponse([{ kind: 'done', message_id: 7, code }]),
    });
    const { result } = renderHook(() => useAsk('th_1'), {
      wrapper: wrapperFor(transport),
    });

    await act(async () => {
      await result.current.ask('¿Y esto?');
    });

    expect(result.current.phase).toBe('done');
    expect(result.current.status).toBe(code);
  },
);

test('el cronómetro sube cada segundo y avisa a los 30 s sin primer token', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onAbort = vi.fn();
  const { result } = renderHook(() => useAsk('th_1'), {
    wrapper: wrapperFor(hangingTransport(onAbort)),
  });

  act(() => {
    void result.current.ask('¿Cuándo uso être?');
  });
  await waitFor(() => expect(result.current.phase).toBe('sending'));
  expect(result.current.elapsedS).toBe(0);
  expect(result.current.slow).toBe(false);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });

  expect(result.current.elapsedS).toBe(30);
  expect(result.current.slow).toBe(true);
  expect(result.current.phase).toBe('sending');

  act(() => result.current.cancel());
  await waitFor(() => expect(result.current.phase).toBe('cancelled'));
  expect(onAbort).toHaveBeenCalledTimes(1);
  expect(result.current.error).toBeNull();
});

test('cancelar aborta el fetch y deja el texto que ya llegó', async () => {
  let aborted = false;
  const encoder = new TextEncoder();
  const transport: Transport = (_input, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          encoder.encode(
            'event: token\ndata: {"kind":"token","text":"Con être"}\n\n',
          ),
        );
        init.signal?.addEventListener('abort', () => {
          aborted = true;
          c.error(new DOMException('aborted', 'AbortError'));
        });
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  };
  const { result } = renderHook(() => useAsk('th_1'), {
    wrapper: wrapperFor(transport),
  });

  act(() => {
    void result.current.ask('¿Cuándo uso être?');
  });
  await waitFor(() => expect(result.current.text).toBe('Con être'));

  act(() => result.current.cancel());
  await waitFor(() => expect(result.current.phase).toBe('cancelled'));
  expect(aborted).toBe(true);
  expect(result.current.text).toBe('Con être');
});

test('un segundo ask se ignora mientras el primero sigue en curso', async () => {
  let calls = 0;
  const transport: Transport = (_input, init) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      );
    });
  };
  const { result } = renderHook(() => useAsk('th_1'), {
    wrapper: wrapperFor(transport),
  });

  act(() => {
    void result.current.ask('primera');
  });
  await waitFor(() => expect(result.current.phase).toBe('sending'));

  await act(async () => {
    await result.current.ask('segunda');
  });

  expect(calls).toBe(1);
  act(() => result.current.cancel());
  await waitFor(() => expect(result.current.phase).toBe('cancelled'));
});

test('429 pide esperar porque ya hay una pregunta en curso', async () => {
  const transport = fakeTransport({
    'POST /api/chat/threads/th_1/messages': () =>
      jsonResponse({ code: 'rate_limited', message_es: 'espera' }, 429),
  });
  const { result } = renderHook(() => useAsk('th_1'), {
    wrapper: wrapperFor(transport),
  });

  await act(async () => {
    await result.current.ask('¿Y esto?');
  });

  expect(result.current.phase).toBe('error');
  expect(result.current.error).toEqual({
    kind: 'http',
    status: 429,
    code: 'rate_limited',
    message: 'Ya hay una pregunta en curso',
  });
});

test('404 avisa que el hilo ya no existe', async () => {
  const transport = fakeTransport({
    'POST /api/chat/threads/th_1/messages': () =>
      jsonResponse({ code: 'not_found', message_es: '' }, 404),
  });
  const { result } = renderHook(() => useAsk('th_1'), {
    wrapper: wrapperFor(transport),
  });

  await act(async () => {
    await result.current.ask('¿Y esto?');
  });

  expect(result.current.error).toEqual({
    kind: 'http',
    status: 404,
    code: 'not_found',
    message: 'Esta conversación ya no existe',
  });
});

test.each([
  [401, 'unauthenticated', 'unauthenticated'],
  [403, 'csrf', 'csrf'],
] as const)('el error %s se traduce a %s', async (status, bodyCode, code) => {
  const transport = fakeTransport({
    'POST /api/chat/threads/th_1/messages': () =>
      jsonResponse({ code: bodyCode, message_es: '' }, status),
  });
  const { result } = renderHook(() => useAsk('th_1'), {
    wrapper: wrapperFor(transport),
  });

  await act(async () => {
    await result.current.ask('¿Y esto?');
  });

  expect(result.current.phase).toBe('error');
  expect(result.current.error).toMatchObject({
    kind: 'http',
    status,
    code,
  });
});

test('un stream sin done ni error se muestra como respuesta cortada', async () => {
  const transport = fakeTransport({
    'POST /api/chat/threads/th_1/messages': () =>
      sseResponse([{ kind: 'token', text: 'Con être' }]),
  });
  const { result } = renderHook(() => useAsk('th_1'), {
    wrapper: wrapperFor(transport),
  });

  await act(async () => {
    await result.current.ask('¿Y esto?');
  });

  expect(result.current.phase).toBe('error');
  expect(result.current.error).toEqual({
    kind: 'http',
    status: 0,
    code: 'stream_truncated',
    message: 'La respuesta se cortó antes de terminar.',
  });
  expect(result.current.text).toBe('Con être');
});
