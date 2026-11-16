import { useApi } from '../../api/ApiContext';
import { useResource, type ResourceState } from '../../api/useResource';
import type { CardView } from '../../contracts/generated';
import { normalizePhoneme } from '../../pron/phonemeLabels';
import type { PracticeCard } from '../../ui/pron/PracticeSession';

export type PracticeMode = 'frases' | 'fonema';

export const PRACTICE_DECK_SIZE = 5;
const FETCH_BATCH_SIZE = 4;

// Estado del mazo de práctica. Además de las tarjetas que consume
// `PracticeSession`, expone las `CardView` completas para el audio de UI-11.
export type PracticeDeckState = ResourceState<PracticeCard[]> & {
  reload: () => void;
  views: ReadonlyMap<string, CardView>;
};

function toPractice(card: CardView): PracticeCard {
  return {
    id: card.id,
    front_fr: card.front_fr,
    back_es: card.back_es,
  };
}

async function loadByIds(
  api: ReturnType<typeof useApi>,
  ids: string[],
  signal: AbortSignal,
): Promise<CardView[]> {
  const cards: CardView[] = [];
  // Como máximo cuatro peticiones simultáneas: el mazo de un fonema puede
  // traer diez tarjetas y no conviene abrir diez conexiones a la vez.
  for (let start = 0; start < ids.length; start += FETCH_BATCH_SIZE) {
    const batch = ids.slice(start, start + FETCH_BATCH_SIZE);
    const loaded = await Promise.all(
      batch.map((id) => api.card(id, { signal })),
    );
    cards.push(...loaded);
  }
  return cards;
}

/**
 * Mazo de la práctica de pronunciación.
 *
 * - `frases`: tarjetas `phrase` de la cola de hoy (máx. 5). Si la cola no
 *   trae ninguna, usa las primeras de `/api/cards?kind=phrase`.
 * - `fonema`: las tarjetas del `DrillDeck` del fonema, pedidas de cuatro en
 *   cuatro con `/api/cards/{id}`.
 */
export function usePracticeDeck(
  mode: PracticeMode,
  phoneme?: string,
): PracticeDeckState {
  const api = useApi();
  const normalized = phoneme === undefined ? '' : normalizePhoneme(phoneme);
  const key =
    mode === 'frases' ? 'practice:frases' : `practice:fonema:${normalized}`;

  const resource = useResource<CardView[]>(key, async (signal) => {
    if (mode === 'frases') {
      const queue = await api.reviewQueue(undefined, { signal });
      const fromQueue = queue
        .filter((card) => card.kind === 'phrase')
        .slice(0, PRACTICE_DECK_SIZE);
      if (fromQueue.length > 0) {
        return fromQueue;
      }
      const page = await api.cards({ kind: 'phrase' }, { signal });
      return page.cards.slice(0, PRACTICE_DECK_SIZE);
    }

    if (normalized === '') {
      return [];
    }
    const decks = await api.drills({ signal });
    const deck =
      decks.find((item) => item.phoneme === normalized && item.curated) ??
      decks.find((item) => item.phoneme === normalized);
    if (deck === undefined) {
      return [];
    }
    const cards = await loadByIds(api, deck.card_ids, signal);
    return cards.filter((card) => !card.stale);
  });

  if (resource.status === 'ready') {
    return {
      status: 'ready',
      data: resource.data.map(toPractice),
      stale: resource.stale,
      reload: resource.reload,
      views: new Map(resource.data.map((card) => [card.id, card])),
    };
  }
  return {
    ...resource,
    reload: resource.reload,
    views: new Map<string, CardView>(),
  };
}
