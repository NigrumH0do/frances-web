import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { OfflineError, type UiError } from '../../api/client';
import { readCsrfCookie } from '../../api/csrf';
import type {
  ChatEvent,
  ChatMessageOut,
  Citation,
} from '../../contracts/generated';
import { askChat, ChatHttpError } from '../../study/chatStream';
import { chatStrings } from './strings';

// Fases del chat (P09-7). «Pensando» se muestra mientras la pregunta sigue en
// curso; `slow` se enciende si a los 30 s todavía no llegó el primer token.
export type AskPhase =
  | 'idle'
  | 'sending'
  | 'searching'
  | 'writing'
  | 'citing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface AskState {
  phase: AskPhase;
  elapsedS: number;
  slow: boolean;
  text: string;
  citations: Citation[];
  status: ChatMessageOut['status'] | null;
  error: UiError | null;
  ask(question: string): Promise<void>;
  cancel(): void;
}

function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError';
}

function statusFrom(code: string | null | undefined): ChatMessageOut['status'] {
  if (code === 'no_material' || code === 'partial' || code === 'error') {
    return code;
  }
  return 'ok';
}

function eventError(event: ChatEvent): UiError {
  const code = event.code ?? 'internal';
  if (code === 'rate_limited') {
    return {
      kind: 'http',
      status: 429,
      code,
      message: chatStrings.llmLimit,
    };
  }
  if (code === 'llm_unavailable') {
    return { kind: 'http', status: 503, code, message: '' };
  }
  return { kind: 'http', status: 0, code, message: '' };
}

function chatError(error: unknown): UiError {
  if (error instanceof ChatHttpError) {
    if (error.status === 401) {
      return {
        kind: 'http',
        status: 401,
        code: 'unauthenticated',
        message: '',
      };
    }
    if (error.status === 403) {
      return {
        kind: 'http',
        status: 403,
        code: error.code === 'csrf' ? 'csrf' : 'forbidden',
        message: '',
      };
    }
    if (error.status === 404) {
      return {
        kind: 'http',
        status: 404,
        code: 'not_found',
        message: chatStrings.threadGone,
      };
    }
    if (error.status === 429) {
      return {
        kind: 'http',
        status: 429,
        code: 'rate_limited',
        message: chatStrings.inFlight,
      };
    }
    if (error.code === 'stream_truncated') {
      return {
        kind: 'http',
        status: 0,
        code: 'stream_truncated',
        message: chatStrings.truncated,
      };
    }
    return {
      kind: 'http',
      status: error.status,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof OfflineError) return { kind: 'offline' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { kind: 'offline' };
  }
  return { kind: 'http', status: 0, code: 'internal', message: '' };
}

export function useAsk(threadId: string): AskState {
  const api = useApi();
  const client = api.client;

  const [phase, setPhase] = useState<AskPhase>('idle');
  const [elapsedS, setElapsedS] = useState(0);
  const [slow, setSlow] = useState(false);
  const [text, setText] = useState('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState<ChatMessageOut['status'] | null>(null);
  const [error, setError] = useState<UiError | null>(null);

  const mountedRef = useRef(true);
  const activeRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(0);
  const firstTokenRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Al cambiar de hilo se descarta la pregunta anterior. El mismo efecto
  // aborta el fetch al desmontar.
  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    activeRef.current = false;
    stopTimer();
    setPhase('idle');
    setElapsedS(0);
    setSlow(false);
    setText('');
    setCitations([]);
    setStatus(null);
    setError(null);
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      activeRef.current = false;
      stopTimer();
    };
  }, [threadId, stopTimer]);

  const cancel = useCallback(() => {
    const controller = controllerRef.current;
    if (!activeRef.current || controller === null) return;
    activeRef.current = false;
    controllerRef.current = null;
    controller.abort();
    stopTimer();
    setPhase('cancelled');
  }, [stopTimer]);

  const ask = useCallback(
    async (question: string): Promise<void> => {
      const trimmed = question.trim();
      if (activeRef.current || threadId === '' || trimmed.length === 0) {
        return;
      }

      const controller = new AbortController();
      controllerRef.current = controller;
      activeRef.current = true;
      firstTokenRef.current = false;
      startedRef.current = Date.now();

      setPhase('sending');
      setElapsedS(0);
      setSlow(false);
      setText('');
      setCitations([]);
      setStatus(null);
      setError(null);

      timerRef.current = setInterval(() => {
        if (!mountedRef.current || controllerRef.current !== controller) {
          return;
        }
        const seconds = Math.floor((Date.now() - startedRef.current) / 1000);
        setElapsedS(seconds);
        if (!firstTokenRef.current && seconds >= 30) setSlow(true);
      }, 1000);

      try {
        const csrfToken = client.csrfToken() ?? readCsrfCookie() ?? '';
        const stream = askChat(threadId, trimmed, {
          csrfToken,
          signal: controller.signal,
          fetchImpl: (input, init) =>
            client.transport(
              typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.toString()
                  : input.url,
              init ?? {},
            ),
        });

        for await (const event of stream) {
          if (!mountedRef.current || controllerRef.current !== controller) {
            return;
          }

          if (event.kind === 'meta') {
            setPhase('searching');
          } else if (event.kind === 'token') {
            firstTokenRef.current = true;
            setPhase('writing');
            setText((previous) => previous + (event.text ?? ''));
          } else if (event.kind === 'citation') {
            setPhase('citing');
            if (event.citation !== null && event.citation !== undefined) {
              setCitations((previous) => [
                ...previous,
                event.citation as Citation,
              ]);
            }
          } else if (event.kind === 'done') {
            setPhase('done');
            setStatus(statusFrom(event.code));
            return;
          } else if (event.kind === 'error') {
            setPhase('error');
            setError(eventError(event));
            return;
          }
        }

        if (controllerRef.current === controller) {
          setPhase('error');
          setError({
            kind: 'http',
            status: 0,
            code: 'stream_truncated',
            message: chatStrings.truncated,
          });
        }
      } catch (caught) {
        if (!mountedRef.current || controllerRef.current !== controller) {
          return;
        }
        if (isAbort(caught)) {
          setPhase('cancelled');
        } else {
          setPhase('error');
          setError(chatError(caught));
        }
      } finally {
        if (controllerRef.current === controller) {
          activeRef.current = false;
          stopTimer();
        }
      }
    },
    [client, threadId, stopTimer],
  );

  return {
    phase,
    elapsedS,
    slow,
    text,
    citations,
    status,
    error,
    ask,
    cancel,
  };
}
