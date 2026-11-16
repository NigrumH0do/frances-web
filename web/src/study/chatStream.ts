import type { ApiError, ChatEvent } from '../contracts/generated';
import { parseSse } from './sse';

/** Respuesta HTTP no 200 de `POST /api/chat/threads/{id}/messages`, antes del stream. */
export class ChatHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ChatHttpError';
    this.status = status;
    this.code = code;
  }
}

export interface AskChatOptions {
  csrfToken: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * Envía una pregunta al chat y entrega cada evento SSE según llega.
 * Usa `fetch` con cuerpo en streaming, no `EventSource`, porque ese no admite
 * POST ni el header CSRF. Termina después de `done` o `error`.
 */
export async function* askChat(
  threadId: string,
  question: string,
  opts: AskChatOptions,
): AsyncGenerator<ChatEvent> {
  const fetchImpl: typeof fetch =
    opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const res = await fetchImpl(
    `/api/chat/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-CSRF-Token': opts.csrfToken,
      },
      body: JSON.stringify({ question }),
      signal: opts.signal,
    },
  );

  if (res.status !== 200) {
    let code = `http_${res.status}`;
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as Partial<ApiError>;
      if (typeof body.code === 'string' && body.code) code = body.code;
      if (typeof body.message_es === 'string') message = body.message_es;
    } catch {
      // Sin JSON de error: se queda con el código genérico.
    }
    throw new ChatHttpError(res.status, code, message);
  }
  if (!res.body) {
    throw new ChatHttpError(
      res.status,
      'empty_stream',
      'La respuesta no trae cuerpo.',
    );
  }

  for await (const { data } of parseSse(res.body)) {
    let event: ChatEvent;
    try {
      event = JSON.parse(data) as ChatEvent;
    } catch {
      continue;
    }
    if (typeof event !== 'object' || event === null) continue;
    yield event;
    if (event.kind === 'done' || event.kind === 'error') return;
  }
  // El servidor cerró sin `done` ni `error`: la respuesta quedó a medias.
  throw new ChatHttpError(
    res.status,
    'stream_truncated',
    'La respuesta del chat se cortó antes de terminar.',
  );
}
