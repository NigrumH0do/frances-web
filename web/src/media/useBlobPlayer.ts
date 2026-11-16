// Reproduce un audio a la vez a partir de un `Blob` (la toma del usuario, el
// modelo o una palabra). Crea la URL de objeto al reproducir y la revoca al
// terminar, al cambiar de audio y al desmontar.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type BlobSource = Blob | ((signal: AbortSignal) => Promise<Blob>);

export interface BlobPlayer {
  /** Id del audio que suena, o `null`. */
  playingId: string | null;
  /** `true` mientras se carga el audio de `playingId`. */
  loading: boolean;
  play(id: string, source: BlobSource, rate?: number): Promise<void>;
  stop(): void;
}

export function useBlobPlayer(): BlobPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const release = useCallback(() => {
    if (urlRef.current !== null) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    const element = audioRef.current;
    if (element !== null) {
      element.pause();
      element.removeAttribute('src');
    }
    release();
    setPlayingId(null);
    setLoading(false);
  }, [release]);

  useEffect(() => stop, [stop]);

  const play = useCallback(
    async (id: string, source: BlobSource, rate = 1): Promise<void> => {
      stop();
      const controller = new AbortController();
      controllerRef.current = controller;
      setPlayingId(id);
      let blob: Blob;
      try {
        if (typeof source === 'function') {
          setLoading(true);
          blob = await source(controller.signal);
        } else {
          blob = source;
        }
      } catch {
        if (controllerRef.current === controller) {
          setPlayingId(null);
          setLoading(false);
        }
        return;
      }
      if (controller.signal.aborted) return;
      setLoading(false);
      if (audioRef.current === null) {
        audioRef.current = new Audio();
      }
      const element = audioRef.current;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      element.src = url;
      element.playbackRate = rate;
      element.onended = () => {
        if (controllerRef.current === controller) {
          release();
          setPlayingId(null);
        }
      };
      try {
        await element.play();
      } catch {
        // Autoplay bloqueado o formato no soportado: se deja de mostrar «sonando».
        if (controllerRef.current === controller) {
          release();
          setPlayingId(null);
        }
      }
    },
    [release, stop],
  );

  return useMemo(
    () => ({ playingId, loading, play, stop }),
    [loading, play, playingId, stop],
  );
}
