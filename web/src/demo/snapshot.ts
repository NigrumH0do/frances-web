import type { ChatEvent, Me } from '../contracts/generated';

// Formato de la instantánea que genera `scripts/demo_api_snapshot.py` (UI-20).
// `routes` mapea "MÉTODO /ruta?query ordenada" al archivo JSON del cuerpo.

export interface DemoCredentials {
  email: string;
  password: string;
}

export interface DemoChatEntry {
  question: string;
  events: ChatEvent[];
}

export interface DemoIndex {
  version: number;
  generated_at: string;
  me: Me;
  demo_credentials: DemoCredentials;
  invite_token: string;
  routes: Record<string, string>;
  quiz_keys: Record<string, Record<string, string | string[]>>;
  chat: DemoChatEntry[];
}

export const DEMO_DIR = 'demo-api/';

export function demoUrl(base: string, path: string): string {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${DEMO_DIR}${path.replace(/^\/+/, '')}`;
}

/** Carga `demo-api/index.json`. El service worker la guarda en `DEMO_CACHE`. */
export async function loadIndex(
  base = import.meta.env.BASE_URL,
): Promise<DemoIndex> {
  const res = await fetch(demoUrl(base, 'index.json'));
  if (!res.ok) {
    throw new Error(
      `No se pudo cargar la instantánea del demo (${res.status})`,
    );
  }
  return (await res.json()) as DemoIndex;
}

function compareEntries(
  [ka, va]: [string, string],
  [kb, vb]: [string, string],
): number {
  if (ka !== kb) return ka < kb ? -1 : 1;
  if (va === vb) return 0;
  return va < vb ? -1 : 1;
}

/** Clave de una ruta con la query ordenada, igual que la instantánea. */
export function routeKey(method: string, url: string): string {
  const parsed = new URL(url, 'https://demo.invalid');
  const query = [...parsed.searchParams.entries()]
    .sort(compareEntries)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join('&');
  return `${method.toUpperCase()} ${parsed.pathname}${query ? `?${query}` : ''}`;
}
