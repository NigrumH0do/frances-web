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
  CourseOut,
  StudyTopic,
  TopicProgress,
} from '../../contracts/generated';
import { closeV2DbForTests } from '../../offline/db';
import { renderScreen } from '../../shell/testing';
import Temas from './Temas';

const temasCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'temas.css'),
  'utf8',
);

const COURSE: CourseOut = {
  id: 'c_1',
  name: 'Français A2',
  section: 'Grupo 1',
};

const COURSE_B1: CourseOut = {
  id: 'c_2',
  name: 'Français B1',
  section: null,
};

const TOPIC_PASSE: StudyTopic = {
  id: 'tp_1',
  course_id: 'c_1',
  title: 'Le passé composé',
  description_es: 'Pasado para acciones terminadas.',
  cefr: 'A2',
  position: 1,
  item_ids: ['it_1', 'it_2', 'it_3', 'it_4'],
  card_count: 100,
  edited_by_human: false,
  source_changed: false,
};

const TOPIC_SUBJONCTIF: StudyTopic = {
  id: 'tp_2',
  course_id: 'c_1',
  title: 'Le subjonctif présent',
  description_es: 'El subjuntivo presente.',
  cefr: 'B1',
  position: 2,
  item_ids: ['it_5'],
  card_count: 12,
  edited_by_human: false,
  source_changed: true,
};

const TOPIC_VILLE: StudyTopic = {
  id: 'tp_3',
  course_id: 'c_1',
  title: 'Décrire sa ville',
  description_es: 'Describir la ciudad.',
  cefr: 'A2',
  position: 3,
  item_ids: ['it_6', 'it_7', 'it_8'],
  card_count: 20,
  edited_by_human: true,
  source_changed: false,
};

const TOPIC_ARTICLES: StudyTopic = {
  id: 'tp_4',
  course_id: 'c_2',
  title: 'Les articles définis',
  description_es: 'Los artículos definidos.',
  cefr: 'A1',
  position: 1,
  item_ids: ['it_9'],
  card_count: 8,
  edited_by_human: false,
  source_changed: false,
};

const PROGRESS: TopicProgress[] = [
  {
    topic_id: 'tp_1',
    cards_total: 100,
    cards_learned: 45,
    last_quiz_score: 0.8,
  },
  {
    topic_id: 'tp_2',
    cards_total: 12,
    cards_learned: 0,
    last_quiz_score: null,
  },
  {
    topic_id: 'tp_3',
    cards_total: 20,
    cards_learned: 11,
    last_quiz_score: 0.75,
  },
];

const PROGRESS_B1: TopicProgress[] = [
  {
    topic_id: 'tp_4',
    cards_total: 8,
    cards_learned: 0,
    last_quiz_score: null,
  },
];

function baseRoutes(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    'GET /api/courses': [COURSE],
    'GET /api/topics?course_id=c_1': [
      TOPIC_PASSE,
      TOPIC_SUBJONCTIF,
      TOPIC_VILLE,
    ],
    'GET /api/me/topic-progress?course_id=c_1': PROGRESS,
    ...overrides,
  };
}

function renderTemas(
  opts: {
    path?: string;
    overrides?: Record<string, unknown>;
    online?: boolean;
  } = {},
) {
  return renderScreen(<Temas />, {
    path: opts.path ?? '/temas',
    online: opts.online,
    routes: baseRoutes(opts.overrides),
  });
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('filtra por nivel y búsqueda y muestra el progreso en texto', async () => {
  renderTemas();

  await userEvent.click(
    await screen.findByRole('button', { name: 'B1', pressed: false }),
  );
  expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
    expect.stringContaining('Le subjonctif présent'),
  ]);

  await userEvent.click(screen.getByRole('button', { name: 'Todos' }));
  await userEvent.type(
    screen.getByRole('searchbox', { name: 'Buscar temas' }),
    'passé',
  );

  const progress = screen.getByRole('progressbar', {
    name: /Le passé composé/,
  });
  expect(progress).toHaveAttribute('aria-valuenow', '45');
  expect(screen.getByText('45 %')).toBeVisible();
});

test('el filtro no oculta el tema activo sin decirlo', async () => {
  renderTemas({ path: '/temas?tema=tp_2' });

  await screen.findByRole('link', { name: /Le subjonctif présent/ });
  expect(
    screen.queryByText(/temas ocultos por el filtro/),
  ).not.toBeInTheDocument();

  await userEvent.type(
    screen.getByRole('searchbox', { name: 'Buscar temas' }),
    'passé',
  );

  expect(
    screen.queryByRole('link', { name: /Le subjonctif présent/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('2 temas ocultos por el filtro')).toBeVisible();
  expect(
    screen.getByText(
      'El tema activo «Le subjonctif présent» está oculto por el filtro.',
    ),
  ).toBeVisible();
});

test('muestra carga, vacío y error con reintentar', async () => {
  renderTemas({
    overrides: {
      'GET /api/topics?course_id=c_1': () =>
        new Promise<Response>(() => undefined),
    },
  });
  expect(screen.getByRole('status')).toHaveTextContent('Cargando');
  cleanup();

  renderTemas({
    overrides: { 'GET /api/topics?course_id=c_1': [] },
  });
  expect(
    await screen.findByText('Todavía no hay temas para este curso.'),
  ).toBeVisible();
  cleanup();

  let calls = 0;
  renderTemas({
    overrides: {
      'GET /api/topics?course_id=c_1': () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ code: 'boom', message_es: 'Fallo de temas' }, 500)
          : jsonResponse([TOPIC_PASSE]);
      },
    },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('Fallo de temas');
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Le passé composé')).toBeVisible();
});

test('con datos guardados avisa sin conexión', async () => {
  renderTemas({ online: false });

  expect(await screen.findByText('Le passé composé')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Sin conexión: datos guardados.',
  );
});

test('con varios cursos recuerda la elección en localStorage', async () => {
  const routes = {
    'GET /api/courses': [COURSE, COURSE_B1],
    'GET /api/topics?course_id=c_1': [TOPIC_PASSE],
    'GET /api/me/topic-progress?course_id=c_1': [PROGRESS[0]],
    'GET /api/topics?course_id=c_2': [TOPIC_ARTICLES],
    'GET /api/me/topic-progress?course_id=c_2': PROGRESS_B1,
  };

  renderScreen(<Temas />, { path: '/temas', routes });

  expect(
    await screen.findByRole('radiogroup', { name: 'Curso' }),
  ).toBeVisible();
  await userEvent.click(screen.getByRole('radio', { name: 'Français B1' }));
  expect(await screen.findByText('Les articles définis')).toBeVisible();
  expect(localStorage.getItem('fc-course')).toBe('c_2');

  cleanup();
  renderScreen(<Temas />, { path: '/temas', routes });
  expect(
    await screen.findByRole('radio', { name: 'Français B1' }),
  ).toHaveAttribute('aria-checked', 'true');
  expect(await screen.findByText('Les articles définis')).toBeVisible();
});

test('el filtro Todos está pulsado, la fila activa se marca y cada tema dice su dominio', async () => {
  renderTemas({
    path: '/temas?tema=tp_1',
    overrides: {
      'GET /api/me/topic-progress?course_id=c_1': [
        PROGRESS[0],
        PROGRESS[1],
        {
          ...PROGRESS[2],
          cards_learned: 20,
          cards_total: 20,
          last_quiz_score: null,
        },
      ],
    },
  });

  const todos = await screen.findByRole('button', { name: 'Todos' });
  expect(todos).toHaveAttribute('aria-pressed', 'true');

  const active = screen.getByRole('link', { name: /Le passé composé/ });
  expect(active).toHaveAttribute('aria-current', 'true');
  expect(active).toHaveClass('is-active');
  expect(active).toHaveTextContent('en curso');

  const pending = screen.getByRole('link', { name: /Le subjonctif présent/ });
  expect(pending).not.toHaveAttribute('aria-current');
  expect(pending).not.toHaveClass('is-active');
  expect(pending).toHaveTextContent('por hacer');

  const done = screen.getByRole('link', { name: /Décrire sa ville/ });
  expect(done).toHaveTextContent('al día');

  const icons = [active, pending, done].map((link) => {
    const icon = link.querySelector('.mastery svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    return icon?.innerHTML ?? '';
  });
  expect(new Set(icons).size).toBe(3);

  await userEvent.click(screen.getByRole('button', { name: 'B1' }));
  expect(todos).toHaveAttribute('aria-pressed', 'false');
});

test('la fila activa usa la tarjeta elevada y no baja de 44 px', () => {
  expect(temasCss).toMatch(
    /\.is-active[^{]*\{[^}]*background:\s*var\(--c-card-raised\)/,
  );
  expect(temasCss).toMatch(/min-height:\s*var\(--tap\)/);
  expect(temasCss).toMatch(/--c-text-muted/);
  expect(temasCss).toMatch(/--c-warning/);
  expect(temasCss).toMatch(/--c-success/);
  expect(temasCss).toMatch(/tabular-nums/);
});
