import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../api/ApiContext';
import type { UserPrefs, VoiceOut } from '../contracts/generated';

// Voces habilitadas y preferencias de voz del usuario. `setPreferred` guarda
// el resto de `UserPrefs` intacto: el servidor reemplaza el objeto completo.
export function useVoices(): {
  voices: VoiceOut[];
  preferred: string[];
  setPreferred(ids: string[]): Promise<void>;
} {
  const api = useApi();
  const [voices, setVoices] = useState<VoiceOut[]>([]);
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const prefsRef = useRef<UserPrefs | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api.voices({ signal: controller.signal }).then(
      (loaded) => {
        if (!controller.signal.aborted) {
          setVoices(loaded);
        }
      },
      () => undefined,
    );
    api.prefs({ signal: controller.signal }).then(
      (loaded) => {
        if (!controller.signal.aborted) {
          prefsRef.current = loaded;
          setPrefs(loaded);
        }
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [api]);

  const setPreferred = useCallback(
    async (ids: string[]) => {
      const base = prefsRef.current ?? (await api.prefs());
      const saved = await api.savePrefs({
        ...base,
        preferred_voice_ids: ids,
      });
      prefsRef.current = saved;
      setPrefs(saved);
    },
    [api],
  );

  return {
    voices,
    preferred: prefs?.preferred_voice_ids ?? [],
    setPreferred,
  };
}
