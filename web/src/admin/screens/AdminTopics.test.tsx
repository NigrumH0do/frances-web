import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { jsonResponse } from '../../api/testing';
import type {
  CourseOut,
  ItemPage,
  ItemSummary,
  StudyTopic,
} from '../../contracts/generated';
import { closeV2DbForTests } from '../../offline/db';
import { ME_ADMIN, renderScreen } from '../../shell/testing';
import AdminTopics from './AdminTopics';

const COURSE: CourseOut = { id: 'c_1', name: 'Français A2', section: 'A' };

function item(id: string, title: string | null): ItemSummary {
  return {
    id,
    course_id: 'c_1',
    kind: 'coursework',
    topic_id: 'tp_1',
    title,
    text_lang: 'fr',
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    first_seen_at: '2026-11-01T00:00:00.000Z',
    due_at: null,
    n_attachments: 0,
    n_cards: 0,
    has_sheet: false,
  };
}

const ITEMS: ItemPage = {
  items: [
    item('cw_1', 'Leçon 1'),
    item('cw_2', 'Leçon 2'),
    item('cw_3', 'Leçon 3'),
    item('cw_4', 'Salutations'),
  ],
  next_cursor: null,
};

const TOPIC: StudyTopic = {
  id: 'tp_1',
  course_id: 'c_1',
  title: 'Tout',
  description_es: 'Saludos y presentaciones',
  cefr: 'A2',
  position: 0,
  item_ids: ['cw_1', 'cw_2', 'cw_3'],
  card_count: 8,
  edited_by_human: false,
  source_changed: false,
};

const TOPIC_EDITED: StudyTopic = {
  id: 'tp_2',
  course_id: 'c_1',
  title: 'Salutations',
  description_es: 'Fórmulas de cortesía',
  cefr: 'A1',
  position: 1,
  item_ids: ['cw_4'],
  card_count: 3,
  edited_by_human: true,
  source_changed: false,
};

function baseRoutes(overrides: Record<string, unknown> = {}) {
  return {
    'GET /api/courses': [COURSE],
    'GET /api/topics?course_id=c_1': [TOPIC, TOPIC_EDITED],
    'GET /api/items?course_id=c_1&limit=200': ITEMS,
    'GET /api/topics/tp_1': TOPIC,
    ...overrides,
  };
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('renombrar tema llama PATCH y refresca', async () => {
  const { transport } = renderScreen(<AdminTopics />, {
    user: ME_ADMIN,
    routes: baseRoutes({
      'PATCH /api/admin/topics/tp_1': { ...TOPIC, title: 'Salutations' },
    }),
  });

  await userEvent.click(
    await screen.findByRole('button', { name: 'Renombrar Tout' }),
  );
  await userEvent.clear(screen.getByLabelText('Título'));
  await userEvent.type(screen.getByLabelText('Título'), 'Salutations');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

  await waitFor(() => {
    const patch = transport.calls.find((call) => call.method === 'PATCH');
    expect(patch).toMatchObject({
      url: '/api/admin/topics/tp_1',
      body: { title: 'Salutations' },
    });
  });
  await waitFor(() => {
    const loads = transport.calls.filter(
      (call) => call.url === '/api/topics?course_id=c_1',
    );
    expect(loads.length).toBeGreaterThanOrEqual(2);
  });
});

test('unir temas exige al menos dos y envía merge', async () => {
  const { transport } = renderScreen(<AdminTopics />, {
    user: ME_ADMIN,
    routes: baseRoutes({
      'POST /api/admin/topics/merge': { ...TOPIC, title: 'Tout' },
    }),
  });

  await screen.findByRole('button', { name: 'Renombrar Tout' });
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Seleccionar Tout' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Unir temas' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Elige al menos dos temas para unir',
  );
  expect(
    transport.calls.some((call) => call.url === '/api/admin/topics/merge'),
  ).toBe(false);

  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Seleccionar Salutations' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Unir temas' }));
  await userEvent.type(screen.getByLabelText('Título'), 'Tout');
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

  await waitFor(() => {
    const merge = transport.calls.find(
      (call) => call.url === '/api/admin/topics/merge',
    );
    expect(merge?.body).toEqual({
      topic_ids: ['tp_1', 'tp_2'],
      title: 'Tout',
    });
  });
  await waitFor(() => {
    const loads = transport.calls.filter(
      (call) => call.url === '/api/topics?course_id=c_1',
    );
    expect(loads.length).toBeGreaterThanOrEqual(2);
  });
});

test('dividir exige dejar una publicación en el tema original', async () => {
  const { transport } = renderScreen(<AdminTopics />, {
    user: ME_ADMIN,
    routes: baseRoutes({
      'POST /api/admin/topics/tp_1/split': [
        { ...TOPIC, item_ids: ['cw_3'] },
        { ...TOPIC, id: 'tp_3', title: 'Nombres', item_ids: ['cw_1', 'cw_2'] },
      ],
    }),
  });

  await userEvent.click(
    await screen.findByRole('button', { name: 'Dividir Tout' }),
  );
  await userEvent.click(
    await screen.findByRole('checkbox', { name: 'Incluir Leçon 1' }),
  );
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Incluir Leçon 2' }),
  );
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Incluir Leçon 3' }),
  );
  await userEvent.type(
    screen.getByLabelText('Título del tema nuevo'),
    'Nombres',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Deja al menos una publicación en el tema original',
  );
  expect(
    transport.calls.some((call) => call.url === '/api/admin/topics/tp_1/split'),
  ).toBe(false);

  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Incluir Leçon 3' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

  await waitFor(() => {
    const split = transport.calls.find(
      (call) => call.url === '/api/admin/topics/tp_1/split',
    );
    expect(split?.body).toEqual({
      item_ids: ['cw_1', 'cw_2'],
      title: 'Nombres',
    });
  });
  await waitFor(() => {
    const loads = transport.calls.filter(
      (call) => call.url === '/api/topics?course_id=c_1',
    );
    expect(loads.length).toBeGreaterThanOrEqual(2);
  });
});

test('mover publicaciones envía items al tema destino', async () => {
  const { transport } = renderScreen(<AdminTopics />, {
    user: ME_ADMIN,
    routes: baseRoutes({
      'POST /api/admin/topics/tp_2/items': {
        ...TOPIC_EDITED,
        item_ids: ['cw_4', 'cw_1'],
      },
    }),
  });

  await userEvent.click(
    await screen.findByRole('button', {
      name: 'Mover publicaciones de Tout',
    }),
  );
  await userEvent.click(
    await screen.findByRole('checkbox', { name: 'Incluir Leçon 1' }),
  );
  await userEvent.selectOptions(screen.getByLabelText('Tema destino'), 'tp_2');
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

  await waitFor(() => {
    const move = transport.calls.find(
      (call) => call.url === '/api/admin/topics/tp_2/items',
    );
    expect(move?.body).toEqual({ item_ids: ['cw_1'] });
  });
  expect(
    transport.calls.some((call) => call.url === '/api/admin/topics/tp_1/items'),
  ).toBe(false);
  await waitFor(() => {
    const loads = transport.calls.filter(
      (call) => call.url === '/api/topics?course_id=c_1',
    );
    expect(loads.length).toBeGreaterThanOrEqual(2);
  });
});

test('unir temas no permite seleccionar más de 20', async () => {
  const many = Array.from({ length: 21 }, (_, index) => ({
    ...TOPIC,
    id: `tp_${index}`,
    title: `Tema ${index}`,
    position: index,
    item_ids: [`cw_${index}`],
  }));
  renderScreen(<AdminTopics />, {
    user: ME_ADMIN,
    routes: baseRoutes({ 'GET /api/topics?course_id=c_1': many }),
  });

  await screen.findByRole('checkbox', { name: 'Seleccionar Tema 0' });
  // Una sola consulta por rol: 20 `getByRole` seguidos sobre 21 filas pasaban
  // de los 5 s del test cuando la máquina estaba cargada.
  const boxes = screen.getAllByRole('checkbox', {
    name: /^Seleccionar Tema \d+$/,
  });
  for (const box of boxes.slice(0, 20)) {
    fireEvent.click(box);
  }
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Seleccionar Tema 20' }),
  );

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Puedes unir como máximo 20 temas',
  );
  expect(
    screen.getByRole('checkbox', { name: 'Seleccionar Tema 20' }),
  ).not.toBeChecked();
});

test('las operaciones destructivas piden confirmación antes de llamar a la API', async () => {
  const { transport } = renderScreen(<AdminTopics />, {
    user: ME_ADMIN,
    routes: baseRoutes({
      'POST /api/admin/topics/merge': { ...TOPIC, title: 'Tout' },
    }),
  });

  await screen.findByRole('button', { name: 'Renombrar Tout' });
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Seleccionar Tout' }),
  );
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Seleccionar Salutations' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Unir temas' }));
  await userEvent.type(screen.getByLabelText('Título'), 'Tout');
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

  expect(screen.getByText(/no se puede deshacer/i)).toBeVisible();
  expect(
    transport.calls.some((call) => call.url === '/api/admin/topics/merge'),
  ).toBe(false);

  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => {
    expect(
      transport.calls.some((call) => call.url === '/api/admin/topics/merge'),
    ).toBe(true);
  });
});

test('los temas editados por una persona se marcan y las operaciones avisan que se conservan', async () => {
  renderScreen(<AdminTopics />, {
    user: ME_ADMIN,
    routes: baseRoutes(),
  });

  expect(await screen.findByText('Editado')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Renombrar Tout' }));

  expect(
    screen.getByText('Esta edición se conserva en el siguiente reagrupado.'),
  ).toBeVisible();
});

test('los errores del servidor se muestran tal cual', async () => {
  renderScreen(<AdminTopics />, {
    user: ME_ADMIN,
    routes: baseRoutes({
      'PATCH /api/admin/topics/tp_1': () =>
        Promise.resolve(
          jsonResponse(
            {
              code: 'conflict',
              message_es: 'El tema cambió mientras lo editabas.',
            },
            409,
          ),
        ),
    }),
  });

  await userEvent.click(
    await screen.findByRole('button', { name: 'Renombrar Tout' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'El tema cambió mientras lo editabas.',
  );
});

test('temas muestra carga, vacío y error con Reintentar', async () => {
  renderScreen(<AdminTopics />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/courses': () => new Promise<Response>(() => undefined),
    },
  });
  expect(screen.getByRole('status')).toHaveTextContent('Cargando');
  cleanup();

  renderScreen(<AdminTopics />, {
    user: ME_ADMIN,
    routes: baseRoutes({ 'GET /api/topics?course_id=c_1': [] }),
  });
  expect(
    await screen.findByText('Todavía no hay temas para este curso.'),
  ).toBeVisible();
  cleanup();

  let fail = true;
  renderScreen(<AdminTopics />, {
    user: ME_ADMIN,
    routes: baseRoutes({
      'GET /api/topics?course_id=c_1': () =>
        Promise.resolve(
          fail
            ? jsonResponse({ code: 'busy', message_es: '' }, 503)
            : jsonResponse([TOPIC]),
        ),
      'GET /api/courses': [COURSE],
    }),
  });

  expect(
    await screen.findByText('El servidor está ocupado; inténtalo de nuevo'),
  ).toBeVisible();
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

  expect(
    await screen.findByRole('button', { name: 'Renombrar Tout' }),
  ).toBeVisible();
});
