// Máquina de estados del grabador (Task PRN-02).
//
// Sin dependencias de React: expone un objeto `Recorder` con estado observable.
// La grabación siempre arranca desde `start()` (llamado desde un gesto del
// usuario, requerido por Safari iOS) y las pistas del micrófono se detienen
// siempre antes de terminar. El audio nunca se persiste.

import type { PronResult } from '../contracts/generated';
import { createLevelMeter, type LevelMeter } from './levelMeter';
import { parseAzureResult } from './parse';
import type { Recognizer } from './recognizer';
import { RecognizerError } from './recognizer';
import { startTake, type Take } from './take';

export type RecorderState =
  | { status: 'idle' | 'requesting_mic' | 'recording' | 'scoring' }
  | { status: 'done'; result: PronResult; take?: Blob | null }
  | { status: 'error'; message: string };

export interface Recorder {
  getState(): RecorderState;
  subscribe(fn: (state: RecorderState) => void): () => void;
  start(referenceText: string, cardId: string | null): Promise<void>;
  abort(): void;
  getLevelMeter(): LevelMeter | null;
}

export interface RecorderOptions {
  captureTake?: boolean;
  meterRef?: { current: LevelMeter | null };
}

// Cadenas propias de P06 (R-18): no van a `es.ts` de WEB-01.
export const RECORDER_MESSAGES = {
  denied:
    'Permiso de micrófono denegado: actívalo en la configuración del navegador',
  no_microphone: 'No se encontró micrófono',
  unsupported: 'Este navegador no permite grabar aquí',
  no_match: 'No se escuchó nada, intenta de nuevo',
  unauthorized: 'Clave de Azure inválida',
  quota: 'Cuota de Azure agotada por ahora',
  canceled: 'No se pudo evaluar, intenta de nuevo',
} as const;

function defaultGetUserMedia(
  constraints: MediaStreamConstraints,
): Promise<MediaStream> {
  const devices = navigator.mediaDevices;
  if (!devices || typeof devices.getUserMedia !== 'function') {
    return Promise.reject(
      new DOMException('sin getUserMedia', 'NotSupportedError'),
    );
  }
  return devices.getUserMedia(constraints);
}

function micErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return RECORDER_MESSAGES.denied;
    }
    if (
      error.name === 'NotFoundError' ||
      error.name === 'DevicesNotFoundError'
    ) {
      return RECORDER_MESSAGES.no_microphone;
    }
    // Micrófono ocupado, interrumpido o con restricciones imposibles: el
    // navegador sí permite grabar, así que se invita a reintentar.
    if (
      error.name === 'NotReadableError' ||
      error.name === 'AbortError' ||
      error.name === 'OverconstrainedError'
    ) {
      return RECORDER_MESSAGES.canceled;
    }
  }
  return RECORDER_MESSAGES.unsupported;
}

function recognizerErrorMessage(error: unknown): string {
  if (error instanceof RecognizerError) {
    return RECORDER_MESSAGES[error.code];
  }
  return RECORDER_MESSAGES.canceled;
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export function createRecorder(
  recognizer: Recognizer,
  getUserMedia: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream> = defaultGetUserMedia,
  now: () => Date = () => new Date(),
  // `captureTake`: además de evaluar, graba la voz del usuario en memoria
  // (`take` del estado `done`) para que pueda oírse (ADR-018).
  // `meterRef`: medidor del mismo stream, creado en el gesto de `start`.
  options: RecorderOptions = {},
): Recorder {
  let state: RecorderState = { status: 'idle' };
  const listeners = new Set<(state: RecorderState) => void>();
  // Sesión en curso: cada `start` tiene su propio controller y su propio
  // stream. Una sesión abortada o reemplazada nunca toca el estado compartido.
  let session: {
    controller: AbortController;
    stream: MediaStream | null;
    take: Take | null;
    meter: LevelMeter | null;
  } | null = null;
  let activeMeter: LevelMeter | null = null;

  const releaseMeter = (mine: NonNullable<typeof session>) => {
    const meter = mine.meter;
    mine.meter = null;
    if (meter !== null) {
      try {
        meter.close();
      } catch {
        // Un fallo del medidor no cambia el estado de la toma.
      }
    }
    if (options.meterRef !== undefined && options.meterRef.current === meter) {
      options.meterRef.current = null;
    }
    if (activeMeter === meter) {
      activeMeter = null;
    }
  };

  const stopStream = (mine: NonNullable<typeof session>) => {
    const stream = mine.stream;
    mine.stream = null;
    releaseMeter(mine);
    if (stream) {
      stopTracks(stream);
    }
  };

  const setState = (next: RecorderState) => {
    state = next;
    for (const listener of listeners) {
      listener(next);
    }
  };

  return {
    getState: () => state,
    getLevelMeter: () => activeMeter,

    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    async start(referenceText, cardId) {
      if (
        state.status === 'requesting_mic' ||
        state.status === 'recording' ||
        state.status === 'scoring'
      ) {
        return;
      }
      let meter: LevelMeter | null = null;
      if (options.meterRef) {
        try {
          meter = createLevelMeter();
          options.meterRef.current = meter;
          meter?.resumeFromGesture();
        } catch {
          try {
            meter?.close();
          } catch {
            // El medidor no llegó a abrirse.
          }
          meter = null;
          options.meterRef.current = null;
        }
        activeMeter = meter;
      }
      const mine: {
        controller: AbortController;
        stream: MediaStream | null;
        take: Take | null;
        meter: LevelMeter | null;
      } = {
        controller: new AbortController(),
        stream: null,
        take: null,
        meter,
      };
      session = mine;
      const signal = mine.controller.signal;
      const isCurrent = () => session === mine && !signal.aborted;
      const finish = (next: RecorderState) => {
        mine.take?.cancel();
        mine.take = null;
        stopStream(mine);
        if (isCurrent()) {
          session = null;
          setState(next);
        }
      };
      setState({ status: 'requesting_mic' });

      let captured: MediaStream;
      try {
        captured = await getUserMedia({ audio: true });
      } catch (error) {
        finish({ status: 'error', message: micErrorMessage(error) });
        return;
      }
      if (!isCurrent()) {
        releaseMeter(mine);
        stopTracks(captured);
        return;
      }
      mine.stream = captured;
      try {
        mine.meter?.connect(captured);
      } catch {
        // Un stream falso no puede tumbar la evaluación.
      }
      if (options.captureTake === true) {
        mine.take = startTake(captured);
      }

      setState({ status: 'recording' });
      let outcome: { json: unknown; durationMs: number };
      try {
        outcome = await recognizer.assess(referenceText, signal);
      } catch (error) {
        finish({ status: 'error', message: recognizerErrorMessage(error) });
        return;
      }
      const take = mine.take;
      mine.take = null;
      const takeBlob = take === null ? null : await take.stop();
      stopStream(mine);
      if (!isCurrent()) {
        return;
      }

      setState({ status: 'scoring' });
      let next: RecorderState;
      try {
        const result = parseAzureResult(
          outcome.json,
          referenceText,
          cardId,
          now(),
          outcome.durationMs,
        );
        next =
          options.captureTake === true
            ? { status: 'done', result, take: takeBlob }
            : { status: 'done', result };
      } catch {
        // `PronParseError` es el caso esperado; cualquier otro error del
        // parser (p. ej. TypeError) tampoco debe dejar el grabador en `scoring`.
        next = { status: 'error', message: RECORDER_MESSAGES.canceled };
      }
      finish(next);
    },

    abort() {
      const current = session;
      session = null;
      if (current) {
        current.controller.abort();
        current.take?.cancel();
        current.take = null;
        stopStream(current);
      }
      if (state.status !== 'idle') {
        setState({ status: 'idle' });
      }
    },
  };
}
