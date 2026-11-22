import '@testing-library/jest-dom/vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const publicacionDir = dirname(fileURLToPath(import.meta.url));
const publicacionCss = readFileSync(
  join(publicacionDir, 'publicacion.css'),
  'utf8',
);

function rulesTouching(source: string, selectorPart: string): string {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const parts: string[] = [];
  for (const match of noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((match[1] as string).includes(selectorPart)) {
      parts.push(`${match[1] ?? ''}{${match[2] ?? ''}}`);
    }
  }
  return parts.join('\n');
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

  const citedPage = await screen.findByText('Página 2 de 3');
  expect(citedPage).toBeVisible();
  expect(screen.getByText('Página 1 de 3')).toBeVisible();
  const bar = citedPage.closest('.pdf-toolbar');
  expect(bar).not.toBeNull();
  expect(bar?.parentElement?.closest('.is-cited')).not.toBeNull();
});

test('el encabezado de material precede al de tarjetas en el DOM', async () => {
  renderPublicacion();

  const material = await screen.findByRole('heading', {
    level: 2,
    name: 'Adjuntos',
  });
  const cards = screen.getByRole('heading', { level: 2, name: 'Tarjetas' });
  expect(
    material.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test('un error de tarjetas deja el visor vivo y el reintento en la ficha', async () => {
  renderPublicacion('/publicaciones/cw_1', {
    'GET /api/cards?item_id=cw_1': () =>
      jsonResponse({ code: 'internal', message_es: '' }, 500),
  });

  expect(
    await screen.findByRole('img', { name: /Página 1 de 3/ }),
  ).toBeVisible();
  const cards = screen
    .getByRole('heading', { level: 2, name: 'Tarjetas' })
    .closest('section');
  expect(cards).not.toBeNull();
  const ficha = within(cards as HTMLElement);
  expect(await ficha.findByRole('alert')).toBeVisible();
  expect(ficha.getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

test('publicacion.css acota el canvas del PDF a su columna', () => {
  // B5 (LIVE-A2 H-A): la figura, el host y el canvas nunca son más anchos que
  // la columna; a escala <= 1 el CSS recorta y con zoom el paneo queda dentro
  // de `.pdf-page`, sin solaparse con la ficha sticky.
  const figure = rulesTouching(publicacionCss, '.pdf-figure');
  expect(figure).toContain('margin: 0');
  expect(figure).toContain('max-width: 100%');
  expect(figure).toContain('min-width: 0');

  const page = rulesTouching(publicacionCss, '.pdf-page');
  expect(page).toContain('max-width: 100%');
  expect(page).toContain('overflow-x: auto');

  const canvas = rulesTouching(publicacionCss, '.pdf-canvas');
  expect(canvas).toContain('display: block');
  expect(canvas).toContain('height: auto');
  expect(canvas).toMatch(/\.pdf-canvas\.is-fit\s*\{/);
  expect(canvas).toContain('max-width: 100%');

  // Un hijo ancho no puede expandir la pista `minmax(0, …fr)` del split.
  const children = publicacionCss.match(/\.pub-split\s*>\s*\*\s*\{([^}]*)\}/);
  expect(children).not.toBeNull();
  expect(children?.[1] ?? '').toContain('min-width: 0');
});

test('publicacion.css no reordena .pub-split y deja la ficha sticky', () => {
  expect(publicacionCss).toContain('@media (min-width: 960px)');
  expect(publicacionCss).not.toMatch(/min-width:\s*900px/);
  expect(publicacionCss).not.toMatch(/min-width:\s*1100px/);

  const split = rulesTouching(publicacionCss, '.pub-split');
  expect(split).toContain(
    'grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr)',
  );
  expect(split).not.toMatch(/(^|[^a-zA-Z-])order\s*:/);

  const second = split.match(/\.pub-split\s*>\s*:nth-child\(2\)\s*\{([^}]*)\}/);
  expect(second).not.toBeNull();
  const column = second?.[1] ?? '';
  expect(column).toContain('position: sticky');
  expect(column).toContain('top: var(--sp-4)');
  expect(column).toContain('align-self: start');

  const cited = publicacionCss.match(
    /\.is-cited\s+\.pdf-toolbar\s*\{([^}]*)\}/,
  );
  expect(cited).not.toBeNull();
  const flash = cited?.[1] ?? '';
  expect(flash).toMatch(/background:\s*var\(--c-accent-soft\)/);
  expect(flash).not.toMatch(/transition\s*:/);
  expect(publicacionCss).not.toMatch(/--c-gold-3d/);
  expect(publicacionCss).not.toMatch(/transition\s*:/);
});

// Bloque de una `@media` concreta, sin comentarios y con llaves equilibradas.
function mediaBlock(source: string, query: string): string {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = clean.indexOf(query);
  if (at < 0) {
    return '';
  }
  const open = clean.indexOf('{', at);
  if (open < 0) {
    return '';
  }
  let depth = 0;
  for (let i = open; i < clean.length; i += 1) {
    if (clean[i] === '{') {
      depth += 1;
    } else if (clean[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return clean.slice(open + 1, i);
      }
    }
  }
  return '';
}

const IMG_SHA = 'c'.repeat(64);
const IMG_URL = `/api/files/${IMG_SHA}`;

const IMG_ATT: AttachmentView = {
  id: 'att_img',
  kind: 'drive_file',
  title: 'Tableau de conjugaison',
  url: null,
  mime_type: 'image/png',
  status: 'downloaded',
  file: { url: IMG_URL, size: 2048, mime: 'image/png', sha256: IMG_SHA },
  view_pdf: null,
};

function imageResponse(): Response {
  return new Response(new Uint8Array([137, 80, 78, 71]), {
    headers: { 'Content-Type': 'image/png' },
  });
}

test('la imagen adjunta lleva .att-image y acota su ancho en móvil', async () => {
  // REVERIFY-2: sin `max-width` el <img> de 800 px desbordaba `#main` en móvil
  // de 390 px (scrollWidth 816 > clientWidth 390).
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:att-image');
  renderPublicacion('/publicaciones/cw_1', {
    'GET /api/items/cw_1': {
      ...ITEM_DETAIL,
      attachments: [PDF_ATT, IMG_ATT],
    },
    [`GET ${IMG_URL}`]: imageResponse,
  });

  const img = await screen.findByRole('img', {
    name: 'Tableau de conjugaison',
  });
  expect(img.tagName).toBe('IMG');
  expect(img).toHaveClass('att-image');

  const rule = publicacionCss.match(
    /\.att-image\s*,\s*\.pub-split\s+img\s*\{([^}]*)\}/,
  );
  expect(rule).not.toBeNull();
  const body = rule?.[1] ?? '';
  expect(body).toContain('display: block');
  expect(body).toContain('max-width: 100%');
  expect(body).toContain('height: auto');

  // La acotación vale en móvil, así que no puede vivir solo en la `@media`
  // de escritorio.
  expect(mediaBlock(publicacionCss, '@media (min-width: 960px)')).not.toContain(
    '.att-image',
  );
});

test('la ficha sticky acota su alto y desplaza por dentro en el split', () => {
  // REVERIFY-2: con la ficha (18.580 px) más alta que los PDFs de la izquierda
  // (3.455 px) la fila del grid medía lo de la ficha y `position: sticky` no
  // tenía recorrido; el alto máximo con `100dvh` más el scroll interno la
  // mantienen fija junto al material.
  const media = mediaBlock(publicacionCss, '@media (min-width: 960px)');
  expect(media).not.toBe('');
  const second = media.match(/\.pub-split\s*>\s*:nth-child\(2\)\s*\{([^}]*)\}/);
  expect(second).not.toBeNull();
  const column = second?.[1] ?? '';
  expect(column).toContain('position: sticky');
  expect(column).toContain('top: var(--sp-4)');
  expect(column).toContain('align-self: start');
  expect(column).toContain('max-height: calc(100dvh - var(--sp-8))');
  expect(column).toContain('overflow-y: auto');
});
