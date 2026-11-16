import type { ApiClient } from '../api/client';
import type { endpoints } from '../api/endpoints';
import type { CardView } from '../contracts/generated';

// Precarga para el modo sin conexión: pide a la API las pantallas de hoy (el
// service worker guarda cada GET) y, si el usuario lo activó, los clips de
// audio de la cola de repaso.

export type PrefetchApi = ReturnType<typeof endpoints> & {
  client: Pick<ApiClient, 'blob'>;
};

export interface PrefetchOptions {
  audio: boolean;
  signal?: AbortSignal;
}

const MAX_AUDIO_CLIPS = 100;
const AUDIO_CONCURRENCY = 4;

function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError';
}

function audioUrls(cards: CardView[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    for (const clip of card.audio) {
      if (seen.has(clip.url)) continue;
      seen.add(clip.url);
      urls.push(clip.url);
      if (urls.length >= MAX_AUDIO_CLIPS) return urls;
    }
  }
  return urls;
}

async function downloadClips(
  client: Pick<ApiClient, 'blob'>,
  urls: string[],
  signal: AbortSignal | undefined,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < urls.length) {
      if (signal?.aborted) return;
      const url = urls[next];
      next += 1;
      if (url === undefined) return;
      try {
        await client.blob(url, { signal });
      } catch (error) {
        if (isAbort(error)) throw error;
        // Un clip caído no cancela la precarga del resto.
      }
    }
  };

  const workers = Math.min(AUDIO_CONCURRENCY, urls.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

export async function prefetchForOffline(
  api: PrefetchApi,
  opts: PrefetchOptions,
): Promise<void> {
  const { signal } = opts;
  const [, queue] = await Promise.all([
    api.planToday({ signal }),
    api.reviewQueue(50, { signal }),
    api.prefs({ signal }),
    api.stats({ signal }),
    api.voices({ signal }),
    api.studyStatus({ signal }),
  ]);

  if (!opts.audio) return;
  await downloadClips(api.client, audioUrls(queue), signal);
}
