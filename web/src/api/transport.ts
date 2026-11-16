// Transporte HTTP de la web v2. Es el subconjunto de `fetch` que usan el
// cliente de API y `askChat` (AI-16), para que los tests lo sustituyan sin red.

export type Transport = (input: string, init: RequestInit) => Promise<Response>;

// `MODE` lo fija Vite (`--mode demo` para el build de demostración).
export const IS_DEMO: boolean = import.meta.env.MODE === 'demo';

export async function defaultTransport(): Promise<Transport> {
  if (IS_DEMO) {
    const { createDemoTransport } = await import('../demo/transport');
    return createDemoTransport();
  }
  return (input, init) => fetch(input, init);
}
