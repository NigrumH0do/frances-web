import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  ItemSummary,
  StudyPlanDay,
  StudyStatus,
  UserStats,
} from '../../contracts/generated';
import { jsonResponse } from '../../api/testing';
import { closeV2DbForTests } from '../../offline/db';
import { pendingCount } from '../../offline/outbox';
import { renderScreen } from '../../shell/testing';
import { Hoy } from './Hoy';

// La suite completa de la web crea muchas instancias de jsdom; estos tests
// esperan IndexedDB y no deben fallar por la carga del runner.
vi.setConfig({ testTimeout: 15_000 });

const PLAN: StudyPlanDay = {
  day: '2026-11-02',
  generated_at: '2026-11-02T11:00:00.000Z',
  entries: [
    {
      position: 1,
      kind: 'review',
      ref_id: 'deck_1',
      title_es: 'Repasar 18 tarjetas',
      reason_es: '12 vencidas · 6 nuevas',
      why_llm_es: 'El miércoles entregas la redacción.',
      done: false,
    },
    {
      position: 2,
      kind: 'quiz',
      ref_id: 'qz_1',
      title_es: 'Quiz: Le passé composé',
      reason_es: '8 preguntas',
      why_llm_es: null,
      done: false,
    },
    {
      position: 3,
      kind: 'read',
      ref_id: 'it_1',
      title_es: 'Leer la ficha «Leçon 7»',
      reason_es: 'Resumen y vocabulario',
      why_llm_es: null,
      done: false,
    },
    {
      position: 4,
      kind: 'drill',
      ref_id: null,
      title_es: 'Practicar pronunciación',
      reason_es: '5 frases',
      why_llm_es: null,
      done: false,
    },
  ],
};

const PLAN_EMPTY: StudyPlanDay = {
  day: '2026-11-06',
  generated_at: '2026-11-06T11:00:00.000Z',
  entries: [],
};

const STATS: UserStats = {
  cards_learned: 42,
  due_now: 18,
  reviews_today: 12,
  retention_30d: 0.9,
  streak_days: 6,
  week: [
    { day: '2026-11-02', reviews: 2, quiz_attempts: 1 },
    { day: '2026-11-03', reviews: 4, quiz_attempts: 0 },
    { day: '2026-11-04', reviews: 0, quiz_attempts: 1 },
    { day: '2026-11-05', reviews: 3, quiz_attempts: 0 },
    { day: '2026-11-06', reviews: 5, quiz_attempts: 1 },
    { day: '2026-11-07', reviews: 0, quiz_attempts: 0 },
    { day: '2026-11-08', reviews: 0, quiz_attempts: 0 },
  ],
  quiz_best: [],
};

const STATS_ZERO: UserStats = {
  ...STATS,
  cards_learned: 0,
  due_now: 0,
  reviews_today: 0,
  retention_30d: null,
  streak_days: 0,
  week: STATS.week.map((day) => ({
    ...day,
    reviews: 0,
    quiz_attempts: 0,
  })) as UserStats['week'],
};

const STATUS: StudyStatus = {
  llm_enabled: true,
  llm_calls_today: 3,
  llm_calls_cap: 300,
  pending: {
    'index.text_blocks': 0,
    'llm.sheet': 0,
    'llm.topics': 0,
    'llm.quiz': 0,
    'plan.daily': 0,
  },
  last_topics_at: null,
  last_plan_at: null,
};

const DUE_ITEM: ItemSummary = {
  id: 'it_1',
  course_id: 'c_1',
  kind: 'coursework',
  topic_id: null,
  title: 'Rédaction « Mon dernier week-end »',
  text_lang: 'fr',
  created_at: '2026-11-01T10:00:00.000Z',
  updated_at: '2026-11-01T10:00:00.000Z',
  first_seen_at: '2026-11-01T10:00:00.000Z',
  due_at: '2026-11-08T23:59:00.000Z',
  n_attachments: 1,
  n_cards: 3,
  has_sheet: true,
};

const OTHER_ITEM: ItemSummary = {
  ...DUE_ITEM,
  id: 'it_2',
  title: 'Lecture suivante',
  due_at: '2026-11-10T23:59:00.000Z',
};

function routes(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    'GET /api/plan/today': PLAN,
    'GET /api/me/stats': STATS,
    'GET /api/me/upcoming': [DUE_ITEM, OTHER_ITEM],
    'GET /api/study/status': STATUS,
    ...overrides,
  };
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  // 10:00 en Bogotá (UTC-5).
  vi.setSystemTime(new Date('2026-11-06T15:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('lista el plan con enlaces por tipo y marca hecho', async () => {
  const { transport } = renderScreen(<Hoy />, {
    routes: routes({
      'POST /api/plan/2026-11-02/1/done': {
        ...PLAN.entries[0],
        done: true,
      },
    }),
  });

  expect(
    await screen.findByRole('link', { name: /Repasar 18 tarjetas/ }),
  ).toHaveAttribute('href', '/repasar');
  expect(
    screen.getByRole('link', { name: /Quiz: Le passé composé/ }),
  ).toHaveAttribute('href', '/quiz/qz_1');
  expect(
    screen.getByRole('link', { name: /Leer la ficha «Leçon 7»/ }),
  ).toHaveAttribute('href', '/publicaciones/it_1');
  expect(
    screen.getByRole('link', { name: /Practicar pronunciación/ }),
  ).toHaveAttribute('href', '/repasar/pronunciacion');

  await userEvent.click(
    screen.getAllByRole('checkbox', { name: 'Hecho' })[0] as HTMLElement,
  );

  await waitFor(() =>
    expect(transport.calls.at(-1)?.url).toBe('/api/plan/2026-11-02/1/done'),
  );
  expect(screen.getByText('1 de 4 hecho')).toBeVisible();
});

test('el «por qué» del LLM se marca como IA y no aparece si es null', async () => {
  renderScreen(<Hoy />, { routes: routes() });

  expect(
    await screen.findByText('El miércoles entregas la redacción.'),
  ).toBeVisible();
  expect(screen.getAllByText('IA')).toHaveLength(1);
});

test('desmarcar hecho llama a DELETE y deshace el progreso', async () => {
  const donePlan: StudyPlanDay = {
    ...PLAN,
    entries: [{ ...PLAN.entries[0], done: true }, ...PLAN.entries.slice(1)],
  };
  const { transport } = renderScreen(<Hoy />, {
    routes: routes({
      'GET /api/plan/today': donePlan,
      'DELETE /api/plan/2026-11-02/1/done': {
        ...PLAN.entries[0],
        done: false,
      },
    }),
  });

  const checkbox = (
    await screen.findAllByRole('checkbox', { name: 'Hecho' })
  )[0] as HTMLElement;
  expect(checkbox).toBeChecked();
  expect(screen.getByText('1 de 4 hecho')).toBeVisible();

  await userEvent.click(checkbox);

  await waitFor(() =>
    expect(transport.calls.at(-1)).toMatchObject({
      method: 'DELETE',
      url: '/api/plan/2026-11-02/1/done',
    }),
  );
  expect(screen.getByText('0 de 4 hecho')).toBeVisible();
});

test('plan vacío con trabajos pendientes muestra «Generando tu material»', async () => {
  renderScreen(<Hoy />, {
    routes: routes({
      'GET /api/plan/today': PLAN_EMPTY,
      'GET /api/me/upcoming': [],
      'GET /api/study/status': {
        ...STATUS,
        pending: { ...STATUS.pending, 'llm.sheet': 2 },
      },
    }),
  });

  expect(await screen.findByText('Generando tu material…')).toBeVisible();
});

test('sin red marcar hecho va a la cola', async () => {
  const { transport, user } = renderScreen(<Hoy />, {
    online: false,
    routes: routes(),
  });

  const checkbox = (
    await screen.findAllByRole('checkbox', { name: 'Hecho' })
  )[0] as HTMLElement;
  await userEvent.click(checkbox);

  expect(checkbox).toBeChecked();
  expect(screen.getByText('1 de 4 hecho')).toBeVisible();
  await waitFor(async () => {
    expect(await pendingCount(user.id)).toBe(1);
  });
  expect(transport.calls.filter((call) => call.method === 'POST')).toHaveLength(
    0,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Sin conexión');
});

test('muestra carga, vacío y error con reintentar', async () => {
  renderScreen(<Hoy />, {
    routes: routes({
      'GET /api/plan/today': () => new Promise<Response>(() => undefined),
    }),
  });
  expect(screen.getByRole('status')).toHaveTextContent('Cargando…');
  cleanup();

  renderScreen(<Hoy />, {
    routes: routes({
      'GET /api/plan/today': PLAN_EMPTY,
      'GET /api/me/stats': STATS_ZERO,
      'GET /api/me/upcoming': [],
    }),
  });
  expect(await screen.findByText('No hay tareas para hoy.')).toBeVisible();
  cleanup();

  let attempts = 0;
  renderScreen(<Hoy />, {
    routes: routes({
      'GET /api/plan/today': () => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ code: 'boom', message_es: 'Fallo del plan' }, 500)
          : jsonResponse(PLAN);
      },
    }),
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('Fallo del plan');
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(
    await screen.findByRole('link', { name: /Repasar 18 tarjetas/ }),
  ).toBeVisible();
});

test('con datos guardados avisa sin conexión', async () => {
  renderScreen(<Hoy />, { online: false, routes: routes() });

  expect(
    await screen.findByRole('link', { name: /Repasar 18 tarjetas/ }),
  ).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Sin conexión: datos guardados.',
  );
});

test('muestra saludo, racha, primera entrega y la semana', async () => {
  renderScreen(<Hoy />, { routes: routes() });

  expect(
    await screen.findByRole(
      'heading',
      { name: 'Buenos días, Ana' },
      { timeout: 5000 },
    ),
  ).toBeVisible();
  expect(screen.getByText('6 días')).toBeVisible();
  expect(
    screen.getByRole('link', {
      name: 'Rédaction « Mon dernier week-end »',
    }),
  ).toHaveAttribute('href', '/publicaciones/it_1');
  expect(screen.queryByText('Lecture suivante')).not.toBeInTheDocument();
  expect(screen.getByText(/Vence .* en 2 días/)).toBeVisible();
  expect(screen.getByText(/Actividad de la semana/)).toHaveTextContent(
    'viernes',
  );
  const weekCounts = document.querySelector('.week-counts');
  expect(weekCounts).not.toBeNull();
  expect(
    Array.from(weekCounts?.children ?? []).map((el) => el.textContent),
  ).toEqual(['3', '4', '1', '3', '6', '0', '0']);
});
