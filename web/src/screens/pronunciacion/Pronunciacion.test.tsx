import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CardView,
  DrillDeck,
  SpeechToken,
  UserPrefs,
  VoiceOut,
} from '../../contracts/generated';
import { HttpError, OfflineError } from '../../api/client';
import { jsonResponse } from '../../api/testing';
import { closeFrancesDbForTests } from '../../db/idb';
import { closeV2DbForTests } from '../../offline/db';
import { listAttempts } from '../../pron/attempts';
import {
  addSeconds,
  monthOf,
  QUOTA_MESSAGES,
  WARN_SECONDS,
} from '../../pron/quota';
import { RecognizerError } from '../../pron/recognizer';
import { saveStats } from '../../pron/stats';
import { renderScreen } from '../../shell/testing';
import Pronunciacion, { speechErrorMessage } from './Pronunciacion';
import bonjour from '../../../../tests/fixtures/azure/bonjour.json';

const VOICES: VoiceOut[] = [
  {
    id: 'voice-a',
    label: 'Denise',
    accent: 'fr-FR',
    age: 'adult',
    gender: 'female',
  },
];

const PREFS: UserPrefs = {
  preferred_voice_ids: ['voice-a'],
  daily_new_cards: 10,
  theme: 'system',
};

const TOKEN: SpeechToken = {
  token: 'token-solo-memoria',
  region: 'eastus',
  locale: 'fr-FR',
  expires_at: '2026-11-06T12:10:00.000Z',
};

const BASE_ROUTES = {
  'GET /api/voices': VOICES,
  'GET /api/me/prefs': PREFS,
  'GET /api/audio/k1': () =>
    new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'Content-Type': 'audio/mpeg' },
    }),
};

function card(id: string, overrides: Partial<CardView> = {}): CardView {
  return {
    id,
    kind: 'phrase',
    front_fr: `fr-${id}`,
    back_es: `es-${id}`,
    example_fr: null,
    example_es: null,
    notes: null,
    ipa: null,
    phonemes: [],
    tags: [],
    stale: false,
    source_item_ids: [`item-${id}`],
    audio: [],
    audio_pending: [],
    owner: 'shared',
    edited_by_human: false,
    source_changed: false,
    mine: null,
    state: null,
    ...overrides,
  };
}

const PHRASE_CARD = card('p1', {
  front_fr: 'Bonjour, comment allez-vous ?',
  back_es: 'Hola, ¿cómo estás?',
});

const DECK_R: DrillDeck = {
  id: 'deck-r',
  phoneme: 'ʁ',
  title_es: 'La r francesa',
  curated: true,
  card_ids: ['d1', 'd2'],
};

const DECK_CARDS: Record<string, CardView> = {
  d1: card('d1', { front_fr: 'roue', back_es: 'rueda' }),
  d2: card('d2', { front_fr: 'rare', back_es: 'raro' }),
};

const DECK_ZH: DrillDeck = {
  id: 'deck-zh',
  phoneme: 'ʒ',
  title_es: 'La j francesa',
  curated: true,
  card_ids: ['d1'],
};

function fakeRecognizer(json: unknown = bonjour, durationMs = 1840) {
  return {
    assess: vi.fn(async () => ({ json, durationMs })),
  };
}

function practiceRoutes(routes: Record<string, unknown> = {}) {
  return {
    ...BASE_ROUTES,
    'POST /api/speech/token': TOKEN,
    ...routes,
  };
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  await closeFrancesDbForTests();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubEnv('VITE_E2E', '1');
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        return {
          getTracks: () => [{ stop: vi.fn() }],
        } as unknown as MediaStream;
      }),
    },
  });
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__francesFakeRecognizer;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('practica una frase de la cola con el recognizer falso y guarda el intento local', async () => {
  Object.assign(window, { __francesFakeRecognizer: fakeRecognizer() });
  const { transport } = renderScreen(<Pronunciacion />, {
    routes: practiceRoutes({
      'GET /api/review/queue': [PHRASE_CARD],
    }),
  });

  await screen.findByText(PHRASE_CARD.front_fr, {}, { timeout: 5000 });
  await userEvent.click(screen.getByRole('button', { name: /Grabar/ }));

  const score = await screen.findByRole('region', { name: 'Puntaje global' });
  expect(within(score).getByText('94')).toBeVisible();
  expect(within(score).getByText('Excelente')).toBeVisible();
  expect(within(score).getByText('Exactitud 92')).toBeVisible();
  expect(await listAttempts({ cardId: PHRASE_CARD.id })).toHaveLength(1);
  expect(transport.calls.some((call) => call.url === '/api/speech/token')).toBe(
    false,
  );

  const stored = [
    ...Object.entries(localStorage),
    ...Object.entries(sessionStorage),
  ]
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  expect(stored).not.toContain(TOKEN.token);
  expect(stored).not.toMatch(/AZURE_SPEECH_KEY/i);
});

test('modo fonema usa el mazo de taladro', async () => {
  const { transport } = renderScreen(<Pronunciacion />, {
    path: '/repasar/pronunciacion?modo=fonema&fonema=ʁ',
    pattern: '/repasar/pronunciacion',
    routes: practiceRoutes({
      'GET /api/drills': [DECK_R],
      'GET /api/cards/d1': DECK_CARDS.d1,
      'GET /api/cards/d2': DECK_CARDS.d2,
    }),
  });

  expect(await screen.findByText('roue')).toBeVisible();
  expect(screen.getByText('Fonema /ʁ/ · 1 de 2')).toBeVisible();
  expect(transport.calls.some((call) => call.url === '/api/review/queue')).toBe(
    false,
  );
  expect(
    transport.calls.filter((call) => call.url.startsWith('/api/cards/')),
  ).toHaveLength(2);
});

test('los fonemas débiles se ofrecen como filtros y la cuota avisa sin bloquear', async () => {
  await saveStats([
    {
      phoneme: 'ʒ',
      ema: 45,
      n: 5,
      last_at: '2026-11-01T10:00:00.000000Z',
    },
  ]);
  await addSeconds(monthOf(new Date()), WARN_SECONDS);
  renderScreen(<Pronunciacion />, {
    routes: practiceRoutes({
      'GET /api/review/queue': [PHRASE_CARD],
      'GET /api/drills': [DECK_ZH],
      'GET /api/cards/d1': DECK_CARDS.d1,
    }),
  });

  expect(await screen.findByText(QUOTA_MESSAGES.warn)).toBeVisible();
  const chip = await screen.findByRole('button', { name: 'Fonema ʒ' });
  await userEvent.click(chip);

  expect(chip).toHaveAttribute('aria-pressed', 'true');
  expect(await screen.findByText('roue')).toBeVisible();
  expect(screen.getByText('Fonema /ʒ/ · 1 de 1')).toBeVisible();
});

test('sin red avisa que necesita conexión', async () => {
  const { transport } = renderScreen(<Pronunciacion />, {
    online: false,
    routes: practiceRoutes(),
  });

  expect(
    await screen.findByText('La práctica necesita conexión'),
  ).toBeVisible();
  expect(transport.calls.some((call) => call.url === '/api/review/queue')).toBe(
    false,
  );
  expect(
    screen.queryByRole('button', { name: /Grabar/ }),
  ).not.toBeInTheDocument();
});

test('muestra carga, vacío y error con reintentar', async () => {
  renderScreen(<Pronunciacion />, {
    routes: practiceRoutes({
      'GET /api/review/queue': () => new Promise<Response>(() => undefined),
    }),
  });
  expect(screen.getByText('Cargando…')).toBeInTheDocument();
  cleanup();

  renderScreen(<Pronunciacion />, {
    routes: practiceRoutes({
      'GET /api/review/queue': [],
      'GET /api/cards?kind=phrase': { cards: [], next_cursor: null },
    }),
  });
  expect(
    await screen.findByText('No hay frases para practicar hoy'),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: 'Temas' })).toHaveAttribute(
    'href',
    '/temas',
  );
  cleanup();

  let calls = 0;
  renderScreen(<Pronunciacion />, {
    routes: practiceRoutes({
      'GET /api/review/queue': () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ code: 'internal', message_es: 'Fallo' }, 500)
          : jsonResponse([PHRASE_CARD]);
      },
    }),
  });

  expect(
    await screen.findByText('Algo salió mal en el servidor'),
  ).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText(PHRASE_CARD.front_fr)).toBeVisible();
  expect(calls).toBe(2);
});

test('traduce 429, 503 y sin red del token a mensajes en español', () => {
  expect(speechErrorMessage(new HttpError(429, 'rate_limited', ''))).toBe(
    'Límite de práctica por hora',
  );
  expect(speechErrorMessage(new HttpError(503, 'speech_unavailable', ''))).toBe(
    'La práctica no está disponible ahora',
  );
  expect(speechErrorMessage(new HttpError(503, 'busy', ''))).toBe(
    'La práctica no está disponible ahora',
  );
  expect(speechErrorMessage(new OfflineError())).toBe(
    'La práctica necesita conexión',
  );
  expect(speechErrorMessage(new RecognizerError('unauthorized'))).toBe(
    'La práctica no está disponible ahora',
  );
  expect(speechErrorMessage(new Error('otro'))).toBeNull();
});

test('R-42: el token solo vive en memoria y ninguna ruta usa la clave de Azure', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const source = [
    'Pronunciacion.tsx',
    'usePracticeDeck.ts',
    'strings.ts',
    // El recognizer con token vive en el módulo compartido de práctica.
    '../../pron/practiceHooks.ts',
  ]
    .map((file) => readFileSync(join(dir, file), 'utf8'))
    .join('\n');

  expect(source).toContain('getTokenRecognizer');
  expect(source).toContain('speechTokenSource');
  expect(source).not.toMatch(/createAzureRecognizer|fromSubscription/);
  expect(source).not.toMatch(/\bgetRecognizer\b/);
  expect(source).not.toMatch(/SpeechCredentials|AZURE_SPEECH_KEY/i);
  expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|caches/);

  // UI-11 guarda el token en una clausura hasta 60 s antes de vencer.
  const speechSource = readFileSync(join(dir, '../../media/speech.ts'), 'utf8');
  expect(speechSource).not.toMatch(/localStorage|sessionStorage|indexedDB/);
});
