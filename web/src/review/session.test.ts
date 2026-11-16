import type { CardView } from '../contracts/generated';
import {
  currentCard,
  initialSessionState,
  reviewReducer,
  type SessionState,
} from './session';

function card(id: string): CardView {
  return {
    id,
    kind: 'vocab',
    front_fr: `fr-${id}`,
    back_es: `es-${id}`,
    example_fr: null,
    example_es: null,
    notes: null,
    ipa: null,
    phonemes: [],
    tags: [],
    stale: false,
    source_item_ids: [`i-${id}`],
    audio: [],
    audio_pending: [],
    owner: 'shared',
    edited_by_human: false,
    source_changed: false,
    mine: null,
    state: null,
  };
}

const CARD_A = card('a');
const CARD_B = card('b');
const CARD_C = card('c');

function loaded(): SessionState {
  return reviewReducer(initialSessionState(), {
    type: 'load',
    cards: [CARD_A, CARD_B, CARD_C],
  });
}

test('load deja la cola al inicio y sin error', () => {
  const state = loaded();
  expect(state.queue.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  expect(state.index).toBe(0);
  expect(state.flipped).toBe(false);
  expect(state.done).toBe(0);
  expect(state.again).toEqual([]);
  expect(state.error).toBeNull();
  expect(currentCard(state)?.id).toBe('a');
});

test('flip alterna la respuesta solo cuando hay tarjeta', () => {
  let state = loaded();
  state = reviewReducer(state, { type: 'flip' });
  expect(state.flipped).toBe(true);
  state = reviewReducer(state, { type: 'flip' });
  expect(state.flipped).toBe(false);

  const finished = reviewReducer(state, { type: 'load', cards: [] });
  expect(reviewReducer(finished, { type: 'flip' })).toBe(finished);
});

test('rated avanza, cuenta y vuelve a ocultar la respuesta', () => {
  let state = reviewReducer(loaded(), { type: 'flip' });
  state = reviewReducer(state, { type: 'rated', rating: 3 });
  expect(state.index).toBe(1);
  expect(state.done).toBe(1);
  expect(state.flipped).toBe(false);
  expect(currentCard(state)?.id).toBe('b');
});

test('Otra vez repite la tarjeta al final una sola vez', () => {
  let state = loaded();
  state = reviewReducer(state, { type: 'rated', rating: 1 });

  expect(state.queue.map((c) => c.id)).toEqual(['a', 'b', 'c', 'a']);
  expect(state.again).toEqual(['a']);
  expect(currentCard(state)?.id).toBe('b');

  // La copia repetida también se califica: no se vuelve a encolar.
  state = reviewReducer(state, { type: 'rated', rating: 2 });
  state = reviewReducer(state, { type: 'rated', rating: 2 });
  expect(currentCard(state)?.id).toBe('a');
  state = reviewReducer(state, { type: 'rated', rating: 1 });
  expect(state.queue.map((c) => c.id)).toEqual(['a', 'b', 'c', 'a']);
  expect(state.again).toEqual(['a']);
  expect(currentCard(state)).toBeNull();
});

test('rated con una tarjeta actualizada guarda el nuevo estado en la cola', () => {
  const updated: CardView = {
    ...CARD_A,
    front_fr: 'fr-a (actualizada)',
  };
  const state = reviewReducer(loaded(), {
    type: 'rated',
    rating: 3,
    card: updated,
  });
  expect(state.queue[0].front_fr).toBe('fr-a (actualizada)');
});

test('skip avanza sin contar la tarjeta como repasada', () => {
  const state = reviewReducer(loaded(), { type: 'skip' });
  expect(state.index).toBe(1);
  expect(state.done).toBe(0);
  expect(state.flipped).toBe(false);
});

test('removed quita la tarjeta suspendida y deja la siguiente en su sitio', () => {
  let state = reviewReducer(loaded(), { type: 'flip' });
  state = reviewReducer(state, { type: 'removed' });

  expect(state.queue.map((c) => c.id)).toEqual(['b', 'c']);
  expect(state.index).toBe(0);
  expect(currentCard(state)?.id).toBe('b');
  expect(state.flipped).toBe(false);
});

test('removed en la última tarjeta termina la sesión', () => {
  const last: SessionState = {
    ...initialSessionState(),
    queue: [CARD_A],
  };
  const state = reviewReducer(last, { type: 'removed' });
  expect(state.queue).toEqual([]);
  expect(currentCard(state)).toBeNull();
});

test('refresh reemplaza la tarjeta por la versión recargada', () => {
  const refreshed: CardView = { ...CARD_A, back_es: 'es-a (recargada)' };
  const state = reviewReducer(loaded(), {
    type: 'refresh',
    card: refreshed,
  });
  expect(state.queue[0].back_es).toBe('es-a (recargada)');
  expect(state.index).toBe(0);
});

test('error guarda y limpia el error de la sesión', () => {
  const state = reviewReducer(loaded(), {
    type: 'error',
    error: { kind: 'offline' },
  });
  expect(state.error).toEqual({ kind: 'offline' });
  expect(reviewReducer(state, { type: 'error', error: null }).error).toBeNull();
});
