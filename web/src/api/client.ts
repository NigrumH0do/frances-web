import type { ApiError } from '../contracts/generated';
import { readCsrfCookie } from './csrf';
import type { Transport } from './transport';

// Errores tipados del cliente. El cuerpo de la respuesta nunca se registra
// en logs: solo se toman `code` y `message_es` del `ApiError`.

/** Error que ve la interfaz. `kind: 'offline'` cuando no hubo respuesta de red. */
export type UiError =
  | { kind: 'offline' }
  | { kind: 'http'; status: number; code: string; message: string };

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly messageEs: string;

  constructor(status: number, code: string, messageEs: string) {
    super(code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.messageEs = messageEs;
  }
}

export class OfflineError extends Error {
  constructor() {
    super('offline');
    this.name = 'OfflineError';
  }
}

export function toUiError(e: unknown): UiError {
  if (e instanceof OfflineError) return { kind: 'offline' };
  if (e instanceof HttpError) {
    return {
      kind: 'http',
      status: e.status,
      code: e.code,
      message: e.messageEs,
    };
  }
  return { kind: 'http', status: 0, code: 'internal', message: '' };
}

export type QueryValue = string | number | boolean | undefined;

export interface RequestOpts {
  signal?: AbortSignal;
}

export interface ApiClient {
  get<T>(
    path: string,
    query?: Record<string, QueryValue>,
    opts?: RequestOpts,
  ): Promise<T>;
  send<T>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    opts?: RequestOpts,
  ): Promise<T>;
  /** GET completo (sin Range) para que el service worker guarde la respuesta. */
  blob(path: string, opts?: RequestOpts): Promise<Blob>;
  csrfToken(): string | null;
  setCsrfToken(token: string | null): void;
  readonly transport: Transport;
}

export interface ApiClientOptions {
  transport: Transport;
  /** Se llama una vez por ráfaga de 401 (P09-2). */
  onUnauthenticated: () => void;
  /** Pide un CSRF nuevo tras un `403 csrf`; devuelve el token o null. */
  refreshCsrf?: () => Promise<string | null>;
}

interface Attempt {
  csrfRetried: boolean;
  busyRetried: boolean;
}

const BUSY_RETRY_MS = 500;

function isAbort(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError';
}

function withQuery(path: string, query?: Record<string, QueryValue>): string {
  if (!query) return path;
  const parts = Object.keys(query)
    .sort()
    .flatMap((k) => {
      const v = query[k];
      return v === undefined
        ? []
        : [`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`];
    });
  return parts.length > 0 ? `${path}?${parts.join('&')}` : path;
}

async function readHttpError(res: Response): Promise<HttpError> {
  let code = `http_${res.status}`;
  let message = '';
  try {
    const body = (await res.json()) as Partial<ApiError> | null;
    if (body && typeof body.code === 'string') code = body.code;
    if (body && typeof body.message_es === 'string') message = body.message_es;
  } catch {
    // Cuerpo ausente o no JSON: queda el código genérico.
  }
  return new HttpError(res.status, code, message);
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  let csrf: string | null = null;
  let unauthNotified = false;

  const exec = async (
    method: string,
    url: string,
    body: unknown,
    accept: string,
    signal: AbortSignal | undefined,
    attempt: Attempt,
  ): Promise<Response> => {
    const headers = new Headers({ Accept: accept });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (method !== 'GET') {
      const token = csrf ?? readCsrfCookie();
      if (token) headers.set('X-CSRF-Token', token);
    }

    let res: Response;
    try {
      res = await opts.transport(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        signal,
      });
    } catch (e) {
      if (isAbort(e)) throw e;
      throw new OfflineError();
    }

    if (res.ok) {
      unauthNotified = false;
      return res;
    }

    const err = await readHttpError(res);

    if (res.status === 401) {
      if (!unauthNotified) {
        unauthNotified = true;
        opts.onUnauthenticated();
      }
      throw err;
    }

    if (
      res.status === 403 &&
      err.code === 'csrf' &&
      !attempt.csrfRetried &&
      opts.refreshCsrf
    ) {
      attempt.csrfRetried = true;
      const next = await opts.refreshCsrf();
      if (next) {
        csrf = next;
        return exec(method, url, body, accept, signal, attempt);
      }
    }

    if (
      res.status === 503 &&
      err.code === 'busy' &&
      method === 'GET' &&
      !attempt.busyRetried
    ) {
      attempt.busyRetried = true;
      await new Promise((r) => setTimeout(r, BUSY_RETRY_MS));
      return exec(method, url, body, accept, signal, attempt);
    }

    throw err;
  };

  const json = async <T>(res: Response): Promise<T> => {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  };

  return {
    transport: opts.transport,
    csrfToken: () => csrf,
    setCsrfToken: (token) => {
      csrf = token;
    },
    async get<T>(
      path: string,
      query?: Record<string, QueryValue>,
      o?: RequestOpts,
    ): Promise<T> {
      const res = await exec(
        'GET',
        withQuery(path, query),
        undefined,
        'application/json',
        o?.signal,
        {
          csrfRetried: false,
          busyRetried: false,
        },
      );
      return json<T>(res);
    },
    async send<T>(
      method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      path: string,
      body?: unknown,
      o?: RequestOpts,
    ): Promise<T> {
      const res = await exec(
        method,
        path,
        body,
        'application/json',
        o?.signal,
        {
          csrfRetried: false,
          busyRetried: false,
        },
      );
      return json<T>(res);
    },
    async blob(path: string, o?: RequestOpts): Promise<Blob> {
      const res = await exec('GET', path, undefined, '*/*', o?.signal, {
        csrfRetried: false,
        busyRetried: false,
      });
      return res.blob();
    },
  };
}
