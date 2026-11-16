import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { JSX } from 'react';
import { useApi } from '../api/ApiContext';
import type { AudioClip, CardView } from '../contracts/generated';
import { ClipPlayer } from '../ui/AudioPlayer';
import { useVoices } from './useVoices';

// Audio v2 de una tarjeta: los clips traen su URL completa de la API
// (`AudioClip.url`, SRV-09); aquí nunca se arma una ruta con otros campos.
export function CardAudio({
  card,
  field,
}: {
  card: CardView;
  field: 'front' | 'example';
}): JSX.Element {
  const api = useApi();
  const { voices, preferred } = useVoices();
  const current = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      current.current?.abort();
    };
  }, []);

  const loadFor = useCallback(
    (clip: AudioClip) =>
      (signal: AbortSignal): Promise<Blob> => {
        // CHG-13 no aborta la carga anterior al cambiar de clip (error 27).
        // CardAudio la aborta aquí; la promesa abandonada no se resuelve para
        // que `ClipPlayer.play()` no reproduzca el clip viejo ni deje una
        // promesa rechazada sin manejar.
        current.current?.abort();
        const controller = new AbortController();
        current.current = controller;
        const forwardAbort = () => controller.abort();
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener('abort', forwardAbort, { once: true });
        }

        return new Promise<Blob>((resolve, reject) => {
          api.client.blob(clip.url, { signal: controller.signal }).then(
            (blob) => {
              signal.removeEventListener('abort', forwardAbort);
              if (!controller.signal.aborted) {
                resolve(blob);
              }
            },
            (error: unknown) => {
              signal.removeEventListener('abort', forwardAbort);
              if (!controller.signal.aborted) {
                reject(error);
              }
            },
          );
        });
      },
    [api],
  );

  const clips = useMemo(
    () =>
      card.audio
        .filter((clip) => clip.field === field)
        .map((clip) => ({
          voice_id: clip.voice_id,
          load: loadFor(clip),
        })),
    [card.audio, field, loadFor],
  );
  const pendingVoiceIds = useMemo(
    () =>
      card.audio_pending
        .filter((pending) => pending.field === field)
        .map((pending) => pending.voice_id),
    [card.audio_pending, field],
  );

  return (
    <ClipPlayer
      clips={clips}
      pendingVoiceIds={pendingVoiceIds}
      voices={voices}
      preferred={preferred}
    />
  );
}
