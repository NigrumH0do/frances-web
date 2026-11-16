// Toma propia del usuario mientras se evalúa la pronunciación (ADR-018).
//
// Graba con `MediaRecorder` el mismo stream del micrófono que abrió el
// grabador, para que el usuario pueda oírse y compararse con el modelo. El
// audio vive solo en memoria (un `Blob`): nunca va a disco, a IndexedDB ni a
// la red, igual que el resto de la práctica (R-42).

export interface Take {
  /** Detiene la toma y devuelve el audio, o `null` si no se grabó nada. */
  stop(): Promise<Blob | null>;
  /** Descarta la toma sin esperar el audio. */
  cancel(): void;
}

export function startTake(stream: MediaStream): Take | null {
  if (typeof MediaRecorder === 'undefined') {
    return null;
  }
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream);
    recorder.start();
  } catch {
    return null;
  }

  const chunks: Blob[] = [];
  let cancelled = false;
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const collect = (): Blob | null =>
    cancelled || chunks.length === 0
      ? null
      : new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });

  return {
    stop() {
      return new Promise<Blob | null>((resolve) => {
        if (recorder.state === 'inactive') {
          resolve(collect());
          return;
        }
        recorder.onstop = () => resolve(collect());
        try {
          recorder.stop();
        } catch {
          resolve(null);
        }
      });
    },
    cancel() {
      cancelled = true;
      try {
        recorder.stop();
      } catch {
        // Ya estaba detenido.
      }
    },
  };
}
