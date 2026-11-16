import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { HttpError, createApiClient } from '../api/client';
import { endpoints } from '../api/endpoints';
import { fakeTransport, jsonResponse } from '../api/testing';
import { speechTokenSource } from './speech';

function clientFor(routes: Record<string, unknown>) {
  return createApiClient({
    transport: fakeTransport(routes),
    onUnauthenticated: vi.fn(),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

test('speechTokenSource reutiliza el token hasta 60 s antes de vencer', async () => {
  let issued = 0;
  const client = clientFor({
    'POST /api/speech/token': () => {
      issued += 1;
      return jsonResponse({
        token: `token-${issued}`,
        region: 'eastus',
        locale: 'fr-FR',
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      });
    },
  });
  const source = speechTokenSource(endpoints(client));

  const first = await source();
  expect(first).toEqual({
    token: 'token-1',
    region: 'eastus',
    expiresAt: Date.now() + 600_000,
  });

  vi.setSystemTime(Date.now() + 500_000);
  expect((await source()).token).toBe('token-1');

  // A 59 s del vencimiento ya no se reutiliza.
  vi.setSystemTime(Date.now() + 41_000);
  const third = await source();
  expect(third.token).toBe('token-2');
  expect(issued).toBe(2);
});

test('un 429 de /api/speech/token llega como HttpError', async () => {
  const client = clientFor({
    'POST /api/speech/token': () =>
      jsonResponse({ code: 'rate_limited', message_es: 'Espera' }, 429),
  });
  const source = speechTokenSource(endpoints(client));

  const error = await source().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(429);
  expect((error as HttpError).code).toBe('rate_limited');
});
