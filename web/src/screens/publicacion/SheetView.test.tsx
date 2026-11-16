import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createApiClient } from '../../api/client';
import { fakeTransport } from '../../api/testing';
import type {
  CardView,
  StudySheet,
  UserPrefs,
  VoiceOut,
} from '../../contracts/generated';
import { SheetView } from './SheetView';

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

const SHEET: StudySheet = {
  item_id: 'cw_1',
  summary_es: 'Pasado para acciones terminadas.',
  objectives_es: ['Contar lo que hiciste el fin de semana.'],
  key_phrases: [{ fr: 'Je suis allée au cinéma.', es: 'Fui al cine.' }],
  grammar: [
    {
      title: 'Avoir ou être',
      explanation_es: 'Se elige según el verbo.',
      examples: [{ fr: 'Nous avons mangé.', es: 'Comimos.' }],
    },
  ],
  common_mistakes: [
    {
      wrong_fr: "J'ai allé",
      right_fr: 'Je suis allé(e)',
      why_es: 'Aller usa être.',
    },
  ],
  vocab_card_ids: ['card-2'],
  prompt_version: 'v3',
};

const CARD_PHRASE: CardView = {
  id: 'card-1',
  kind: 'phrase',
  front_fr: 'Je suis allée au cinéma.',
  back_es: 'Fui al cine.',
  example_fr: null,
  example_es: null,
  notes: null,
  ipa: null,
  phonemes: [],
  tags: [],
  stale: false,
  source_item_ids: ['cw_1'],
  audio: [
    {
      field: 'front',
      voice_id: 'voice-a',
      url: '/api/audio/phrase',
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

const CARD_VOCAB: CardView = {
  ...CARD_PHRASE,
  id: 'card-2',
  kind: 'vocab',
  front_fr: 'hier soir',
  back_es: 'anoche',
  audio: [
    {
      field: 'front',
      voice_id: 'voice-a',
      url: '/api/audio/vocab',
      duration_ms: 900,
    },
  ],
};

function setup(ui: ReactElement) {
  const transport = fakeTransport({
    'GET /api/voices': VOICES,
    'GET /api/me/prefs': PREFS,
    'GET /api/audio/phrase': () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    'GET /api/audio/vocab': () =>
      new Response(new Uint8Array([4, 5, 6]), {
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
  });
  const client = createApiClient({
    transport,
    onUnauthenticated: vi.fn(),
  });
  render(<ApiProvider client={client}>{ui}</ApiProvider>);
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

test('SheetView muestra resumen, objetivos, gramática, frases, errores, vocabulario y sello IA', () => {
  setup(<SheetView sheet={SHEET} cards={[CARD_PHRASE, CARD_VOCAB]} />);

  expect(screen.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  expect(screen.getByText('Pasado para acciones terminadas.')).toBeVisible();
  expect(
    screen.getByText('Contar lo que hiciste el fin de semana.'),
  ).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Gramática' })).toBeVisible();
  expect(screen.getByText('Avoir ou être')).toBeVisible();
  expect(screen.getByText('Se elige según el verbo.')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Frases clave' })).toBeVisible();
  expect(screen.getByText('Je suis allée au cinéma.')).toBeVisible();
  expect(
    screen.getByRole('heading', { name: 'Errores típicos' }),
  ).toBeVisible();
  expect(screen.getByText("J'ai allé")).toBeVisible();
  expect(screen.getByText('Je suis allé(e)')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Vocabulario' })).toBeVisible();
  expect(screen.getByText('hier soir')).toBeVisible();
  expect(screen.getByText('Resumen IA · v3')).toBeVisible();
});

test('la ficha reproduce el audio de la frase cuando es una tarjeta', async () => {
  const { transport } = setup(
    <SheetView sheet={SHEET} cards={[CARD_PHRASE, CARD_VOCAB]} />,
  );

  const buttons = await screen.findAllByRole('button', { name: 'Reproducir' });
  expect(buttons).toHaveLength(2);
  await userEvent.click(buttons[0] as HTMLElement);
  await waitFor(() => {
    expect(
      transport.calls.some((call) => call.url === '/api/audio/phrase'),
    ).toBe(true);
  });
});

test('sin tarjeta no inventa audio para las frases', () => {
  setup(<SheetView sheet={SHEET} />);

  expect(screen.queryByRole('button', { name: 'Reproducir' })).toBeNull();
});

test('sin prompt_version no muestra el sello de IA', () => {
  setup(
    <SheetView
      sheet={{ ...SHEET, prompt_version: null }}
      cards={[CARD_PHRASE, CARD_VOCAB]}
    />,
  );

  expect(screen.queryByText(/Resumen IA/)).toBeNull();
});
