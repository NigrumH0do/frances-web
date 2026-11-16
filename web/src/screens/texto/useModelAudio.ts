// Audio modelo del texto libre (PRACTICE-01).
//
// Cuando el usuario deja de escribir `debounceMs`, pide `POST /api/practice/tts`
// con el texto normalizado y la voz elegida. Cada cambio aborta la petición
// anterior. Las respuestas se guardan en memoria por voz y texto, así volver a
// un texto ya oído no vuelve a pedirlo.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { HttpError, OfflineError } from '../../api/client';
import type { PracticeTtsOut } from '../../contracts/generated';

export const PRACTICE_TEXT_MAX = 400;
export const DEBOUNCE_MS = 900;

export type ModelAudioError = 'offline' | 'rate_limited' | 'unavailable';

export type ModelAudioState =
  | { status: 'idle' }
  | { status: 'waiting' }
  | { status: 'loading' }
  | { status: 'ready'; clip: PracticeTtsOut }
  | { status: 'error'; error: ModelAudioError };

/** Igual que el servidor: NFC, espacios colapsados y sin extremos. */
export function cleanPracticeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function hasLetters(text: string): boolean {
  return /\p{L}/u.test(text);
}

function errorKind(error: unknown): ModelAudioError {
  if (error instanceof OfflineError) return 'offline';
  if (error instanceof HttpError && error.status === 429) return 'rate_limited';
  return 'unavailable';
}

export function useModelAudio(
  text: string,
  voiceId: string | null,
  {
    online,
    debounceMs = DEBOUNCE_MS,
  }: { online: boolean; debounceMs?: number },
): {
  state: ModelAudioState;
  generate(): void;
  /** Clip de cualquier texto (p. ej. una palabra) con la voz actual. */
  clipFor(text: string, signal: AbortSignal): Promise<PracticeTtsOut>;
} {
  const api = useApi();
  const cache = useRef(new Map<string, PracticeTtsOut>());
  const controllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<ModelAudioState>({ status: 'idle' });
  const clean = cleanPracticeText(text);
  const valid =
    voiceId !== null &&
    clean.length > 0 &&
    clean.length <= PRACTICE_TEXT_MAX &&
    hasLetters(clean);

  const clipFor = useCallback(
    async (value: string, signal: AbortSignal): Promise<PracticeTtsOut> => {
      if (voiceId === null) throw new Error('sin voz');
      const cleaned = cleanPracticeText(value);
      const key = `${voiceId}\n${cleaned}`;
      const cached = cache.current.get(key);
      if (cached !== undefined) return cached;
      const clip = await api.practiceTts(
        { text: cleaned, voice_id: voiceId },
        { signal },
      );
      cache.current.set(key, clip);
      return clip;
    },
    [api, voiceId],
  );

  const request = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: 'loading' });
    clipFor(clean, controller.signal).then(
      (clip) => {
        if (!controller.signal.aborted) setState({ status: 'ready', clip });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: 'error', error: errorKind(error) });
        }
      },
    );
  }, [clean, clipFor]);

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (!valid || voiceId === null) {
      setState({ status: 'idle' });
      return undefined;
    }
    const cached = cache.current.get(`${voiceId}\n${clean}`);
    if (cached !== undefined) {
      setState({ status: 'ready', clip: cached });
      return undefined;
    }
    if (!online) {
      setState({ status: 'error', error: 'offline' });
      return undefined;
    }
    setState({ status: 'waiting' });
    const timer = setTimeout(request, debounceMs);
    return () => clearTimeout(timer);
  }, [clean, debounceMs, online, request, valid, voiceId]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const generate = useCallback(() => {
    if (valid) request();
  }, [request, valid]);

  return { state, generate, clipFor };
}
