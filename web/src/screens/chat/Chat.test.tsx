import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createApiClient } from '../../api/client';
import { fakeTransport, jsonResponse } from '../../api/testing';
import type { Transport } from '../../api/transport';
import type {
  ChatEvent,
  ChatMessageOut,
  ChatThreadDetail,
  ChatThreadOut,
  Citation,
} from '../../contracts/generated';
import { closeV2DbForTests } from '../../offline/db';
import { OfflineProvider } from '../../offline/OfflineContext';
import Chat from './Chat';
import { MessageList } from './MessageList';
import { readStarterContext, starterPrompts } from './starters';

const THREAD: ChatThreadOut = {
  id: 'th_1',
  title: '¿Cuándo uso être?',
  created_at: '2026-11-05T10:00:00.000Z',
  updated_at: '2026-11-05T10:01:00.000Z',
};

const OTHER_THREAD: ChatThreadOut = {
  id: 'th_2',
  title: 'Le passé composé',
  created_at: '2026-11-04T10:00:00.000Z',
  updated_at: '2026-11-04T10:01:00.000Z',
};

const CITATION: Citation = {
  block_id: 17,
  item_id: 'cw_7',
  page: 3,
  snippet: 'Leçon 7 — Le passé composé',
  source: 'att_1',
};

const USER_MESSAGE: ChatMessageOut = {
  id: 1,
  role: 'user',
  content: '¿Cuándo uso être?',
  citations: [],
  status: 'ok',
  created_at: '2026-11-05T10:00:30.000Z',
};

const ASSISTANT_MESSAGE: ChatMessageOut = {
  id: 2,
  role: 'assistant',
  content: 'Con être… [1]',
  citations: [CITATION],
  status: 'ok',
  created_at: '2026-11-05T10:00:31.000Z',
};

const DETAIL: ChatThreadDetail = {
  thread: THREAD,
  messages: [USER_MESSAGE, ASSISTANT_MESSAGE],
};

const EMPTY_THREAD: ChatThreadDetail = { thread: THREAD, messages: [] };

const NO_MATERIAL_MESSAGE: ChatMessageOut = {
  id: 9,
  role: 'assistant',
  content: 'El material del curso no cubre esta pregunta.',
  citations: [],
  status: 'no_material',
  created_at: '2026-11-05T10:00:31.000Z',
};

function sseResponse(events: ChatEvent[]): Response {
  const body = events
    .map((event) => `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function renderChatWithTransport(
  transport: Transport,
  opts: { path: string; pattern: string; state?: unknown } = {
    path: '/chat/th_1',
    pattern: '/chat/:threadId',
  },
) {
  const client = createApiClient({
    transport,
    onUnauthenticated: vi.fn(),
  });
  client.setCsrfToken('csrf-test');
  render(
    <ApiProvider client={client}>
      <OfflineProvider userId="u1">
        <MemoryRouter
          initialEntries={[{ pathname: opts.path, state: opts.state }]}
        >
          <Routes>
            <Route path={opts.pattern} element={<Chat />} />
          </Routes>
        </MemoryRouter>
      </OfflineProvider>
    </ApiProvider>,
  );
  return client;
}

function renderChatScreen(opts: {
  path: string;
  pattern: string;
  routes?: Record<string, unknown>;
  online?: boolean;
  state?: unknown;
}) {
  if (opts.online === false) {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  }
  const transport = fakeTransport(opts.routes ?? {});
  const client = renderChatWithTransport(transport, {
    path: opts.path,
    pattern: opts.pattern,
    state: opts.state,
  });
  return { transport, client };
}

function stubWideViewport(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width: 960px'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// jsdom ignora `pointerType` en el init de MouseEvent.
function clickAsTouch(element: HTMLElement): void {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  fireEvent(element, event);
}

function PathProbe(): ReactElement {
  const location = useLocation();
  return (
    <div data-testid="path">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderInRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('thinking timer, 30 s notice and cancel aborts the request', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });
  let aborted = false;
  const base = fakeTransport({
    'GET /api/chat/threads': [THREAD],
    'GET /api/chat/threads/th_1': EMPTY_THREAD,
  });
  const transport: Transport = (input, init) => {
    if (input === '/api/chat/threads/th_1/messages') {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    return base(input, init);
  };

  renderChatWithTransport(transport);
  await user.type(
    await screen.findByRole('textbox', { name: 'Pregunta' }),
    '¿Cuándo uso être?{Enter}',
  );

  expect(screen.getByRole('status')).toHaveTextContent('Pensando… 0 s');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31_000);
  });
  expect(screen.getByRole('status')).toHaveTextContent('31 s');
  expect(screen.getByText('Está tardando más de lo normal')).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Cancelar' }));
  await waitFor(() => expect(aborted).toBe(true));
  expect(await screen.findByText('Cancelada')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Pregunta' })).not.toBeDisabled();
});

test('respuesta en streaming con citas enlazadas a publicación y página', async () => {
  let saved = false;
  const routes = {
    'GET /api/chat/threads': [THREAD],
    'GET /api/chat/threads/th_1': () =>
      jsonResponse(saved ? DETAIL : EMPTY_THREAD),
    'POST /api/chat/threads/th_1/messages': () => {
      saved = true;
      return sseResponse([
        { kind: 'meta', message_id: 1 },
        { kind: 'token', text: 'Con être… ' },
        { kind: 'token', text: '[1]' },
        { kind: 'citation', citation: CITATION },
        { kind: 'done', message_id: 2 },
      ]);
    },
  };

  renderChatScreen({
    path: '/chat/th_1',
    pattern: '/chat/:threadId',
    routes,
  });
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Pregunta' }),
    '¿Cuándo uso être?{Enter}',
  );

  const source = await screen.findByRole('link', {
    name: /Leçon 7.*pág\. 3/,
  });
  expect(source).toHaveAttribute(
    'href',
    '/publicaciones/cw_7?pagina=3&adjunto=att_1',
  );
  expect(await screen.findByText(/Con être…/)).toBeVisible();
  expect(screen.getByText('Fuentes')).toBeVisible();
});

test('no_material muestra «Sin fuentes en el material»', async () => {
  let saved = false;
  const noMaterialDetail: ChatThreadDetail = {
    thread: THREAD,
    messages: [USER_MESSAGE, NO_MATERIAL_MESSAGE],
  };
  const routes = {
    'GET /api/chat/threads': [THREAD],
    'GET /api/chat/threads/th_1': () =>
      jsonResponse(saved ? noMaterialDetail : EMPTY_THREAD),
    'POST /api/chat/threads/th_1/messages': () => {
      saved = true;
      return sseResponse([
        { kind: 'meta', message_id: 1 },
        {
          kind: 'token',
          text: 'El material del curso no cubre esta pregunta.',
        },
        { kind: 'done', message_id: 9, code: 'no_material' },
      ]);
    },
  };

  renderChatScreen({
    path: '/chat/th_1',
    pattern: '/chat/:threadId',
    routes,
  });
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Pregunta' }),
    '¿Qué es el plus-que-parfait?{Enter}',
  );

  expect(await screen.findByText('Sin fuentes en el material')).toBeVisible();
  expect(screen.getByText(/no cubre esta pregunta/)).toBeVisible();
});

test('partial avisa que la respuesta no trae citas exactas', () => {
  const partial: ChatMessageOut = {
    ...ASSISTANT_MESSAGE,
    id: 55,
    content: 'Con être…',
    status: 'partial',
  };
  renderInRouter(<MessageList messages={[partial]} />);

  expect(
    screen.getByText('Respuesta sin citas exactas; fuentes cercanas'),
  ).toBeVisible();
  expect(screen.getByText('Fuentes')).toBeVisible();
});

test('al cancelar no duplica la pregunta que el servidor ya guardó', async () => {
  let saved = false;
  const base = fakeTransport({
    'GET /api/chat/threads': [THREAD],
    'GET /api/chat/threads/th_1': () =>
      jsonResponse(
        saved ? { thread: THREAD, messages: [USER_MESSAGE] } : EMPTY_THREAD,
      ),
  });
  const transport: Transport = (input, init) => {
    if (input === '/api/chat/threads/th_1/messages') {
      saved = true;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    }
    return base(input, init);
  };

  renderChatWithTransport(transport);
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Pregunta' }),
    '¿Cuándo uso être?{Enter}',
  );
  expect(screen.getAllByText('¿Cuándo uso être?')).toHaveLength(1);

  await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(await screen.findByText('Cancelada')).toBeVisible();
  await waitFor(() =>
    expect(screen.getAllByText('¿Cuándo uso être?')).toHaveLength(1),
  );

  const log = screen.getByRole('log');
  expect(log).toHaveAttribute('aria-live', 'polite');
  expect(within(log).getByText('Cancelada')).toBeVisible();
});

test('al fallar con texto parcial no duplica la pregunta ni el texto guardado', async () => {
  let saved = false;
  const partial: ChatMessageOut = {
    ...ASSISTANT_MESSAGE,
    id: 33,
    content: 'Con être…',
    citations: [],
    status: 'partial',
  };
  const routes = {
    'GET /api/chat/threads': [THREAD],
    'GET /api/chat/threads/th_1': () =>
      jsonResponse(
        saved
          ? { thread: THREAD, messages: [USER_MESSAGE, partial] }
          : EMPTY_THREAD,
      ),
    'POST /api/chat/threads/th_1/messages': () => {
      saved = true;
      return sseResponse([
        { kind: 'meta', message_id: 1 },
        { kind: 'token', text: 'Con être…' },
        { kind: 'error', code: 'llm_unavailable' },
      ]);
    },
  };

  renderChatScreen({
    path: '/chat/th_1',
    pattern: '/chat/:threadId',
    routes,
  });
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Pregunta' }),
    '¿Cuándo uso être?{Enter}',
  );

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'La IA no está disponible ahora',
  );
  expect(
    await screen.findByText('Respuesta sin citas exactas; fuentes cercanas'),
  ).toBeVisible();
  await waitFor(() => {
    expect(screen.getAllByText('¿Cuándo uso être?')).toHaveLength(1);
    expect(screen.getAllByText('Con être…')).toHaveLength(1);
  });
});

test('el chat anuncia la respuesta con role log y aria-live polite', async () => {
  let saved = false;
  const routes = {
    'GET /api/chat/threads': [THREAD],
    'GET /api/chat/threads/th_1': () =>
      jsonResponse(saved ? DETAIL : EMPTY_THREAD),
    'POST /api/chat/threads/th_1/messages': () => {
      saved = true;
      return sseResponse([
        { kind: 'meta', message_id: 1 },
        { kind: 'token', text: 'Con être… ' },
        { kind: 'token', text: '[1]' },
        { kind: 'citation', citation: CITATION },
        { kind: 'done', message_id: 2 },
      ]);
    },
  };

  renderChatScreen({
    path: '/chat/th_1',
    pattern: '/chat/:threadId',
    routes,
  });
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Pregunta' }),
    '¿Cuándo uso être?{Enter}',
  );

  const log = await screen.findByRole('log');
  expect(log).toHaveAttribute('aria-live', 'polite');
  expect(await within(log).findByText(/Con être…/)).toBeVisible();
});

test('un mensaje guardado con status error muestra un aviso', () => {
  const errored: ChatMessageOut = {
    ...ASSISTANT_MESSAGE,
    id: 77,
    content: '',
    citations: [],
    status: 'error',
  };
  renderInRouter(<MessageList messages={[errored]} />);

  expect(screen.getByRole('alert')).toHaveTextContent(
    'La respuesta no se pudo completar',
  );
});

test('429 dice que ya hay una pregunta en curso', async () => {
  const routes = {
    'GET /api/chat/threads': [THREAD],
    'GET /api/chat/threads/th_1': EMPTY_THREAD,
    'POST /api/chat/threads/th_1/messages': () =>
      jsonResponse({ code: 'rate_limited', message_es: 'espera' }, 429),
  };

  renderChatScreen({
    path: '/chat/th_1',
    pattern: '/chat/:threadId',
    routes,
  });
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Pregunta' }),
    '¿Y esto?{Enter}',
  );

  expect(await screen.findByText('Ya hay una pregunta en curso')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Ya hay una pregunta en curso',
  );
});

test('un segundo envío se ignora mientras hay una pregunta en curso', async () => {
  let posts = 0;
  const base = fakeTransport({
    'GET /api/chat/threads': [THREAD],
    'GET /api/chat/threads/th_1': EMPTY_THREAD,
  });
  const transport: Transport = (input, init) => {
    if (input === '/api/chat/threads/th_1/messages') {
      posts += 1;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    }
    return base(input, init);
  };

  renderChatWithTransport(transport);
  const box = await screen.findByRole('textbox', { name: 'Pregunta' });
  await userEvent.type(box, '¿Cuándo uso être?{Enter}');
  await waitFor(() => expect(posts).toBe(1));
  expect(box).toBeDisabled();

  fireEvent.submit(box.closest('form') as HTMLFormElement);
  expect(posts).toBe(1);

  await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  await waitFor(() => expect(screen.getByText('Cancelada')).toBeVisible());
});

test('no usa EventSource', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'useAsk.ts'),
    'utf8',
  );
  expect(source).not.toContain('EventSource');
});

test('sin red el chat avisa que necesita conexión', async () => {
  renderChatScreen({
    path: '/chat',
    pattern: '/chat',
    online: false,
  });

  expect(await screen.findByText('El chat necesita conexión')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Pregunta' })).toBeDisabled();
});

test('muestra carga, vacío y error con reintentar', async () => {
  renderChatScreen({
    path: '/chat',
    pattern: '/chat',
    routes: {
      'GET /api/chat/threads': () => new Promise<Response>(() => undefined),
    },
  });
  expect(await screen.findByText('Cargando…')).toBeInTheDocument();

  cleanup();

  renderChatScreen({
    path: '/chat',
    pattern: '/chat',
    routes: { 'GET /api/chat/threads': [] },
  });
  expect(
    await screen.findByText(/Todavía no hay conversaciones\./),
  ).toBeVisible();

  cleanup();

  let attempts = 0;
  renderChatScreen({
    path: '/chat',
    pattern: '/chat',
    routes: {
      'GET /api/chat/threads': () => {
        attempts += 1;
        if (attempts === 1) {
          return jsonResponse({ code: 'internal', message_es: 'falló' }, 500);
        }
        return jsonResponse([THREAD]);
      },
    },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Algo salió mal en el servidor',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('¿Cuándo uso être?')).toBeVisible();
});

test('sin conversaciones, la primera pregunta crea el hilo y se envía', async () => {
  let posted = 0;
  const routes = {
    'GET /api/chat/threads': [],
    'POST /api/chat/threads': () => jsonResponse(THREAD, 201),
    'GET /api/chat/threads/th_1': () =>
      jsonResponse(posted > 0 ? DETAIL : EMPTY_THREAD),
    'POST /api/chat/threads/th_1/messages': () => {
      posted += 1;
      return sseResponse([
        { kind: 'meta', message_id: 1 },
        { kind: 'token', text: 'Con être… ' },
        { kind: 'done', message_id: 2 },
      ]);
    },
  };
  const client = createApiClient({
    transport: fakeTransport(routes),
    onUnauthenticated: vi.fn(),
  });
  client.setCsrfToken('csrf-test');
  render(
    <ApiProvider client={client}>
      <OfflineProvider userId="u1">
        <MemoryRouter initialEntries={['/chat']}>
          <Routes>
            <Route path="/chat" element={<Chat />} />
            <Route path="/chat/:threadId" element={<Chat />} />
          </Routes>
        </MemoryRouter>
      </OfflineProvider>
    </ApiProvider>,
  );

  const box = await screen.findByRole('textbox', { name: 'Pregunta' });
  await waitFor(() => expect(box).not.toBeDisabled());
  await userEvent.type(box, '¿Cuándo uso être?{Enter}');
  await waitFor(() => expect(posted).toBe(1));
  expect(await screen.findByText(/Con être…/)).toBeVisible();
  expect(posted).toBe(1);
});

test('el texto de la respuesta se pinta como texto, sin HTML (P09-7)', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'MessageList.tsx'),
    'utf8',
  );
  expect(source).not.toContain('dangerouslySetInnerHTML');

  const malicious: ChatMessageOut = {
    ...ASSISTANT_MESSAGE,
    id: 44,
    content: '<img src=x onerror="window.__x = 1"> <script>alert(1)</script>',
    citations: [],
  };
  const { container } = renderInRouter(<MessageList messages={[malicious]} />);

  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText(/onerror/)).toBeVisible();
  expect(screen.getByText(/alert\(1\)/)).toBeVisible();
});

test('los [n] solo se enlazan si hay una citation con ese número (P09-7)', () => {
  const message: ChatMessageOut = {
    ...ASSISTANT_MESSAGE,
    content: 'Con être… [1] y [2]',
  };

  renderInRouter(<MessageList messages={[message]} />);

  const inline = screen.getByRole('link', { name: 'Fuente 1' });
  expect(inline).toHaveAttribute(
    'href',
    '/publicaciones/cw_7?pagina=3&adjunto=att_1',
  );
  expect(
    screen.queryByRole('link', { name: 'Fuente 2' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/\[2\]/)).toBeVisible();
});

test('borra una conversación solo después de confirmar', async () => {
  const transport = fakeTransport({
    'GET /api/auth/me': {
      csrf_token: 'csrf-test',
      user: {
        id: 'u1',
        email: 'ana@example.test',
        display_name: 'Ana',
        role: 'user',
        created_at: '2026-11-01T00:00:00.000Z',
        last_login_at: null,
        disabled: false,
      },
    },
    'GET /api/chat/threads': [THREAD, OTHER_THREAD],
    'GET /api/chat/threads/th_2': {
      thread: OTHER_THREAD,
      messages: [],
    },
    'DELETE /api/chat/threads/th_1': () => new Response(null, { status: 204 }),
  });
  const client = createApiClient({
    transport,
    onUnauthenticated: vi.fn(),
  });
  client.setCsrfToken('csrf-test');
  render(
    <ApiProvider client={client}>
      <OfflineProvider userId="u1">
        <MemoryRouter initialEntries={['/chat']}>
          <Routes>
            <Route path="/chat" element={<Chat />} />
          </Routes>
        </MemoryRouter>
      </OfflineProvider>
    </ApiProvider>,
  );

  const list = await screen.findByLabelText('Conversaciones');
  const row = within(list).getByRole('button', {
    name: 'Borrar «¿Cuándo uso être?»',
  });
  await userEvent.click(row);
  expect(transport.calls.some((call) => call.method === 'DELETE')).toBe(false);

  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Borrar' }));

  await waitFor(() =>
    expect(
      transport.calls.some(
        (call) =>
          call.method === 'DELETE' && call.url === '/api/chat/threads/th_1',
      ),
    ).toBe(true),
  );
});

test('en estrecho, /chat muestra la lista y no el cuerpo del hilo', async () => {
  renderChatScreen({
    path: '/chat',
    pattern: '/chat',
    routes: {
      'GET /api/chat/threads': [OTHER_THREAD, THREAD],
      'GET /api/chat/threads/th_1': DETAIL,
    },
  });

  const list = await screen.findByLabelText('Conversaciones');
  expect(within(list).getAllByRole('link')[0]).toHaveTextContent(
    '¿Cuándo uso être?',
  );
  expect(within(list).getByText('5 nov 05:01')).toBeVisible();
  expect(screen.queryByText(/Con être…/)).not.toBeInTheDocument();
});

test('desde 960 px, /chat muestra la lista, el cuerpo y el hilo activo', async () => {
  stubWideViewport();
  renderChatScreen({
    path: '/chat',
    pattern: '/chat',
    routes: {
      'GET /api/chat/threads': [OTHER_THREAD, THREAD],
      'GET /api/chat/threads/th_1': DETAIL,
    },
  });

  const list = await screen.findByLabelText('Conversaciones');
  expect(within(list).getByRole('link', { current: 'page' })).toHaveTextContent(
    '¿Cuándo uso être?',
  );
  const conversation = await screen.findByText(/Con être…/);
  const active = within(list).getByRole('link', { current: 'page' });
  expect(document.querySelector('.chat-split')).not.toBeNull();
  expect(
    active.compareDocumentPosition(conversation) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test('en estrecho, /chat/:threadId muestra solo la conversación y el enlace atrás', async () => {
  renderChatScreen({
    path: '/chat/th_1',
    pattern: '/chat/:threadId',
    routes: {
      'GET /api/chat/threads': [THREAD],
      'GET /api/chat/threads/th_1': DETAIL,
    },
  });

  expect(await screen.findByText(/Con être…/)).toBeVisible();
  expect(
    screen.queryByRole('heading', { name: 'Conversaciones' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Conversaciones' })).toHaveAttribute(
    'href',
    '/chat',
  );
});

test('chips iniciales rellenan el compositor y Crear tarjeta abre diálogo prellenado', async () => {
  let sent = false;
  const { transport } = renderChatScreen({
    path: '/chat/th_1',
    pattern: '/chat/:threadId',
    routes: {
      'GET /api/chat/threads': [THREAD],
      'GET /api/chat/threads/th_1': () =>
        jsonResponse(sent ? DETAIL : EMPTY_THREAD),
      'POST /api/chat/threads/th_1/messages': () => {
        sent = true;
        return sseResponse([
          { kind: 'meta', message_id: 1 },
          { kind: 'token', text: 'Con être… [1]' },
          { kind: 'citation', citation: CITATION },
          { kind: 'done', message_id: 2 },
        ]);
      },
    },
  });

  const starter = await screen.findByRole('button', {
    name: '¿Cómo se forma el passé composé?',
  });
  await userEvent.click(starter);

  const box = screen.getByRole('textbox', { name: 'Pregunta' });
  expect(box).toHaveValue('¿Cómo se forma el passé composé?');
  expect(box).toHaveFocus();
  expect(
    transport.calls.find(
      (c) => c.method === 'POST' && c.url === '/api/chat/threads/th_1/messages',
    ),
  ).toBeUndefined();

  await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

  await waitFor(() =>
    expect(
      transport.calls.find(
        (c) =>
          c.method === 'POST' && c.url === '/api/chat/threads/th_1/messages',
      )?.body,
    ).toEqual({ question: '¿Cómo se forma el passé composé?' }),
  );

  const createBtn = await screen.findByRole('button', {
    name: '+ Crear tarjeta',
  });
  await userEvent.click(createBtn);

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByLabelText('Español')).toHaveValue('Con être…');
  expect(within(dialog).getByLabelText('Notas')).toHaveValue('Con être…');
});

const STARTER_BASE = [
  '¿Cómo se forma el passé composé?',
  'Resume los puntos clave para el examen',
  'Dame ejemplos con vocabulario de la clase',
] as const;

test('starterPrompts sin contexto devuelve los tres chips actuales', () => {
  expect(starterPrompts()).toEqual([...STARTER_BASE]);
  expect(starterPrompts({})).toEqual([...STARTER_BASE]);
  expect(readStarterContext(null)).toBeUndefined();
  expect(readStarterContext({ firstQuestion: 'hola' })).toBeUndefined();
  expect(readStarterContext({ cardNote: 'true' })).toBeUndefined();
  expect(readStarterContext({ topicTitle: '   ' })).toBeUndefined();
});

test('starterPrompts con nota de tarjeta antepone el chip contextual', () => {
  expect(starterPrompts({ cardNote: true })).toEqual([
    'explícame la nota de esta tarjeta',
    ...STARTER_BASE,
  ]);
  expect(starterPrompts({ topicTitle: 'Les verbes' })[0]).toBe(
    'Explícame el tema «Les verbes»',
  );
  expect(starterPrompts({ upcomingTitle: 'Rédaction' })[0]).toBe(
    'Prepárame la entrega «Rédaction»',
  );
  expect(readStarterContext({ cardNote: true, firstQuestion: 'hola' })).toEqual(
    { cardNote: true },
  );
});

test('location.state con cardNote muestra el chip de la nota', async () => {
  renderChatScreen({
    path: '/chat/th_1',
    pattern: '/chat/:threadId',
    state: { cardNote: true },
    routes: {
      'GET /api/chat/threads': [THREAD],
      'GET /api/chat/threads/th_1': EMPTY_THREAD,
    },
  });

  expect(
    await screen.findByRole('button', {
      name: 'explícame la nota de esta tarjeta',
    }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: '¿Cómo se forma el passé composé?' }),
  ).toBeVisible();
});

test('el foco abre la vista previa de la cita y Escape la cierra', async () => {
  const cited: Citation = {
    ...CITATION,
    item_title: 'Passé composé avec être',
  };
  const message: ChatMessageOut = {
    ...ASSISTANT_MESSAGE,
    content: 'Con être… [1]',
    citations: [cited],
  };
  renderInRouter(<MessageList messages={[message]} />);

  const inline = screen.getByRole('link', { name: 'Fuente 1' });
  inline.focus();

  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'false');
  expect(dialog).toHaveTextContent('Passé composé avec être');
  expect(dialog).toHaveTextContent('p. 3');
  expect(dialog).toHaveTextContent('Leçon 7 — Le passé composé');
  expect(within(dialog).getByRole('link')).toHaveAttribute(
    'href',
    '/publicaciones/cw_7?pagina=3&adjunto=att_1',
  );

  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(inline).toHaveFocus();
});

test('un toque abre la vista previa sin navegar hasta el enlace interior', () => {
  const cited: Citation = {
    ...CITATION,
    item_title: 'Passé composé avec être',
  };
  const message: ChatMessageOut = {
    ...ASSISTANT_MESSAGE,
    content: 'Con être… [1]',
    citations: [cited],
  };
  render(
    <MemoryRouter initialEntries={['/chat/th_1']}>
      <PathProbe />
      <MessageList messages={[message]} />
    </MemoryRouter>,
  );

  const inline = screen.getByRole('link', { name: 'Fuente 1' });
  clickAsTouch(inline);

  expect(screen.getByTestId('path')).toHaveTextContent('/chat/th_1');
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'false');
  expect(within(dialog).getByRole('link')).toHaveAttribute(
    'href',
    '/publicaciones/cw_7?pagina=3&adjunto=att_1',
  );

  fireEvent.click(within(dialog).getByRole('link'));
  expect(screen.getByTestId('path')).toHaveTextContent(
    '/publicaciones/cw_7?pagina=3&adjunto=att_1',
  );
});

test('el css del chat parte a 960 px y deja el compositor fijo', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'chat.css'),
    'utf8',
  );
  expect(css).toContain('.content-split .chat-split');
  expect(css).toMatch(
    /@media \(min-width: 960px\)\s*\{[^}]*grid-template-columns:\s*280px minmax\(0, 1fr\);/,
  );
  expect(css).toMatch(
    /\.composer\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;[^}]*z-index:\s*2;[^}]*background:\s*var\(--c-bg\);/,
  );
  expect(css).toMatch(
    /\.composer \.textarea\s*\{[^}]*max-height:\s*calc\(1\.5em \* 4 \+ 20px\);/,
  );
  expect(css).toMatch(/\.thinking \.btn\s*\{[^}]*min-height:\s*var\(--tap\)/);
  expect(css).toContain('html.motion-off .dots span');
  expect(css).not.toMatch(/(^|[^-\w])order\s*:/);
  expect(css).not.toContain('.paper');
  expect(css).not.toContain('var(--c-gold-3d)');
  const blink = css.slice(
    css.indexOf('@keyframes blink'),
    css.indexOf('.steps'),
  );
  expect(blink).toContain('opacity');
  expect(blink).not.toContain('transform');
});
