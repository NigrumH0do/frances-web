import { describe, expect, test } from 'vitest';
import { parseSse } from './sse';

function streamOf(
  ...parts: (string | Uint8Array)[]
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      parts.forEach((p) =>
        c.enqueue(typeof p === 'string' ? enc.encode(p) : p),
      );
      c.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>) {
  const out: { event: string; data: string }[] = [];
  for await (const e of parseSse(body)) out.push(e);
  return out;
}

describe('parseSse', () => {
  test('parsea eventos partidos entre trozos, CRLF, pings y UTF-8 partido', async () => {
    const bytes = new TextEncoder().encode('é');
    const body = streamOf(
      'event: token\r\ndata: {"kind":"token","text":"',
      bytes.slice(0, 1),
      bytes.slice(1),
      '"}\r\n\r\n: ping\n\n',
      'event: done\ndata: {"kind":"done"}\n\n',
    );
    expect(await collect(body)).toEqual([
      { event: 'token', data: '{"kind":"token","text":"é"}' },
      { event: 'done', data: '{"kind":"done"}' },
    ]);
  });

  test('evento por defecto message, varias líneas data unidas con \\n, separador \\r suelto', async () => {
    const body = streamOf('data: uno\ndata: dos\r\r');
    expect(await collect(body)).toEqual([
      { event: 'message', data: 'uno\ndos' },
    ]);
  });

  test('un \\r al final de un trozo y \\n al inicio del siguiente cuentan como un solo salto', async () => {
    const body = streamOf('data: x\r', '\ndata: y\n\n');
    expect(await collect(body)).toEqual([{ event: 'message', data: 'x\ny' }]);
  });

  test('descarta el último evento sin línea en blanco final', async () => {
    const body = streamOf('event: done\ndata: {"kind":"done"}\n');
    expect(await collect(body)).toEqual([]);
  });
});
