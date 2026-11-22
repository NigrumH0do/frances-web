import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { setMotion3dPref } from '../../three/motionPref';
import { Hoy } from './Hoy';

const hoyCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'hoy.css'),
  'utf8',
);

function ruleFor(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let body = '';
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] as string)
      .split(',')
      .map((item) => item.trim());
    if (selectors.includes(selector)) body += match[2] as string;
  }
  return body;
}

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
  setMotion3dPref('auto');
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

  const review = await screen.findByRole('link', {
    name: /Repasar 18 tarjetas/,
  });
  expect(review).toHaveAttribute('href', '/repasar');
  expect(review.querySelector('.title')).not.toHaveClass('is-done');
  expect(document.querySelector('section.plan-list')).not.toBeNull();
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
  const doneLink = screen.getByRole('link', { name: /Repasar 18 tarjetas/ });
  expect(doneLink.querySelector('.title')).toHaveClass('is-done');
  expect(doneLink).not.toContainElement(
    screen.getAllByRole('checkbox', { name: 'Hecho' })[0] as HTMLElement,
  );
  expect(screen.getByText('Hecho')).toBeVisible();
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
  expect(screen.queryByText(/racha/)).not.toBeInTheDocument();
  expect(document.querySelector('.hoy-compass-slot')).toBeNull();
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

test('con 3D apagado la racha 0 sigue visible y el slot tiene svg', async () => {
  setMotion3dPref('off');
  renderScreen(<Hoy />, {
    routes: routes({ 'GET /api/me/stats': STATS_ZERO }),
  });

  expect(await screen.findByText('racha · 0 días')).toBeVisible();
  const slot = document.querySelector('.hoy-compass-slot');
  expect(slot?.querySelector('svg')).not.toBeNull();
  const chip = screen.getByText('racha · 0 días').closest('.chip');
  expect(chip).toHaveClass('chip-streak');
  expect(chip?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
});

test('muestra saludo, racha, primera entrega y la semana', async () => {
  setMotion3dPref('off');
  renderScreen(<Hoy />, { routes: routes() });

  expect(
    await screen.findByRole(
      'heading',
      { name: 'Buenos días, Ana' },
      { timeout: 5000 },
    ),
  ).toBeVisible();
  expect(screen.getByText('racha · 6 días')).toBeVisible();
  const slot = document.querySelector('.hoy-compass-slot');
  expect(slot?.querySelector('svg')).not.toBeNull();
  expect(
    screen.getByRole('link', { name: /Practica un texto tuyo/ }),
  ).toHaveAttribute('href', '/repasar/texto');
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
  const bars = document.querySelectorAll('.bars > span');
  expect(bars[4]).toHaveClass('is-today');
  expect(bars[4]).not.toHaveClass('is-empty');
  expect(bars[5]).toHaveClass('is-empty');
  expect(bars[6]).toHaveClass('is-empty');
  expect(bars[0]).not.toHaveClass('is-today');
  expect(screen.getByText(/Actividad de la semana/)).toHaveClass('sr-only');
});

test('hoy.css parte la rejilla en 960, mide el slot y traza el eje', () => {
  expect(hoyCss).toMatch(
    /@media\s*\(\s*min-width:\s*960px\s*\)\s*\{[^}]*\.hoy-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.2fr\)\s+minmax\(0,\s*1fr\)/,
  );
  const slot = ruleFor(hoyCss, '.hoy-compass-slot');
  expect(slot).toMatch(/width:\s*96px/);
  expect(slot).toMatch(/height:\s*96px/);
  expect(ruleFor(hoyCss, '.bars')).toMatch(
    /box-shadow:\s*inset\s+0\s+-1px\s+0\s+var\(--c-border-strong\)/,
  );
  expect(ruleFor(hoyCss, '.bars span')).toMatch(/opacity:\s*0\.8/);
  expect(ruleFor(hoyCss, '.bars span')).toMatch(/var\(--c-accent\)/);
  expect(ruleFor(hoyCss, '.bars span.is-today')).toMatch(/opacity:\s*1/);
  expect(ruleFor(hoyCss, '.bars span.is-empty')).toMatch(
    /background:\s*var\(--c-border\)/,
  );
  expect(ruleFor(hoyCss, '.week-counts')).toMatch(
    /font-variant-numeric:\s*tabular-nums/,
  );
  expect(ruleFor(hoyCss, '.week-counts')).toMatch(/gap:\s*var\(--sp-2\)/);
  expect(ruleFor(hoyCss, '.plan-list li')).toMatch(
    /min-height:\s*var\(--tap\)/,
  );
  const done = ruleFor(hoyCss, '.plan-list .check.done');
  expect(done).toMatch(/background:\s*transparent/);
  expect(done).toMatch(/border-color:\s*var\(--c-success\)/);
  expect(done).toMatch(/color:\s*var\(--c-success\)/);
  const title = ruleFor(hoyCss, '.plan-list .title.is-done');
  expect(title).toMatch(/text-decoration:\s*line-through/);
  expect(title).toMatch(/color:\s*var\(--c-text-muted\)/);
  expect(hoyCss).not.toMatch(/color:\s*var\(--c-gold-3d\)/);
  for (const match of hoyCss.matchAll(/transition\s*:\s*([^;]+)/g)) {
    expect(match[1]).toMatch(
      /(?:^|[\s,])(?:none|transform|opacity|stroke-dashoffset)\b/,
    );
  }
});
