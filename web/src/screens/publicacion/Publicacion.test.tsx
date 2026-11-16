import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { jsonResponse, offline } from '../../api/testing';
import type {
  AttachmentView,
  CardPage,
  CardView,
  FileLink,
  ItemDetail,
  ItemSummary,
  Quiz,
  StudySheet,
  UserPrefs,
  VoiceOut,
} from '../../contracts/generated';
import { renderScreen } from '../../shell/testing';
import Publicacion from './Publicacion';

vi.mock('pdfjs-dist', () => {
  const page = {
    getViewport: () => ({ width: 100, height: 100 }),
    render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
  };
  return {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: () => Promise.resolve(page),
      }),
    }),
  };
});

const SHA = 'a'.repeat(64);
const SHA_2 = 'b'.repeat(64);
const PDF_URL = `/api/files/${SHA}`;
const PDF_URL_2 = `/api/files/${SHA_2}`;

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

const PDF_FILE: FileLink = {
  url: PDF_URL,
  size: 1234,
  mime: 'application/pdf',
  sha256: SHA,
};

const PDF_FILE_2: FileLink = {
  url: PDF_URL_2,
  size: 4321,
  mime: 'application/pdf',
  sha256: SHA_2,
};

const PDF_ATT: AttachmentView = {
  id: 'att_1',
  kind: 'drive_file',
  title: 'Leçon 7',
  url: null,
  mime_type: 'application/pdf',
  status: 'downloaded',
  file: PDF_FILE,
  view_pdf: null,
};

const PDF_ATT_2: AttachmentView = {
  ...PDF_ATT,
  id: 'att_2',
  title: 'Annexe',
  file: PDF_FILE_2,
};

const ITEM: ItemSummary = {
  id: 'cw_1',
  course_id: 'c_1',
  kind: 'coursework',
  topic_id: 'tp_1',
  title: 'Leçon 7 — Le passé composé',
  text_lang: 'fr',
  created_at: '2026-10-27T14:00:00.000Z',
  updated_at: '2026-10-28T15:30:00.000Z',
  first_seen_at: '2026-10-27T14:00:00.000Z',
  due_at: '2026-11-04T23:59:00.000Z',
  n_attachments: 1,
  n_cards: 2,
  has_sheet: true,
};

const CARD_1: CardView = {
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

const CARD_2: CardView = {
  ...CARD_1,
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

const CARD_PAGE: CardPage = {
  cards: [CARD_1, CARD_2],
  next_cursor: null,
};

const ITEM_DETAIL: ItemDetail = {
  item: ITEM,
  text: 'Bonjour !\nAujourd’hui, nous étudions le passé composé.',
  alternate_link: 'https://classroom.google.com/c/c_1/a/cw_1',
  attachments: [PDF_ATT],
  card_ids: ['card-1', 'card-2'],
  sheet: SHEET,
};

function pdfResponse(): Response {
  return new Response(new Uint8Array([37, 80, 68, 70]), {
    headers: { 'Content-Type': 'application/pdf' },
  });
}

function baseRoutes(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    'GET /api/items/cw_1': ITEM_DETAIL,
    'GET /api/cards?item_id=cw_1': CARD_PAGE,
    'GET /api/quizzes?scope_id=cw_1&scope_kind=item': [],
    'GET /api/voices': VOICES,
    'GET /api/me/prefs': PREFS,
    [`GET ${PDF_URL}`]: pdfResponse,
    [`GET ${PDF_URL_2}`]: pdfResponse,
    ...overrides,
  };
}

function renderPublicacion(
  path = '/publicaciones/cw_1',
  overrides: Record<string, unknown> = {},
) {
  return renderScreen(<Publicacion />, {
    path,
    pattern: '/publicaciones/:itemId',
    routes: baseRoutes(overrides),
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('muestra texto, PDF en la página pedida, ficha y tarjetas', async () => {
  renderPublicacion('/publicaciones/cw_1?pagina=3');

  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: ITEM_DETAIL.item.title as string,
    }),
  ).toBeVisible();
  expect(
    await screen.findByRole('img', { name: /Página 3 de 3/ }),
  ).toBeVisible();
  expect(screen.getByText(/Aujourd’hui, nous étudions/)).toHaveClass('fr');
  expect(screen.getByText('Pasado para acciones terminadas.')).toBeVisible();
  expect(
    screen.getAllByText('Je suis allée au cinéma.').length,
  ).toBeGreaterThan(0);
  expect(screen.getAllByRole('button', { name: 'Reproducir' })).toHaveLength(4);

  const link = screen.getByRole('link', { name: 'Abrir en Classroom' });
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(link).toHaveAttribute(
    'href',
    'https://classroom.google.com/c/c_1/a/cw_1',
  );
  expect(link).toHaveAttribute('target', '_blank');
});

test('lista los quizzes de la publicación con su enlace de inicio', async () => {
  const quiz: Quiz = {
    id: 'qz_1',
    scope_kind: 'item',
    scope_id: 'cw_1',
    title_es: 'Quiz de la lección',
    questions: [
      {
        id: 'q_1',
        kind: 'mcq',
        prompt_es: 'Elige la forma correcta.',
        prompt_fr: null,
        options: ['Je suis allé', "J'ai allé"],
        audio: null,
        source_item_id: 'cw_1',
      },
    ],
    stale: false,
  };
  renderPublicacion('/publicaciones/cw_1', {
    'GET /api/quizzes?scope_id=cw_1&scope_kind=item': [quiz],
  });

  expect(await screen.findByText('Quiz de la lección')).toBeVisible();
  expect(screen.getByText('1 pregunta')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Empezar quiz' })).toHaveAttribute(
    'href',
    '/quiz/qz_1',
  );
});

test('sin ficha muestra «La ficha se está preparando»', async () => {
  renderPublicacion('/publicaciones/cw_1', {
    'GET /api/items/cw_1': {
      ...ITEM_DETAIL,
      sheet: null,
      item: { ...ITEM, has_sheet: false },
    },
  });

  expect(await screen.findByText('La ficha se está preparando')).toBeVisible();
});

test('muestra carga, vacío y error con reintentar', async () => {
  renderPublicacion('/publicaciones/cw_1', {
    'GET /api/items/cw_1': () => new Promise<Response>(() => undefined),
  });
  expect(screen.getByRole('status')).toHaveTextContent('Cargando…');
  cleanup();

  const emptyDetail: ItemDetail = {
    item: {
      ...ITEM,
      title: null,
      n_attachments: 0,
      n_cards: 0,
      has_sheet: false,
    },
    text: '',
    alternate_link: null,
    attachments: [],
    card_ids: [],
    sheet: null,
  };
  renderPublicacion('/publicaciones/cw_1', {
    'GET /api/items/cw_1': emptyDetail,
  });
  expect(
    await screen.findByText('Esta publicación no tiene texto ni adjuntos.'),
  ).toBeVisible();
  cleanup();

  let fail = true;
  renderPublicacion('/publicaciones/cw_1', {
    'GET /api/items/cw_1': () =>
      fail
        ? jsonResponse({ code: 'internal', message_es: '' }, 500)
        : jsonResponse(ITEM_DETAIL),
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Algo salió mal en el servidor',
  );
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: ITEM_DETAIL.item.title as string,
    }),
  ).toBeVisible();
});

test('con datos guardados avisa sin conexión', async () => {
  let withoutNetwork = false;
  renderPublicacion('/publicaciones/cw_1', {
    'GET /api/items/cw_1': () =>
      withoutNetwork ? offline()() : jsonResponse(ITEM_DETAIL),
  });

  await screen.findByRole('heading', {
    level: 1,
    name: ITEM_DETAIL.item.title as string,
  });
  withoutNetwork = true;
  await userEvent.click(
    screen.getByRole('button', { name: 'Actualizar publicación' }),
  );
  expect(
    await screen.findByText(/Sin conexión: datos guardados/),
  ).toBeVisible();
});

test('alternate_link solo se renderiza si es https://classroom.google.com/…', async () => {
  const cases: [string | null, boolean][] = [
    ['https://classroom.google.com/c/c_1/a/cw_1', true],
    ['http://classroom.google.com/c/c_1/a/cw_1', false],
    ['https://classroom.google.com.evil.test/c/c_1', false],
    ['https://evil.test/?next=https://classroom.google.com/c/c_1', false],
    ['https://classroom.google.com@evil.test/c/c_1', false],
    ['javascript:alert(1)', false],
    [null, false],
  ];

  for (const [link, visible] of cases) {
    renderPublicacion('/publicaciones/cw_1', {
      'GET /api/items/cw_1': { ...ITEM_DETAIL, alternate_link: link },
    });
    await screen.findByRole('heading', {
      level: 1,
      name: ITEM_DETAIL.item.title as string,
    });
    const anchor = screen.queryByRole('link', { name: 'Abrir en Classroom' });
    if (visible) {
      expect(anchor).toHaveAttribute('href', link as string);
    } else {
      expect(anchor).toBeNull();
    }
    cleanup();
  }
});

test('la página de la cita abre solo el adjunto citado', async () => {
  renderPublicacion('/publicaciones/cw_1?adjunto=att_2&pagina=2', {
    'GET /api/items/cw_1': {
      ...ITEM_DETAIL,
      attachments: [PDF_ATT, PDF_ATT_2],
    },
  });

  expect(await screen.findByText('Página 2 de 3')).toBeVisible();
  expect(screen.getByText('Página 1 de 3')).toBeVisible();
});
