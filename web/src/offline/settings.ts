import { getMeta, setMeta } from './db';

// Preferencias del dispositivo, no del usuario: viven en `meta` de la base
// v2 y `purgeUserData` las borra junto con la cola.

const OFFLINE_AUDIO_KEY = 'offline_audio';

export async function getOfflineAudio(): Promise<boolean> {
  return (await getMeta<boolean>(OFFLINE_AUDIO_KEY)) === true;
}

export async function setOfflineAudio(enabled: boolean): Promise<void> {
  await setMeta(OFFLINE_AUDIO_KEY, enabled);
}
