import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createApiClient } from '../../api/client';
import { fakeTransport, jsonResponse } from '../../api/testing';
import type { PracticeTtsOut } from '../../contracts/generated';
import { cleanPracticeText, hasLetters, useModelAudio } from './useModelAudio';

const VOICE = 'fr-FR-DeniseNeural';

function clip(text: string): PracticeTtsOut {
  return {
    cache_key: '0123456789abcdef0123456789abcdef',
    text,
    voice_id: VOICE,
    status: 'done',
    url: '/api/audio/0123456789abcdef0123456789abcdef',
    duration_ms: 1200,
  };
}

function setup(route: unknown) {
  const transport = fakeTransport({ 'POST /api/practice/tts': route });
  const client = createApiClient({ transport, onUnauthenticated: vi.fn() });
  client.setCsrfToken('csrf');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiProvider client={client}>{children}</ApiProvider>
  );
  return { transport, wrapper };
}

afterEach(() => {
  vi.useRealTimers();
});

test('normaliza como el servidor y exige letras', () => {
  expect(cleanPracticeText('  Bonjour \n à\ttous ')).toBe('Bonjour à tous');
  expect(hasLetters('123 !?')).toBe(false);
  expect(hasLetters('Ça va')).toBe(true);
});

test('pide el audio cuando el usuario deja de escribir', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { transport, wrapper } = setup(({ body }: { body: { text: string } }) =>
    jsonResponse(clip(body.text)),
  );
  const { result, rerender } = renderHook(
    ({ text }) => useModelAudio(text, VOICE, { online: true, debounceMs: 500 }),
    { wrapper, initialProps: { text: 'Bon' } },
  );
  rerender({ text: 'Bonjour  à tous' });
  expect(result.current.state.status).toBe('waiting');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  await waitFor(() => expect(result.current.state.status).toBe('ready'));
  expect(transport.calls).toHaveLength(1);
  expect(transport.calls[0]?.body).toEqual({
    text: 'Bonjour à tous',
    voice_id: VOICE,
  });
});

test('un texto ya oído sale de la memoria sin pedirlo otra vez', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { transport, wrapper } = setup(({ body }: { body: { text: string } }) =>
    jsonResponse(clip(body.text)),
  );
  const { result, rerender } = renderHook(
    ({ text }) => useModelAudio(text, VOICE, { online: true, debounceMs: 100 }),
    { wrapper, initialProps: { text: 'Merci' } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  await waitFor(() => expect(result.current.state.status).toBe('ready'));
  rerender({ text: 'Merci beaucoup' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  await waitFor(() => expect(transport.calls).toHaveLength(2));
  rerender({ text: 'Merci' });
  expect(result.current.state.status).toBe('ready');
  expect(transport.calls).toHaveLength(2);
});

test('sin letras no pide nada', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { transport, wrapper } = setup(clip('x'));
  const { result } = renderHook(
    () => useModelAudio('1234', VOICE, { online: true, debounceMs: 100 }),
    { wrapper },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(result.current.state.status).toBe('idle');
  expect(transport.calls).toHaveLength(0);
});

test('sin conexión avisa sin pedir', () => {
  const { transport, wrapper } = setup(clip('x'));
  const { result } = renderHook(
    () => useModelAudio('Bonjour', VOICE, { online: false }),
    { wrapper },
  );
  expect(result.current.state).toEqual({ status: 'error', error: 'offline' });
  expect(transport.calls).toHaveLength(0);
});

test('429 es límite por hora y 503 es no disponible', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const limited = setup(() =>
    jsonResponse({ code: 'rate_limited', message_es: 'límite' }, 429),
  );
  const a = renderHook(
    () => useModelAudio('Bonjour', VOICE, { online: true, debounceMs: 50 }),
    { wrapper: limited.wrapper },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  await waitFor(() =>
    expect(a.result.current.state).toEqual({
      status: 'error',
      error: 'rate_limited',
    }),
  );

  const down = setup(() =>
    jsonResponse({ code: 'tts_unavailable', message_es: 'no' }, 503),
  );
  const b = renderHook(
    () => useModelAudio('Bonjour', VOICE, { online: true, debounceMs: 50 }),
    { wrapper: down.wrapper },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  await waitFor(() =>
    expect(b.result.current.state).toEqual({
      status: 'error',
      error: 'unavailable',
    }),
  );
});
