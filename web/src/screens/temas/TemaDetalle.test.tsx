import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { jsonResponse } from '../../api/testing';
import type {
  CardPage,
  CardView,
  ItemDetail,
  ItemSummary,
  Quiz,
  QuizAttemptOut,
  StudySheet,
  StudyTopic,
  UserPrefs,
  VoiceOut,
} from '../../contracts/generated';
import { closeV2DbForTests } from '../../offline/db';
import { renderScreen } from '../../shell/testing';
import TemaDetalle from './TemaDetalle';
import { temaStrings as s } from './strings';
import { TopicItems } from './TopicItems';
import { TopicSummary } from './TopicSummary';

const temasCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'temas.css'),
  'utf8',
);

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

const TOPIC: StudyTopic = {
  id: 'tp_1',
  course_id: 'c_1',
  title: 'Le passé composé',
  description_es:
    'Pasado para acciones terminadas. Se forma con avoir o être en presente.',
  cefr: 'A2',
  position: 1,
  item_ids: ['it_1', 'it_2'],
  card_count: 28,
  edited_by_human: false,
  source_changed: false,
};

const ITEM_1: ItemSummary = {
  id: 'it_1',
  course_id: 'c_1',
  kind: 'coursework',
  topic_id: 'ct_1',
  title: 'Leçon 7 — Le passé composé',
  text_lang: 'fr',
  created_at: '2026-10-27T14:00:00.000Z',
  updated_at: '2026-10-27T14:00:00.000Z',
  first_seen_at: '2026-10-27T14:00:00.000Z',
  due_at: null,
  n_attachments: 1,
  n_cards: 14,
  has_sheet: true,
};

const ITEM_2: ItemSummary = {
  ...ITEM_1,
  id: 'it_2',
  kind: 'material',
  title: 'Exercices p. 42–43',
  n_attachments: 2,
  n_cards: 14,
};

const SHEET_1: StudySheet = {
  item_id: 'it_1',
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
  vocab_card_ids: [],
  prompt_version: 'v3',
};

const SHEET_2: StudySheet = {
  ...SHEET_1,
  item_id: 'it_2',
  summary_es: 'Ejercicios del pasado compuesto.',
  key_phrases: [],
};

const CARD_A: CardView = {
  id: 'card-a',
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
  source_item_ids: ['it_1'],
  audio: [
    {
      field: 'front',
      voice_id: 'voice-a',
      url: '/api/audio/frase',
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

const CARD_B: CardView = {
  ...CARD_A,
  id: 'card-b',
  kind: 'vocab',
  front_fr: 'hier soir',
  back_es: 'anoche',
  audio: [],
  source_item_ids: ['it_2'],
};

const CARD_C: CardView = {
  ...CARD_B,
  id: 'card-c',
  front_fr: 'nous sommes allés',
  back_es: 'fuimos',
};

const DETAIL_1: ItemDetail = {
  item: ITEM_1,
  text: 'Bonjour !\nAujourd’hui, nous étudions le passé composé.',
  alternate_link: null,
  attachments: [],
  card_ids: ['card-a'],
  sheet: SHEET_1,
};

const DETAIL_2: ItemDetail = {
  item: ITEM_2,
  text: 'Exercices.',
  alternate_link: null,
  attachments: [],
  card_ids: [],
  sheet: SHEET_2,
};

const QUIZ: Quiz = {
  id: 'qz_1',
  scope_kind: 'topic',
  scope_id: 'tp_1',
  title_es: 'Quiz del tema',
  stale: false,
  questions: [
    {
      id: 'q_1',
      kind: 'mcq',
      prompt_es: 'Elige la forma correcta.',
      prompt_fr: null,
      options: ['suis', 'est'],
      audio: null,
      source_item_id: 'it_1',
    },
    {
      id: 'q_2',
      kind: 'translate',
      prompt_es: 'Traduce la frase.',
      prompt_fr: null,
      options: [],
      audio: null,
      source_item_id: 'it_2',
    },
  ],
};

const ATTEMPTS: QuizAttemptOut[] = [
  {
    attempt_id: 2,
    quiz_id: 'qz_1',
    score: 0.75,
    started_at: '2026-10-29T10:00:00.000Z',
    finished_at: '2026-10-29T10:05:00.000Z',
  },
  {
    attempt_id: 1,
    quiz_id: 'qz_1',
    score: 0.5,
    started_at: '2026-10-28T10:00:00.000Z',
    finished_at: '2026-10-28T10:05:00.000Z',
  },
];

const FIRST_PAGE: CardPage = {
  cards: [CARD_B],
  next_cursor: 'cur-2',
};

const SECOND_PAGE: CardPage = {
  cards: [CARD_C],
  next_cursor: null,
};

function itemDetail(id: string, position: number): ItemDetail {
  const item: ItemSummary = {
    ...ITEM_1,
    id,
    title: `Clase ${position}`,
  };
  return {
    item,
    text: '',
    alternate_link: null,
    attachments: [],
    card_ids: [],
    sheet: null,
  };
}

function detailRoutes(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    'GET /api/topics/tp_1': TOPIC,
    'GET /api/sheets/it_1': SHEET_1,
    'GET /api/sheets/it_2': SHEET_2,
    'GET /api/topics/tp_1/cards?limit=50': {
      cards: [CARD_A],
      next_cursor: null,
    },
    'GET /api/items/it_1': DETAIL_1,
    'GET /api/items/it_2': DETAIL_2,
    'GET /api/quizzes?scope_id=tp_1&scope_kind=topic': [QUIZ],
    'GET /api/quizzes/qz_1/attempts': ATTEMPTS,
    'GET /api/voices': VOICES,
    'GET /api/me/prefs': PREFS,
    ...overrides,
  };
}

function renderTema(
  overrides: Record<string, unknown> = {},
  opts: { online?: boolean } = {},
) {
  return renderScreen(<TemaDetalle />, {
    path: '/temas/tp_1',
    pattern: '/temas/:topicId',
    online: opts.online,
    routes: detailRoutes(overrides),
  });
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('detalle: pestañas, clases por id y quiz con mejor nota', async () => {
  const { transport } = renderTema();

  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: 'Le passé composé',
    }),
  ).toBeVisible();
  expect(
    screen.getAllByText(/Pasado para acciones terminadas/).length,
  ).toBeGreaterThan(0);
  expect(await screen.findAllByText('Resumen IA · v3')).toHaveLength(2);
  expect(screen.getByText('Publicación 1')).toBeVisible();
  expect(screen.getByRole('button', { name: /Reproducir/ })).toBeVisible();
  expect(transport.calls.some((call) => call.url === '/api/items/it_1')).toBe(
    false,
  );

  await userEvent.click(screen.getByRole('tab', { name: 'Clases' }));

  const classLink = await screen.findByRole('link', {
    name: /Leçon 7 — Le passé composé/,
  });
  expect(classLink).toHaveAttribute('href', '/publicaciones/it_1');
  expect(screen.getByText(/Tarea · 1 adjunto/)).toBeVisible();
  expect(
    transport.calls.filter((call) => call.url.startsWith('/api/items/')),
  ).toHaveLength(2);

  await userEvent.click(screen.getByRole('tab', { name: 'Quiz' }));

  expect(await screen.findByText('Quiz del tema')).toBeVisible();
  expect(screen.getByText('2 preguntas')).toBeVisible();
  expect(screen.getByText('Mejor nota: 75 %')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Empezar' })).toHaveAttribute(
    'href',
    '/quiz/qz_1',
  );
});

test('pagina las tarjetas del resumen de a 50 y muestra todas', async () => {
  const cards = Array.from({ length: 60 }, (_, index) => {
    const number = index + 1;
    return {
      ...CARD_B,
      id: `summary-${number}`,
      front_fr: `mot ${number}`,
      back_es: `palabra ${number}`,
      audio: [],
      source_item_ids: ['it_1'],
    };
  });
  const firstPage = cards.slice(0, 50);
  const secondPage = cards.slice(50);
  const sheet: StudySheet = {
    ...SHEET_1,
    key_phrases: [],
    vocab_card_ids: cards.map((card) => card.id),
  };
  const topic: StudyTopic = {
    ...TOPIC,
    item_ids: ['it_1'],
    card_count: 60,
    description_es: '',
  };

  const { transport } = renderScreen(<TopicSummary topic={topic} />, {
    routes: {
      'GET /api/sheets/it_1': sheet,
      'GET /api/topics/tp_1/cards?limit=50': {
        cards: firstPage,
        next_cursor: 'cur-2',
      },
      'GET /api/topics/tp_1/cards?cursor=cur-2&limit=50': {
        cards: secondPage,
        next_cursor: null,
      },
    },
  });

  expect(await screen.findByText('mot 60')).toBeVisible();
  expect(screen.getAllByText(/^mot \d+$/)).toHaveLength(60);

  const cardCalls = transport.calls
    .map((call) => call.url)
    .filter((url) => url.startsWith('/api/topics/tp_1/cards'));
  expect(cardCalls).toEqual([
    '/api/topics/tp_1/cards?limit=50',
    '/api/topics/tp_1/cards?cursor=cur-2&limit=50',
  ]);
});

test('tarjetas del tema paginan con cursor', async () => {
  const { transport } = renderTema({
    'GET /api/topics/tp_1/cards': FIRST_PAGE,
    'GET /api/topics/tp_1/cards?cursor=cur-2': SECOND_PAGE,
  });

  await screen.findByRole('heading', {
    level: 1,
    name: 'Le passé composé',
  });
  await userEvent.click(screen.getByRole('tab', { name: 'Tarjetas' }));

  expect(await screen.findByText('hier soir')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));

  expect(await screen.findByText('nous sommes allés')).toBeVisible();
  expect(
    transport.calls.some(
      (call) => call.url === '/api/topics/tp_1/cards?cursor=cur-2',
    ),
  ).toBe(true);
});

test('tema inexistente muestra estado y enlace a Temas', async () => {
  renderTema({
    'GET /api/topics/tp_1': () =>
      jsonResponse({ code: 'not_found', message_es: '' }, 404),
  });

  expect(await screen.findByText(s.notFoundTitle)).toBeVisible();
  expect(screen.getByRole('link', { name: s.back })).toHaveAttribute(
    'href',
    '/temas',
  );
  expect(screen.getByRole('link', { name: 'Volver' })).toHaveAttribute(
    'href',
    '/temas',
  );
});

test('la pestaña activa tiene aria-selected y un indicador de 2 px', async () => {
  renderTema();

  const active = await screen.findByRole('tab', { name: 'Resumen' });
  expect(active).toHaveAttribute('aria-selected', 'true');
  expect(active.closest('.topic-tabs')).not.toBeNull();
  expect(screen.getByRole('tab', { name: 'Clases' })).toHaveAttribute(
    'aria-selected',
    'false',
  );
  expect(temasCss).toContain(".topic-tabs [role='tab'][aria-selected='true']");
  expect(temasCss).toContain('box-shadow: inset 0 -2px 0 var(--c-accent)');
});

test('clases no lanza más de 4 peticiones a la vez', async () => {
  const itemIds = Array.from({ length: 10 }, (_, index) => `it_${index + 1}`);
  let active = 0;
  let maxActive = 0;
  const routes: Record<string, unknown> = {};

  for (const [index, itemId] of itemIds.entries()) {
    routes[`GET /api/items/${itemId}`] = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return jsonResponse(itemDetail(itemId, index + 1));
    };
  }

  renderScreen(<TopicItems itemIds={itemIds} />, { routes });

  expect(await screen.findByText('Clase 10')).toBeVisible();
  expect(maxActive).toBeGreaterThan(1);
  expect(maxActive).toBeLessThanOrEqual(4);
});

test('muestra carga, vacío y error con reintentar', async () => {
  renderTema({
    'GET /api/topics/tp_1': () => new Promise<Response>(() => undefined),
  });
  expect(screen.getByRole('status')).toHaveTextContent('Cargando');
  cleanup();

  renderTema({
    'GET /api/topics/tp_1': {
      ...TOPIC,
      item_ids: [],
      card_count: 0,
      description_es: '',
    },
  });
  expect(
    await screen.findByText('Este tema todavía no tiene contenido.'),
  ).toBeVisible();
  cleanup();

  let calls = 0;
  renderTema({
    'GET /api/topics/tp_1': () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ code: 'boom', message_es: 'Fallo del tema' }, 500)
        : jsonResponse(TOPIC);
    },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('Fallo del tema');
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: 'Le passé composé',
    }),
  ).toBeVisible();
});

test('con datos guardados avisa sin conexión', async () => {
  renderTema({}, { online: false });

  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: 'Le passé composé',
    }),
  ).toBeVisible();
  expect(screen.getByText(/Sin conexión: datos guardados/)).toBeVisible();
});
