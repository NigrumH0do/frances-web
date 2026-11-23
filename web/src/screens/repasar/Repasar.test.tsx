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
  CardView,
  FsrsCard,
  PlanEntry,
  ReviewIn,
  StudyPlanDay,
  UserCardStateOut,
} from '../../contracts/generated';
import { jsonResponse, offline } from '../../api/testing';
import { closeV2DbForTests } from '../../offline/db';
import { pendingCount } from '../../offline/outbox';
import { renderScreen } from '../../shell/testing';
import Repasar from './Repasar';

const burstSeen = vi.hoisted(() => ({
  requests: [] as Array<{ id: number; variant: 'grade' | 'complete' } | null>,
}));

vi.mock('../../three/LazyScenes', () => ({
  SafeCardBurstScene: ({
    request,
  }: {
    request?: { id: number; variant: 'grade' | 'complete' } | null;
  }) => {
    burstSeen.requests.push(request ?? null);
    return null;
  },
}));

function emittedBursts(): Array<{ id: number; variant: 'grade' | 'complete' }> {
  const byId = new Map<number, { id: number; variant: 'grade' | 'complete' }>();
  for (const request of burstSeen.requests) {
    if (request !== null) byId.set(request.id, request);
  }
  return [...byId.values()];
}

const FSRS: FsrsCard = {
  due: '2026-11-05T10:00:00.000000Z',
  stability: 3.1,
  difficulty: 5.2,
  elapsed_days: 0,
  scheduled_days: 3,
  learning_steps: 0,
  reps: 1,
  lapses: 0,
  state: 2,
  last_review: '2026-11-01T10:00:00.000000Z',
};

function state(
  cardId: string,
  overrides: Partial<UserCardStateOut> = {},
): UserCardStateOut {
  return {
    card_id: cardId,
    fsrs: FSRS,
    suspended: false,
    flagged_hard: false,
    updated_at: '2026-11-01T10:00:00.000000Z',
    ...overrides,
  };
}

function card(id: string, overrides: Partial<CardView> = {}): CardView {
  return {
    id,
    kind: 'vocab',
    front_fr: `fr-${id}`,
    back_es: `es-${id}`,
    example_fr: null,
    example_es: null,
    notes: null,
    ipa: null,
    phonemes: [],
    tags: [],
    stale: false,
    source_item_ids: [`i-${id}`],
    audio: [],
    audio_pending: [],
    owner: 'shared',
    edited_by_human: false,
    source_changed: false,
    mine: null,
    state: state(id),
    ...overrides,
  };
}

const CARD_A = card('a', { front_fr: 'bonjour', back_es: 'hola' });
const CARD_B = card('b', { front_fr: 'merci', back_es: 'gracias' });

const PLAN_ENTRY: PlanEntry = {
  position: 2,
  kind: 'review',
  ref_id: null,
  title_es: 'Repasar tarjetas',
  reason_es: 'Te toca repasar',
  why_llm_es: null,
  done: false,
};

const PLAN_WITH_REVIEW: StudyPlanDay = {
  day: '2026-11-06',
  entries: [PLAN_ENTRY],
  generated_at: '2026-11-06T05:45:00.000000Z',
};

const PLAN_WITHOUT_REVIEW: StudyPlanDay = {
  ...PLAN_WITH_REVIEW,
  entries: [],
};

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
  burstSeen.requests.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('voltear, ver intervalos y calificar envía ReviewIn con next', async () => {
  const { transport } = renderScreen(<Repasar />, {
    routes: {
      'GET /api/review/queue': [CARD_A, CARD_B],
      'POST /api/reviews': state('a'),
      'GET /api/plan/today': PLAN_WITHOUT_REVIEW,
    },
  });

  expect(await screen.findByText('bonjour')).toBeVisible();
  expect(screen.getByText(/Quedan 2 · ~1 min/)).toBeVisible();

  // Con la respuesta oculta, 3 no califica.
  await userEvent.keyboard('3');
  expect(transport.calls.some((call) => call.url === '/api/reviews')).toBe(
    false,
  );

  await userEvent.click(
    screen.getByRole('button', { name: 'Mostrar respuesta' }),
  );
  expect(
    screen.getByRole('button', { name: /Bien.*(min|h|d|m|a)/ }),
  ).toBeVisible();

  await userEvent.keyboard('3');
  await waitFor(() =>
    expect(transport.calls.some((call) => call.url === '/api/reviews')).toBe(
      true,
    ),
  );

  const body = transport.calls.find((call) => call.url === '/api/reviews')!
    .body as ReviewIn;
  expect(body.card_id).toBe(CARD_A.id);
  expect(body.rating).toBe(3);
  expect(body.next.last_review).toBe(body.reviewed_at);
  expect(await screen.findByText('2/2')).toBeVisible();
});

test('suspender quita la tarjeta y permite deshacer', async () => {
  const { transport } = renderScreen(<Repasar />, {
    routes: {
      'GET /api/review/queue': [CARD_A, CARD_B],
      'PATCH /api/cards/a/flags': state('a'),
    },
  });

  expect(await screen.findByText('bonjour')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));

  expect(await screen.findByText('Tarjeta suspendida.')).toBeVisible();
  await waitFor(() =>
    expect(screen.queryByText('bonjour')).not.toBeInTheDocument(),
  );
  expect(screen.getByText('merci')).toBeVisible();

  await userEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
  await waitFor(() => expect(screen.getByText('bonjour')).toBeVisible());

  const patches = transport.calls.filter(
    (call) => call.method === 'PATCH' && call.url === '/api/cards/a/flags',
  );
  expect(patches.map((call) => call.body)).toEqual([
    { suspended: true },
    { suspended: false },
  ]);
});

test('no marca el plan si una tarjeta inicial quedo suspendida', async () => {
  const { transport } = renderScreen(<Repasar />, {
    routes: {
      'GET /api/review/queue': [CARD_A, CARD_B],
      'POST /api/reviews': state('a'),
      'PATCH /api/cards/b/flags': state('b'),
      'GET /api/plan/today': PLAN_WITH_REVIEW,
    },
  });

  expect(await screen.findByText('bonjour')).toBeVisible();

  // A con «Otra vez» vuelve al final; B pasa a ser la tarjeta actual.
  await userEvent.click(
    screen.getByRole('button', { name: 'Mostrar respuesta' }),
  );
  await userEvent.keyboard('1');
  expect(await screen.findByText('merci')).toBeVisible();

  // B se suspende sin haberla calificado nunca.
  await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));
  expect(await screen.findByText('Tarjeta suspendida.')).toBeVisible();
  expect(await screen.findByText('bonjour')).toBeVisible();

  // A otra vez: la sesión acaba, pero B quedó sin repasar.
  await userEvent.click(
    screen.getByRole('button', { name: 'Mostrar respuesta' }),
  );
  await userEvent.keyboard('1');

  expect(await screen.findByText('Sesión terminada')).toBeVisible();
  expect(screen.getByText('Repasadas: 2')).toBeVisible();
  expect(
    transport.calls.some(
      (call) => call.method === 'POST' && call.url.startsWith('/api/plan/'),
    ),
  ).toBe(false);
});

test('no marca el plan si al deshacer otra tarjeta queda una suspendida', async () => {
  let queueCalls = 0;
  const { transport } = renderScreen(<Repasar />, {
    routes: {
      // La primera carga trae [A, B]; tras deshacer B, el servidor solo
      // devuelve B porque A sigue suspendida.
      'GET /api/review/queue': () => {
        queueCalls += 1;
        return jsonResponse(queueCalls === 1 ? [CARD_A, CARD_B] : [CARD_B]);
      },
      'PATCH /api/cards/a/flags': state('a'),
      'PATCH /api/cards/b/flags': state('b'),
      'POST /api/reviews': state('b'),
      'GET /api/plan/today': PLAN_WITH_REVIEW,
    },
  });

  expect(await screen.findByText('bonjour')).toBeVisible();

  // A se suspende sin calificarla; B pasa a ser la actual.
  await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));
  expect(await screen.findByText('merci')).toBeVisible();

  // B se suspende; la sesión queda vacía.
  await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));
  expect(await screen.findByText('Sesión terminada')).toBeVisible();

  // Deshacer B online recarga la cola, que ahora solo contiene B.
  await userEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
  expect(await screen.findByText('merci')).toBeVisible();
  expect(queueCalls).toBe(2);

  // B se califica; A nunca se calificó, así que el plan no debe marcarse.
  await userEvent.click(
    screen.getByRole('button', { name: 'Mostrar respuesta' }),
  );
  await userEvent.click(screen.getByRole('button', { name: /^Bien/ }));

  expect(await screen.findByText('Sesión terminada')).toBeVisible();
  expect(screen.getByText('Repasadas: 1')).toBeVisible();
  expect(
    transport.calls.some(
      (call) => call.method === 'POST' && call.url.startsWith('/api/plan/'),
    ),
  ).toBe(false);
});

test('deshacer sin conexión no reutiliza la cola cacheada', async () => {
  const { transport } = renderScreen(<Repasar />, {
    online: false,
    routes: {
      'GET /api/review/queue': [CARD_A, CARD_B],
      'POST /api/reviews': offline(),
      'PATCH /api/cards/b/flags': offline(),
      'GET /api/plan/today': PLAN_WITHOUT_REVIEW,
    },
  });

  expect(await screen.findByText('bonjour')).toBeVisible();

  // A se califica y queda en la cola sin conexión.
  await userEvent.click(
    screen.getByRole('button', { name: 'Mostrar respuesta' }),
  );
  await userEvent.keyboard('3');
  expect(await screen.findByText('merci')).toBeVisible();

  // B se suspende sin conexión; la sesión termina.
  await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));
  expect(await screen.findByText('Tarjeta suspendida.')).toBeVisible();
  expect(await screen.findByText('Sesión terminada')).toBeVisible();

  const queueLoads = () =>
    transport.calls.filter(
      (call) => call.method === 'GET' && call.url === '/api/review/queue',
    );
  expect(queueLoads()).toHaveLength(1);

  await userEvent.click(screen.getByRole('button', { name: 'Deshacer' }));

  expect(await screen.findByText(/se enviará al volver la red/)).toBeVisible();
  expect(screen.queryByText('bonjour')).not.toBeInTheDocument();
  expect(queueLoads()).toHaveLength(1);
});

test('al terminar marca hecha la entrada review del plan', async () => {
  const { transport } = renderScreen(<Repasar />, {
    routes: {
      'GET /api/review/queue': [CARD_A],
      'POST /api/reviews': state('a'),
      'GET /api/plan/today': PLAN_WITH_REVIEW,
      'POST /api/plan/2026-11-06/2/done': { ...PLAN_ENTRY, done: true },
    },
  });

  expect(await screen.findByText('bonjour')).toBeVisible();
  await userEvent.click(
    screen.getByRole('button', { name: 'Mostrar respuesta' }),
  );
  await userEvent.click(screen.getByRole('button', { name: /^Bien/ }));

  expect(await screen.findByText('Sesión terminada')).toBeVisible();
  await waitFor(() =>
    expect(
      transport.calls.some(
        (call) =>
          call.method === 'POST' && call.url === '/api/plan/2026-11-06/2/done',
      ),
    ).toBe(true),
  );
  expect(screen.getByText('Repasadas: 1')).toBeVisible();
});

test('muestra carga, vacío y error con reintentar', async () => {
  renderScreen(<Repasar />, {
    routes: {
      'GET /api/review/queue': () => new Promise<Response>(() => undefined),
    },
  });
  expect(screen.getByText('Cargando…')).toBeInTheDocument();
  cleanup();

  renderScreen(<Repasar />, {
    routes: { 'GET /api/review/queue': [] },
  });
  expect(await screen.findByText('No tienes tarjetas para hoy')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Temas' })).toHaveAttribute(
    'href',
    '/temas',
  );
  cleanup();

  let calls = 0;
  renderScreen(<Repasar />, {
    routes: {
      'GET /api/review/queue': () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ code: 'internal', message_es: 'Fallo' }, 500)
          : jsonResponse([CARD_A]);
      },
    },
  });

  expect(
    await screen.findByText('Algo salió mal en el servidor'),
  ).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('bonjour')).toBeVisible();
  expect(calls).toBe(2);
});

test('con datos guardados avisa sin conexión y las reseñas van a la cola', async () => {
  renderScreen(<Repasar />, {
    online: false,
    routes: {
      'GET /api/review/queue': [CARD_A],
      'POST /api/reviews': offline(),
      'GET /api/plan/today': PLAN_WITHOUT_REVIEW,
    },
  });

  expect(await screen.findByText(/Sin conexión:/)).toBeVisible();
  expect(await screen.findByText('bonjour')).toBeVisible();

  await userEvent.click(
    screen.getByRole('button', { name: 'Mostrar respuesta' }),
  );
  await userEvent.keyboard('3');

  expect(await screen.findByText('Guardadas sin conexión: 1')).toBeVisible();
  expect(await pendingCount('u1')).toBe(1);
});

test('calificar 3 en la penúltima emite grade y la última cierra con un solo complete', async () => {
  renderScreen(<Repasar />, {
    routes: {
      'GET /api/review/queue': [CARD_A, CARD_B],
      'POST /api/reviews': state('a'),
      'GET /api/plan/today': PLAN_WITHOUT_REVIEW,
    },
  });

  expect(await screen.findByText('bonjour')).toBeVisible();
  await userEvent.click(
    screen.getByRole('button', { name: 'Mostrar respuesta' }),
  );
  await userEvent.click(screen.getByRole('button', { name: /^Bien/ }));

  expect(await screen.findByText('merci')).toBeVisible();
  expect(emittedBursts().filter((burst) => burst.variant === 'grade')).toEqual([
    { id: 1, variant: 'grade' },
  ]);
  expect(
    emittedBursts().filter((burst) => burst.variant === 'complete'),
  ).toHaveLength(0);

  await userEvent.click(
    screen.getByRole('button', { name: 'Mostrar respuesta' }),
  );
  await userEvent.click(screen.getByRole('button', { name: /^Bien/ }));
  expect(await screen.findByText('Sesión terminada')).toBeVisible();

  const bursts = emittedBursts();
  expect(bursts.filter((burst) => burst.variant === 'grade')).toHaveLength(1);
  expect(bursts.filter((burst) => burst.variant === 'complete')).toEqual([
    { id: 2, variant: 'complete' },
  ]);
  expect(bursts).toHaveLength(2);
});

test('calificar 4 en la última tarjeta emite exactamente un complete', async () => {
  renderScreen(<Repasar />, {
    routes: {
      'GET /api/review/queue': [CARD_A],
      'POST /api/reviews': state('a'),
      'GET /api/plan/today': PLAN_WITHOUT_REVIEW,
    },
  });

  expect(await screen.findByText('bonjour')).toBeVisible();
  await userEvent.click(
    screen.getByRole('button', { name: 'Mostrar respuesta' }),
  );
  await userEvent.click(screen.getByRole('button', { name: /^Fácil/ }));
  expect(await screen.findByText('Sesión terminada')).toBeVisible();

  expect(emittedBursts()).toEqual([{ id: 1, variant: 'complete' }]);
});

test('las teclas 1–4 califican al momento, sin la espera del swipe', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({
    advanceTimers: vi.advanceTimersByTimeAsync,
  });
  const { transport } = renderScreen(<Repasar />, {
    routes: {
      'GET /api/review/queue': [CARD_A],
      'POST /api/reviews': state('a'),
      'GET /api/plan/today': PLAN_WITHOUT_REVIEW,
    },
  });

  expect(await screen.findByText('bonjour')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
  await user.keyboard('3');
  await waitFor(() =>
    expect(transport.calls.some((call) => call.url === '/api/reviews')).toBe(
      true,
    ),
  );
  const body = transport.calls.find((call) => call.url === '/api/reviews')!
    .body as ReviewIn;
  expect(body.rating).toBe(3);
});

test('el CSS de repaso usa 2×2, IPA mono recto y no queda burstCount', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(join(here, 'repasar.css'), 'utf8');
  const source = readFileSync(join(here, 'Repasar.tsx'), 'utf8');
  expect(css).toMatch(/@media\s*\(\s*max-width:\s*379px\s*\)/);
  expect(css).toMatch(
    /\.rating\s*\{[^}]*grid-template-columns:\s*repeat\(\s*2,\s*1fr\s*\)/,
  );
  const ipa = /\.flip-face \.ipa\s*,\s*\.flip-recap-ipa\s*\{([^}]*)\}/.exec(
    css,
  );
  expect(ipa?.[1]).toMatch(/font-family:\s*var\(--font-mono\)/);
  expect(ipa?.[1]).toMatch(/font-style:\s*normal/);
  expect(ipa?.[1]).not.toMatch(/italic/);
  expect(css).toMatch(/min-height:\s*min\(68dvh,\s*560px\)/);
  expect(css).toMatch(/\.show-answer\s*\{[^}]*position:\s*sticky/);
  expect(css).toMatch(/\.show-answer\s*\{[^}]*bottom:\s*0/);
  expect(css).toMatch(
    /\.flip-tilt\.is-tilting\s*\{[^}]*will-change:\s*transform/,
  );
  expect(css).not.toMatch(/color:\s*var\(--c-gold-3d\)/);
  expect(source).not.toContain('burstCount');
  expect(source).not.toContain('setBurstCount');
});
