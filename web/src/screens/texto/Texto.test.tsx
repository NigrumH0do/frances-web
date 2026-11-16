import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PracticeTtsOut,
  SpeechToken,
  UserPrefs,
  VoiceOut,
} from '../../contracts/generated';
import { jsonResponse } from '../../api/testing';
import { closeFrancesDbForTests } from '../../db/idb';
import { closeV2DbForTests } from '../../offline/db';
import { listAttempts } from '../../pron/attempts';
import { renderScreen } from '../../shell/testing';
import Texto from './Texto';
import bonjour from '../../../../tests/fixtures/azure/bonjour.json';

const VOICES: VoiceOut[] = [
  {
    id: 'fr-FR-DeniseNeural',
    label: 'Denise · Francia · adulta',
    accent: 'Francia',
    age: 'adult',
    gender: 'female',
  },
  {
    id: 'fr-FR-HenriNeural',
    label: 'Henri · Francia · adulto',
    accent: 'Francia',
    age: 'adult',
    gender: 'male',
  },
];

const PREFS: UserPrefs = {
  preferred_voice_ids: ['fr-FR-HenriNeural'],
  daily_new_cards: 10,
  theme: 'system',
};

const TOKEN: SpeechToken = {
  token: 'token-solo-memoria',
  region: 'eastus',
  locale: 'fr-FR',
  expires_at: '2026-11-06T12:10:00.000Z',
};

const KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function ttsRoute(calls: { text: string; voice_id: string }[]) {
  return ({ body }: { body: { text: string; voice_id: string } }) => {
    calls.push(body);
    const out: PracticeTtsOut = {
      cache_key: KEY,
      text: body.text,
      voice_id: body.voice_id,
      status: 'done',
      url: `/api/audio/${KEY}`,
      duration_ms: 1500,
    };
    return jsonResponse(out);
  };
}

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/voices': VOICES,
    'GET /api/me/prefs': PREFS,
    'POST /api/speech/token': TOKEN,
    [`GET /api/audio/${KEY}`]: () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    ...extra,
  };
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  await closeFrancesDbForTests();
  localStorage.clear();
  vi.stubEnv('VITE_E2E', '1');
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(
        async () =>
          ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream,
      ),
    },
  });
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__francesFakeRecognizer;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('escribir genera el audio solo, con la voz preferida', async () => {
  const calls: { text: string; voice_id: string }[] = [];
  renderScreen(<Texto />, {
    routes: routes({ 'POST /api/practice/tts': ttsRoute(calls) }),
  });

  const editor = await screen.findByRole('textbox', {
    name: 'Tu texto en francés',
  });
  await userEvent.type(editor, 'Bonjour à tous');

  expect(
    await screen.findByRole(
      'button',
      { name: 'Reproducir' },
      { timeout: 4000 },
    ),
  ).toBeVisible();
  expect(calls.at(-1)).toEqual({
    text: 'Bonjour à tous',
    voice_id: 'fr-FR-HenriNeural',
  });
  // El texto queda en «Tus textos recientes» al tener audio.
  expect(localStorage.getItem('frances.texto.history.v1:u1') ?? '').toContain(
    'Bonjour à tous',
  );
});

test('las letras francesas se insertan en el texto', async () => {
  renderScreen(<Texto />, { routes: routes() });
  const editor = (await screen.findByRole('textbox', {
    name: 'Tu texto en francés',
  })) as HTMLTextAreaElement;
  await userEvent.type(editor, 'Ca va');
  editor.setSelectionRange(0, 1);
  await userEvent.click(screen.getByRole('button', { name: 'Escribir ç' }));
  expect(editor.value).toBe('ça va');
});

test('una frase de arranque llena el editor', async () => {
  renderScreen(<Texto />, { routes: routes() });
  await userEvent.click(
    await screen.findByRole('button', {
      name: "Je voudrais un café, s'il vous plaît.",
    }),
  );
  expect(
    screen.getByRole('textbox', { name: 'Tu texto en francés' }),
  ).toHaveValue("Je voudrais un café, s'il vous plaît.");
});

test('grabar evalúa el texto, guarda el intento y ofrece palabras para repetir', async () => {
  const assess = vi.fn(async () => ({ json: bonjour, durationMs: 1840 }));
  Object.assign(window, { __francesFakeRecognizer: { assess } });
  const calls: { text: string; voice_id: string }[] = [];
  renderScreen(<Texto />, {
    path: '/repasar/texto?texto=Bonjour',
    routes: routes({ 'POST /api/practice/tts': ttsRoute(calls) }),
  });

  const mic = await screen.findByRole('button', { name: 'Grabar y evaluar' });
  await waitFor(() => expect(mic).toBeEnabled());
  await userEvent.click(mic);

  const score = await screen.findByRole('region', { name: 'Puntaje global' });
  expect(within(score).getByText(/Exactitud/)).toBeVisible();
  expect(assess).toHaveBeenCalledWith('Bonjour', expect.anything());
  await waitFor(async () => expect(await listAttempts({})).toHaveLength(1));
  expect(
    screen.getByRole('heading', { name: 'Palabras para repetir' }),
  ).toBeVisible();
});

test('si la evaluación no está disponible, igual deja grabarse', async () => {
  renderScreen(<Texto />, {
    path: '/repasar/texto?texto=Merci',
    routes: routes({
      'POST /api/speech/token': () =>
        jsonResponse(
          { code: 'speech_unavailable', message_es: 'no disponible' },
          503,
        ),
    }),
  });

  await userEvent.click(
    await screen.findByRole('button', { name: 'Grabar y evaluar' }),
  );
  expect(await screen.findByRole('button', { name: 'Grabarme' })).toBeVisible();
  expect(
    screen.getByText(/Igual puedes grabarte y compararte con el modelo/),
  ).toBeVisible();
});

test('el editor no marca el francés como error de ortografía', async () => {
  renderScreen(<Texto />, { routes: routes() });
  const editor = await screen.findByRole('textbox', {
    name: 'Tu texto en francés',
  });
  expect(editor).toHaveAttribute('spellcheck', 'false');
});

test('sin voz francesa en el navegador no la promete', async () => {
  renderScreen(<Texto />, {
    path: '/repasar/texto?texto=Salut',
    routes: routes({
      'POST /api/practice/tts': () =>
        jsonResponse({ code: 'tts_unavailable', message_es: 'no' }, 503),
    }),
  });
  expect(
    await screen.findByText('No se pudo generar el audio ahora.', undefined, {
      timeout: 4000,
    }),
  ).toBeVisible();
  expect(screen.queryByText(/voz francesa de tu navegador/)).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Escuchar con la voz del navegador' }),
  ).toBeNull();
});

test('si el servidor no da el audio, avisa y deja reintentar', async () => {
  renderScreen(<Texto />, {
    path: '/repasar/texto?texto=Salut',
    routes: routes({
      'POST /api/practice/tts': () =>
        jsonResponse({ code: 'tts_unavailable', message_es: 'no' }, 503),
    }),
  });
  expect(
    await screen.findByText(/No se pudo generar el audio ahora/, undefined, {
      timeout: 4000,
    }),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

test('R-42: el token no se guarda y la voz grabada no va a disco', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const source = [
    'Texto.tsx',
    'SpeakPanel.tsx',
    'ModelPanel.tsx',
    'useModelAudio.ts',
    '../../pron/take.ts',
  ]
    .map((file) => readFileSync(join(dir, file), 'utf8'))
    .join('\n');
  expect(source).not.toMatch(/AZURE_SPEECH_KEY|fromSubscription/i);
  expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\./);
});
