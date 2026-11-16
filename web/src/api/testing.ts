import type { Transport } from './transport';

// Transporte falso para tests de la web (P09): sin red, con registro de
// cada llamada. Las claves de `routes` son "MÉTODO /ruta?query" exactas.
// Un valor puede ser el cuerpo JSON, una función que recibe la petición o
// `offline()`, que simula una caída de red.

export interface FakeCall {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

export interface FakeRequest {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

export type FakeTransport = Transport & { calls: FakeCall[] };

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function offline(): () => Promise<never> {
  return () => Promise.reject(new TypeError('Failed to fetch'));
}

export function fakeTransport(routes: Record<string, unknown>): FakeTransport {
  const calls: FakeCall[] = [];
  const transport = async (
    input: string,
    init: RequestInit,
  ): Promise<Response> => {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const body =
      typeof init.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : undefined;
    calls.push({
      method,
      url: input,
      headers,
      body,
      credentials: init.credentials,
    });
    const key = `${method} ${input}`;
    if (!(key in routes)) {
      return jsonResponse({ code: 'fake_missing_route', message_es: key }, 500);
    }
    const route = routes[key];
    if (typeof route === 'function') {
      const res = await (
        route as (req: FakeRequest) => Response | Promise<Response>
      )({
        method,
        url: input,
        headers,
        body,
      });
      return res;
    }
    return jsonResponse(route);
  };
  return Object.assign(transport, { calls });
}
