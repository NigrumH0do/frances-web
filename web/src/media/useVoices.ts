import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useApi } from '../api/ApiContext';
import type { UserPrefs, VoiceOut } from '../contracts/generated';

type Api = ReturnType<typeof useApi>;

type VoiceSnapshot = {
  voices: VoiceOut[];
  preferred: string[];
};

// Caché compartida por cliente de la API (B6, LIVE-A2 H-B): los 127
// `CardAudio` de una publicación comparten 1 `GET /api/voices` y 1
// `GET /api/me/prefs`, deduplicando también las peticiones en vuelo. El
// `WeakMap` va indexado por `api.client`, la instancia única de cada
// `ApiProvider`: en la app viva hay un cliente por sesión y en Vitest cada
// test crea el suyo, así que no hay contaminación entre tests ni reset manual.
const EMPTY_VOICES: VoiceOut[] = [];
const EMPTY_IDS: string[] = [];

const stores = new WeakMap<object, VoiceStore>();

interface VoiceStore {
  api: Api;
  voices: VoiceOut[] | null;
  prefs: UserPrefs | null;
  voicesRequest: Promise<VoiceOut[]> | null;
  prefsRequest: Promise<UserPrefs> | null;
  snapshot: VoiceSnapshot;
  listeners: Set<() => void>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): VoiceSnapshot;
}

// Avisa a todos los hooks suscritos del `store`. La instantánea se reemplaza
// (nunca se muta) para que `useSyncExternalStore` compare por identidad.
function publish(store: VoiceStore): void {
  store.snapshot = {
    voices: store.voices ?? EMPTY_VOICES,
    preferred: store.prefs?.preferred_voice_ids ?? EMPTY_IDS,
  };
  for (const listener of [...store.listeners]) {
    listener();
  }
}

function createStore(api: Api): VoiceStore {
  const store: VoiceStore = {
    api,
    voices: null,
    prefs: null,
    voicesRequest: null,
    prefsRequest: null,
    snapshot: { voices: EMPTY_VOICES, preferred: EMPTY_IDS },
    listeners: new Set(),
    subscribe(listener) {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    getSnapshot() {
      return store.snapshot;
    },
  };
  return store;
}

function storeFor(api: Api): VoiceStore {
  const key: object = api.client;
  const existing = stores.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = createStore(api);
  stores.set(key, created);
  return created;
}

// La petición es de todos los suscriptores: desmontar uno solo cancela su
// suscripción, nunca la descarga. Una petición en vuelo se comparte tal cual.
function loadVoices(store: VoiceStore): Promise<VoiceOut[]> {
  if (store.voices !== null) {
    return Promise.resolve(store.voices);
  }
  if (store.voicesRequest === null) {
    store.voicesRequest = store.api.voices().then(
      (loaded) => {
        store.voices = loaded;
        publish(store);
        return loaded;
      },
      (error: unknown) => {
        // Un fallo (p. ej. offline temporal) no se memoriza: el siguiente
        // montaje vuelve a intentarlo.
        store.voicesRequest = null;
        throw error;
      },
    );
  }
  return store.voicesRequest;
}

function loadPrefs(store: VoiceStore): Promise<UserPrefs> {
  if (store.prefs !== null) {
    return Promise.resolve(store.prefs);
  }
  if (store.prefsRequest === null) {
    store.prefsRequest = store.api.prefs().then(
      (loaded) => {
        store.prefs = loaded;
        publish(store);
        return loaded;
      },
      (error: unknown) => {
        store.prefsRequest = null;
        throw error;
      },
    );
  }
  return store.prefsRequest;
}

// Voces habilitadas y preferencias de voz del usuario. `setPreferred` guarda
// el resto de `UserPrefs` intacto (el servidor reemplaza el objeto completo) y
// avisa a los demás suscriptores del store sin volver a pedir preferencias.
export function useVoices(): {
  voices: VoiceOut[];
  preferred: string[];
  setPreferred(ids: string[]): Promise<void>;
} {
  const api = useApi();
  const store = useMemo(() => storeFor(api), [api]);
  const { voices, preferred } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  useEffect(() => {
    void loadVoices(store).catch(() => undefined);
    void loadPrefs(store).catch(() => undefined);
  }, [store]);

  const setPreferred = useCallback(
    async (ids: string[]) => {
      const base = store.prefs ?? (await loadPrefs(store));
      const saved = await store.api.savePrefs({
        ...base,
        preferred_voice_ids: ids,
      });
      store.prefs = saved;
      publish(store);
    },
    [store],
  );

  return { voices, preferred, setPreferred };
}
