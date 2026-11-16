// Reductor puro de la sesión de repaso. No toca red, bases de datos ni el
// reloj: recibe tarjetas ya cargadas y devuelve el estado siguiente.

import type { CardView } from '../contracts/generated';
import type { UiError } from '../api/client';
import type { Rating } from '../srs/types';

export interface SessionState {
  queue: CardView[];
  index: number;
  flipped: boolean;
  done: number;
  again: string[];
  error: UiError | null;
}

export type SessionAction =
  | { type: 'load'; cards: CardView[] }
  | { type: 'flip' }
  | { type: 'rated'; rating: Rating; card?: CardView }
  | { type: 'skip' }
  | { type: 'removed' }
  | { type: 'refresh'; card: CardView }
  | { type: 'error'; error: UiError | null };

export function initialSessionState(): SessionState {
  return {
    queue: [],
    index: 0,
    flipped: false,
    done: 0,
    again: [],
    error: null,
  };
}

export function currentCard(state: SessionState): CardView | null {
  return state.queue[state.index] ?? null;
}

export function reviewReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case 'load':
      return { ...initialSessionState(), queue: action.cards };

    case 'flip':
      if (currentCard(state) === null) return state;
      return { ...state, flipped: !state.flipped };

    case 'rated': {
      const card = currentCard(state);
      if (card === null) return state;

      const updated = action.card ?? card;
      let queue = state.queue.map((c) => (c.id === card.id ? updated : c));
      let again = state.again;
      // «Otra vez» devuelve la tarjeta al final de la sesión, una sola vez.
      if (action.rating === 1 && !state.again.includes(card.id)) {
        queue = [...queue, updated];
        again = [...state.again, card.id];
      }
      return {
        ...state,
        queue,
        index: state.index + 1,
        flipped: false,
        done: state.done + 1,
        again,
      };
    }

    case 'skip':
      if (currentCard(state) === null) return state;
      return { ...state, index: state.index + 1, flipped: false };

    case 'removed': {
      if (currentCard(state) === null) return state;
      const queue = state.queue.filter((_, i) => i !== state.index);
      return {
        ...state,
        queue,
        index: Math.min(state.index, queue.length),
        flipped: false,
      };
    }

    case 'refresh':
      return {
        ...state,
        queue: state.queue.map((c) =>
          c.id === action.card.id ? action.card : c,
        ),
      };

    case 'error':
      return { ...state, error: action.error };
  }
}
