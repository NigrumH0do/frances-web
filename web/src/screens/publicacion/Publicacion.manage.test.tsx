import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type {
  CardPage,
  CardView,
  ItemDetail,
  ItemSummary,
  UserOut,
} from '../../contracts/generated';
import { ME_ADMIN, ME_USER, renderScreen } from '../../shell/testing';
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
  due_at: null,
  n_attachments: 0,
  n_cards: 1,
  has_sheet: false,
};

const CARD: CardView = {
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
  audio: [],
  audio_pending: [],
  owner: 'shared',
  edited_by_human: false,
  source_changed: false,
  mine: null,
  state: null,
};

const PAGE: CardPage = {
  cards: [CARD],
  next_cursor: null,
};

const DETAIL: ItemDetail = {
  item: ITEM,
  text: 'Bonjour !',
  alternate_link: null,
  attachments: [],
  card_ids: ['card-1'],
  sheet: null,
};

function renderPublicacion(user: Partial<UserOut> = ME_USER) {
  return renderScreen(<Publicacion />, {
    user,
    path: '/publicaciones/cw_1',
    pattern: '/publicaciones/:itemId',
    routes: {
      'GET /api/items/cw_1': DETAIL,
      'GET /api/cards?item_id=cw_1': PAGE,
      'GET /api/quizzes?scope_id=cw_1&scope_kind=item': [],
    },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('Publicacion muestra nueva tarjeta y editar mi copia al usuario', async () => {
  renderPublicacion();

  expect(
    await screen.findByRole('button', { name: 'Nueva tarjeta' }),
  ).toBeVisible();
  expect(
    (await screen.findAllByRole('button', { name: 'Editar mi copia' })).length,
  ).toBeGreaterThan(0);
  expect(
    screen.queryByRole('button', { name: /tarjeta compartida/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /Regenerar tarjetas/ }),
  ).not.toBeInTheDocument();
});

test('admin ve editar tarjeta compartida en la publicación', async () => {
  renderPublicacion(ME_ADMIN);

  expect(
    await screen.findByRole('button', { name: 'Editar tarjeta compartida' }),
  ).toBeVisible();
});

test('Nueva tarjeta abre el diálogo de creación', async () => {
  renderPublicacion();

  await userEvent.click(
    await screen.findByRole('button', { name: 'Nueva tarjeta' }),
  );

  expect(await screen.findByLabelText('Francés')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Crear tarjeta' })).toBeVisible();
});
