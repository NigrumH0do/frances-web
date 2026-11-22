import '@testing-library/jest-dom/vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test, vi } from 'vitest';
import { ApiProvider } from '../api/ApiContext';
import { createApiClient } from '../api/client';
import type { ApiClient } from '../api/client';
import { fakeTransport, jsonResponse } from '../api/testing';
import type { FakeRequest, FakeTransport } from '../api/testing';
import type { UserPrefs, VoiceOut } from '../contracts/generated';
import { useVoices } from './useVoices';

const VOICES: VoiceOut[] = [
  {
    id: 'voice-a',
    label: 'Denise',
    accent: 'fr-FR',
    age: 'adult',
    gender: 'female',
  },
  {
    id: 'voice-b',
    label: 'Henri',
    accent: 'fr-FR',
    age: 'adult',
    gender: 'male',
  },
];

const PREFS: UserPrefs = {
  preferred_voice_ids: ['voice-a'],
  daily_new_cards: 7,
  theme: 'dark',
};

function setup(routes: Record<string, unknown> = {}) {
  const transport = fakeTransport({
    'GET /api/voices': VOICES,
    'GET /api/me/prefs': PREFS,
    'PUT /api/me/prefs': (req: FakeRequest) => jsonResponse(req.body),
    ...routes,
  });
  const client = createApiClient({
    transport,
    onUnauthenticated: vi.fn(),
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <ApiProvider client={client}>{children}</ApiProvider>;
  }
  return { transport, client, wrapper };
}

type VoicesApi = ReturnType<typeof useVoices>;

// Cinco consumidores bajo un mismo `ApiProvider`, como los 127 `CardAudio` de
// una publicación real (LIVE-A2 H-B). Cada uno guarda su último valor para que
// el test compruebe que todos ven lo mismo.
const PROBES = 5;

function Probe({ index, seen }: { index: number; seen: VoicesApi[] }): null {
  seen[index] = useVoices();
  return null;
}

function Probes({
  client,
  seen,
  count,
}: {
  client: ApiClient;
  seen: VoicesApi[];
  count: number;
}) {
  return (
    <ApiProvider client={client}>
      {Array.from({ length: count }, (_unused, index) => (
        <Probe key={index} index={index} seen={seen} />
      ))}
    </ApiProvider>
  );
}

function renderProbes(client: ApiClient, count = PROBES) {
  const seen: VoicesApi[] = [];
  const rendered = render(<Probes client={client} seen={seen} count={count} />);
  return { seen, unmount: rendered.unmount };
}

function callsTo(transport: FakeTransport, method: string, url: string) {
  return transport.calls.filter(
    (call) => call.method === method && call.url === url,
  );
}

test('useVoices carga las voces y la preferencia guardada', async () => {
  const { wrapper } = setup();
  const { result } = renderHook(() => useVoices(), { wrapper });
  await waitFor(() => expect(result.current.voices).toHaveLength(2));
  expect(result.current.preferred).toEqual(['voice-a']);
});

test('setPreferred guarda las voces sin perder el resto de preferencias', async () => {
  const { transport, wrapper } = setup();
  const { result } = renderHook(() => useVoices(), { wrapper });
  await waitFor(() => expect(result.current.preferred).toEqual(['voice-a']));

  await act(async () => {
    await result.current.setPreferred(['voice-b']);
  });

  const put = transport.calls.find((call) => call.method === 'PUT');
  expect(put?.url).toBe('/api/me/prefs');
  expect(put?.body).toEqual({
    preferred_voice_ids: ['voice-b'],
    daily_new_cards: 7,
    theme: 'dark',
  });
  expect(result.current.preferred).toEqual(['voice-b']);
});

test('cinco useVoices bajo el mismo ApiProvider comparten una sola petición', async () => {
  const { transport, client } = setup();
  const { seen } = renderProbes(client);

  await waitFor(() => {
    expect(seen).toHaveLength(PROBES);
    for (const value of seen) {
      expect(value.voices).toHaveLength(2);
      expect(value.preferred).toEqual(['voice-a']);
    }
  });

  expect(callsTo(transport, 'GET', '/api/voices')).toHaveLength(1);
  expect(callsTo(transport, 'GET', '/api/me/prefs')).toHaveLength(1);
});

test('setPreferred avisa a todos los suscriptores sin volver a pedir preferencias', async () => {
  const { transport, client } = setup();
  const { seen } = renderProbes(client);
  await waitFor(() => expect(seen[0]?.preferred).toEqual(['voice-a']));

  await act(async () => {
    await seen[0]!.setPreferred(['voice-b']);
  });

  for (const value of seen) {
    expect(value.preferred).toEqual(['voice-b']);
  }
  expect(callsTo(transport, 'GET', '/api/me/prefs')).toHaveLength(1);
  expect(transport.calls.filter((call) => call.method === 'PUT')).toHaveLength(
    1,
  );
});

test('un fallo al cargar no queda memorizado: el siguiente montaje reintenta', async () => {
  let failVoices = true;
  const { transport, client } = setup({
    'GET /api/voices': () =>
      failVoices
        ? jsonResponse({ code: 'internal', message_es: '' }, 500)
        : jsonResponse(VOICES),
  });

  const first = renderProbes(client, 1);
  await waitFor(() => expect(first.seen[0]?.preferred).toEqual(['voice-a']));
  expect(first.seen[0]?.voices).toEqual([]);
  expect(callsTo(transport, 'GET', '/api/voices')).toHaveLength(1);

  first.unmount();
  failVoices = false;

  const second = renderProbes(client, 2);
  await waitFor(() => expect(second.seen[0]?.voices).toHaveLength(2));
  expect(second.seen[1]?.voices).toHaveLength(2);
  expect(callsTo(transport, 'GET', '/api/voices')).toHaveLength(2);
});

test('desmontar un suscriptor no cancela la petición compartida', async () => {
  const urls: string[] = [];
  let openGate: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  const transport = vi.fn(
    async (url: string, init: RequestInit): Promise<Response> => {
      urls.push(url);
      if (url === '/api/voices') {
        // Como `fetch`: si alguien aborta la señal compartida, la petición
        // muere y las voces nunca llegan a los demás suscriptores.
        return new Promise<Response>((resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
          void gate.then(() => resolve(jsonResponse(VOICES)));
        });
      }
      if (url === '/api/me/prefs') {
        return jsonResponse(PREFS);
      }
      throw new Error(`ruta inesperada: ${url}`);
    },
  );
  const client = createApiClient({ transport, onUnauthenticated: vi.fn() });

  const first = renderProbes(client, 1);
  await waitFor(() => expect(urls).toContain('/api/voices'));
  first.unmount();

  const second = renderProbes(client, 2);
  openGate();

  await waitFor(() => expect(second.seen[0]?.voices).toHaveLength(2));
  expect(second.seen[1]?.voices).toHaveLength(2);
  expect(urls.filter((url) => url === '/api/voices')).toHaveLength(1);
});

test('dos clientes distintos no comparten la caché compartida', async () => {
  const first = setup();
  const second = setup();

  const a = renderProbes(first.client, 1);
  const b = renderProbes(second.client, 1);

  await waitFor(() => expect(a.seen[0]?.voices).toHaveLength(2));
  await waitFor(() => expect(b.seen[0]?.voices).toHaveLength(2));

  expect(callsTo(first.transport, 'GET', '/api/voices')).toHaveLength(1);
  expect(callsTo(second.transport, 'GET', '/api/voices')).toHaveLength(1);
  expect(callsTo(first.transport, 'GET', '/api/me/prefs')).toHaveLength(1);
  expect(callsTo(second.transport, 'GET', '/api/me/prefs')).toHaveLength(1);
});
