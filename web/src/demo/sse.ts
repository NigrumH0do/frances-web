import type { ChatEvent } from '../contracts/generated';

export interface SseOptions {
  /** Espera antes de cada evento; el e2e la cambia con `window.__francesDemo`. */
  delayMs: number;
  signal?: AbortSignal | null;
}

/** Respuesta `text/event-stream` que emite los eventos del chat con pausas. */
export function sseResponse(events: ChatEvent[], opts: SseOptions): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let onAbort: (() => void) | null = null;

  const cleanup = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (onAbort !== null) {
      opts.signal?.removeEventListener('abort', onAbort);
      onAbort = null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let index = 0;

      const finish = (): void => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // El consumidor ya cerró el flujo.
        }
      };

      const abort = (): void => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.error(new DOMException('Aborted', 'AbortError'));
        } catch {
          // El flujo ya estaba cerrado.
        }
      };

      const emit = (): void => {
        if (closed) return;
        if (index >= events.length) {
          finish();
          return;
        }
        const event = events[index];
        index += 1;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          );
        } catch {
          closed = true;
          cleanup();
          return;
        }
        if (index >= events.length) {
          finish();
          return;
        }
        timer = setTimeout(emit, Math.max(0, opts.delayMs));
      };

      onAbort = abort;
      if (opts.signal?.aborted === true) {
        abort();
        return;
      }
      opts.signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(emit, Math.max(0, opts.delayMs));
    },
    cancel() {
      closed = true;
      cleanup();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
