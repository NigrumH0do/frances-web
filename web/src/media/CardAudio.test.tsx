import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiProvider } from '../api/ApiContext';
import { createApiClient } from '../api/client';
import { fakeTransport, jsonResponse } from '../api/testing';
import type { CardView, UserPrefs, VoiceOut } from '../contracts/generated';
import { CardAudio } from './CardAudio';

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
  daily_new_cards: 10,
  theme: 'system',
};

const CARD: CardView = {
  id: 'card-1',
  kind: 'phrase',
  front_fr: 'Bonjour',
  back_es: 'Hola',
  example_fr: null,
  example_es: null,
  notes: null,
  ipa: null,
  phonemes: [],
  tags: [],
  stale: false,
  source_item_ids: ['item-1'],
  audio: [
    {
      field: 'front',
      voice_id: 'voice-a',
      url: '/api/audio/k1',
      duration_ms: 1200,
    },
  ],
  audio_pending: [],
  owner: 'shared',
  edited_by_human: false,
  source_changed: false,
  mine: null,
  state: null,
};

function setup(routes: Record<string, unknown> = {}, slowLabel?: string) {
  const transport = fakeTransport({
    'GET /api/voices': VOICES,
    'GET /api/me/prefs': PREFS,
    'GET /api/audio/k1': () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    ...routes,
  });
  const client = createApiClient({
    transport,
    onUnauthenticated: vi.fn(),
  });
  render(
    <ApiProvider client={client}>
      <CardAudio card={CARD} field="front" slowLabel={slowLabel} />
    </ApiProvider>,
  );
  return { transport };
}

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('CardAudio pide el audio con GET completo a la url de la API', async () => {
  const { transport } = setup();
  await userEvent.click(
    await screen.findByRole('button', { name: /Reproducir/ }),
  );
  const call = await waitFor(() => {
    const found = transport.calls.find((c) => c.url === '/api/audio/k1');
    expect(found).toBeDefined();
    return found!;
  });
  expect(call.method).toBe('GET');
  expect(call.headers.has('Range')).toBe(false);
});

test('sin slowLabel CardAudio muestra Más lento', async () => {
  setup();
  expect(
    await screen.findByRole('button', { name: 'Más lento' }),
  ).toBeVisible();
});

test('«Lento» reutiliza el blob ya cargado a 0,75×', async () => {
  const { transport } = setup({}, 'Lento');
  expect(
    screen.queryByRole('button', { name: 'Más lento' }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Reproducir' }),
  );
  expect(await screen.findByRole('button', { name: 'Detener' })).toBeTruthy();
  await waitFor(() =>
    expect(
      transport.calls.filter((call) => call.url === '/api/audio/k1'),
    ).toHaveLength(1),
  );

  await userEvent.click(screen.getByRole('button', { name: 'Lento' }));
  const audio = document.querySelector('audio') as HTMLAudioElement;
  expect(audio.playbackRate).toBe(0.75);
  expect(
    transport.calls.filter((call) => call.url === '/api/audio/k1'),
  ).toHaveLength(1);
  expect(document.querySelectorAll('audio')).toHaveLength(1);
});

test('CardAudio usa la preferida que devuelve la API', async () => {
  setup();
  const select = (await screen.findByLabelText('Voz')) as HTMLSelectElement;
  await waitFor(() => expect(select.value).toBe('voice-a'));
});

test('al cambiar de clip aborta la carga anterior', async () => {
  const card: CardView = {
    ...CARD,
    audio: [
      {
        field: 'front',
        voice_id: 'voice-a',
        url: '/api/audio/a',
        duration_ms: 1000,
      },
      {
        field: 'front',
        voice_id: 'voice-b',
        url: '/api/audio/b',
        duration_ms: 1000,
      },
    ],
  };
  const signals: (AbortSignal | undefined)[] = [];
  const transport = vi.fn(
    async (url: string, init: RequestInit): Promise<Response> => {
      if (url === '/api/voices') {
        return jsonResponse(VOICES);
      }
      if (url === '/api/me/prefs') {
        return jsonResponse(PREFS);
      }
      if (url.startsWith('/api/audio/')) {
        signals.push(init.signal ?? undefined);
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
      throw new Error(`ruta inesperada: ${url}`);
    },
  );
  const client = createApiClient({
    transport,
    onUnauthenticated: vi.fn(),
  });
  render(
    <ApiProvider client={client}>
      <CardAudio card={card} field="front" />
    </ApiProvider>,
  );

  const select = await screen.findByLabelText('Voz');
  await userEvent.click(screen.getByRole('button', { name: /Reproducir/ }));
  await waitFor(() => expect(signals).toHaveLength(1));
  await userEvent.selectOptions(select, 'voice-b');
  await userEvent.click(screen.getByRole('button', { name: /Reproducir/ }));
  await waitFor(() => expect(signals).toHaveLength(2));

  expect(signals[0]!.aborted).toBe(true);
  expect(signals[1]!.aborted).toBe(false);
});
