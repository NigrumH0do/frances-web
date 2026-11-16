/** Un evento de un flujo `text/event-stream`. `event` es `message` si el servidor no lo indica. */
export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Cuerpo de la línea terminada en `\n`, `\r\n` o `\r`, o null si la línea
 * aún no está completa. Un `\r` al final del buffer espera al siguiente trozo,
 * porque puede ser el primer byte de un `\r\n` partido.
 */
function takeLine(
  buf: string,
  final: boolean,
): { line: string; rest: string } | null {
  for (let i = 0; i < buf.length; i++) {
    const ch = buf[i];
    if (ch === '\n') return { line: buf.slice(0, i), rest: buf.slice(i + 1) };
    if (ch === '\r') {
      if (i + 1 < buf.length) {
        const skip = buf[i + 1] === '\n' ? 2 : 1;
        return { line: buf.slice(0, i), rest: buf.slice(i + skip) };
      }
      if (final) return { line: buf.slice(0, i), rest: '' };
      return null;
    }
  }
  return null;
}

/**
 * Parsea un flujo SSE con la especificación de `text/event-stream`.
 * Un evento sin línea en blanco final se descarta.
 */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let eventName = '';
  let dataLines: string[] = [];
  let finished = false;
  try {
    while (!finished) {
      const chunk = await reader.read();
      finished = chunk.done;
      if (chunk.done) {
        buf += decoder.decode();
      } else {
        buf += decoder.decode(chunk.value, { stream: true });
      }
      let taken = takeLine(buf, finished);
      while (taken !== null) {
        buf = taken.rest;
        const line = taken.line;
        if (line === '') {
          if (dataLines.length > 0) {
            yield { event: eventName || 'message', data: dataLines.join('\n') };
          }
          eventName = '';
          dataLines = [];
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          let value = colon < 0 ? '' : line.slice(colon + 1);
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'event') eventName = value;
          else if (field === 'data') dataLines.push(value);
        }
        taken = takeLine(buf, finished);
      }
    }
  } finally {
    // Cierra el cuerpo si el consumidor deja de leer antes del final.
    reader.cancel().catch(() => undefined);
  }
}
