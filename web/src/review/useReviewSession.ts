// Sesión de repaso sobre la API: carga la cola, calcula la reseña FSRS en el
// cliente (R-38), la guarda en el servidor y encola las escrituras cuando no
// hay red (UI-07). No usa `srs/store.ts` (IndexedDB v1): el estado vive en el
// servidor.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { CardFlagsIn, CardView } from '../contracts/generated';
import { useApi } from '../api/ApiContext';
import { HttpError, OfflineError, toUiError } from '../api/client';
import { useResource, type ResourceState } from '../api/useResource';
import { useOffline } from '../offline/OfflineContext';
import type { Rating } from '../srs/types';
import { rate } from './fsrs';
import {
  currentCard,
  initialSessionState,
  reviewReducer,
  type SessionState,
} from './session';

export interface ReviewSession {
  state: SessionState;
  resource: ResourceState<CardView[]>;
  flip(): void;
  grade(r: Rating): Promise<void>;
  suspend(): Promise<void>;
  markHard(): Promise<void>;
  reload(): void;
  /** Texto para el `aria-live` de la pantalla; `null` cuando no hay aviso. */
  announcement: string | null;
}

export function useReviewSession(): ReviewSession {
  const api = useApi();
  const { enqueue } = useOffline();
  const [state, dispatch] = useReducer(
    reviewReducer,
    undefined,
    initialSessionState,
  );
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const resource = useResource('review-queue', (signal) =>
    api.reviewQueue(undefined, { signal }),
  );
  const cards = resource.status === 'ready' ? resource.data : null;
  useEffect(() => {
    if (cards !== null) dispatch({ type: 'load', cards });
  }, [cards]);

  const patchFlags = useCallback(
    async (cardId: string, body: CardFlagsIn) => {
      try {
        await api.cardFlags(cardId, body);
        setAnnouncement('Guardado');
      } catch (e) {
        if (e instanceof OfflineError) {
          await enqueue({ kind: 'flags', cardId, body });
          setAnnouncement('Guardado sin conexión');
          return;
        }
        dispatch({ type: 'error', error: toUiError(e) });
      }
    },
    [api, enqueue],
  );

  const flip = useCallback(() => {
    dispatch({ type: 'flip' });
  }, []);

  const grade = useCallback(
    async (rating: Rating) => {
      const card = currentCard(stateRef.current);
      if (card === null) return;

      const body = rate(card, rating, new Date());
      const optimistic: CardView = {
        ...card,
        state: {
          card_id: card.id,
          fsrs: body.next,
          suspended: card.state?.suspended ?? false,
          flagged_hard: card.state?.flagged_hard ?? false,
          updated_at: body.reviewed_at,
        },
      };
      // Optimista: la interfaz avanza antes de que responda la red.
      dispatch({ type: 'rated', rating, card: optimistic });
      setAnnouncement(null);

      try {
        const saved = await api.review(body);
        dispatch({ type: 'refresh', card: { ...optimistic, state: saved } });
        setAnnouncement('Guardado');
      } catch (e) {
        if (e instanceof OfflineError) {
          await enqueue({ kind: 'review', body });
          setAnnouncement('Guardado sin conexión');
          return;
        }
        if (e instanceof HttpError && e.status === 409) {
          // Otra reseña más nueva ganó (otro dispositivo): se descarta esta y
          // se recarga el estado de la tarjeta. La sesión ya avanzó.
          try {
            const fresh = await api.card(card.id);
            dispatch({ type: 'refresh', card: fresh });
          } catch {
            // Sin red o tarjeta ya no visible: la próxima carga trae el estado.
          }
          return;
        }
        dispatch({ type: 'error', error: toUiError(e) });
      }
    },
    [api, enqueue],
  );

  const suspend = useCallback(async () => {
    const card = currentCard(stateRef.current);
    if (card === null) return;
    dispatch({ type: 'removed' });
    setAnnouncement(null);
    await patchFlags(card.id, { suspended: true });
  }, [patchFlags]);

  const markHard = useCallback(async () => {
    const card = currentCard(stateRef.current);
    if (card === null) return;
    if (card.state !== null) {
      dispatch({
        type: 'refresh',
        card: { ...card, state: { ...card.state, flagged_hard: true } },
      });
    }
    setAnnouncement(null);
    await patchFlags(card.id, { flagged_hard: true });
  }, [patchFlags]);

  return {
    state,
    resource,
    flip,
    grade,
    suspend,
    markHard,
    reload: resource.reload,
    announcement,
  };
}
