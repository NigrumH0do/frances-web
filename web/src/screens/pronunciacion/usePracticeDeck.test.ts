import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { expect, test, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createApiClient } from '../../api/client';
import { fakeTransport, jsonResponse } from '../../api/testing';
import type { CardView, DrillDeck } from '../../contracts/generated';
import { usePracticeDeck } from './usePracticeDeck';

function card(id: string, overrides: Partial<CardView> = {}): CardView {
  return {
    id,
    kind: 'phrase',
    front_fr: `fr-${id}`,
    back_es: `es-${id}`,
    example_fr: null,
    example_es: null,
    notes: null,
    ipa: null,
    phonemes: [],
    tags: [],
    stale: false,
    source_item_ids: [`item-${id}`],
    audio: [],
    audio_pending: [],
    owner: 'shared',
    edited_by_human: false,
    source_changed: false,
    mine: null,
    state: null,
    ...overrides,
  };
}

const PHRASES = Array.from({ length: 6 }, (_, index) =>
  card(`p${index + 1}`, { front_fr: `phrase-${index + 1}` }),
);
const VOCAB = card('v1', { kind: 'vocab', front_fr: 'mot' });
const DECK: DrillDeck = {
  id: 'deck-r',
  phoneme: 'ʁ',
  title_es: 'La r francesa',
  curated: true,
  card_ids: ['d1', 'd2'],
};

function setup(routes: Record<string, unknown>) {
  const transport = fakeTransport(routes);
  const client = createApiClient({
    transport,
    onUnauthenticated: vi.fn(),
  });
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(ApiProvider, { client, children });
  }
  return { transport, wrapper };
}

test('frases usa la cola de hoy y corta a cinco tarjetas phrase', async () => {
  const { wrapper, transport } = setup({
    'GET /api/review/queue': [...PHRASES, VOCAB],
  });
  const { result } = renderHook(() => usePracticeDeck('frases'), { wrapper });

  await waitFor(() => expect(result.current.status).toBe('ready'));
  if (result.current.status !== 'ready') return;

  expect(result.current.data.map((item) => item.id)).toEqual([
    'p1',
    'p2',
    'p3',
    'p4',
    'p5',
  ]);
  expect(result.current.data.map((item) => item.front_fr)).toEqual([
    'phrase-1',
    'phrase-2',
    'phrase-3',
    'phrase-4',
    'phrase-5',
  ]);
  expect(
    transport.calls.some((call) => call.url.startsWith('/api/cards?')),
  ).toBe(false);
});

test('sin frases en la cola usa las primeras de /api/cards?kind=phrase', async () => {
  const { wrapper, transport } = setup({
    'GET /api/review/queue': [VOCAB],
    'GET /api/cards?kind=phrase': {
      cards: [PHRASES[0]!, PHRASES[1]!],
      next_cursor: null,
    },
  });
  const { result } = renderHook(() => usePracticeDeck('frases'), { wrapper });

  await waitFor(() => expect(result.current.status).toBe('ready'));
  if (result.current.status !== 'ready') return;

  expect(result.current.data.map((item) => item.id)).toEqual(['p1', 'p2']);
  expect(
    transport.calls.filter((call) => call.url === '/api/cards?kind=phrase'),
  ).toHaveLength(1);
});

test('modo fonema usa el mazo de taladro y pide las tarjetas de a cuatro', async () => {
  const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
  const cards = new Map(
    ids.map((id) => [id, card(id, { front_fr: `mot-${id}` })]),
  );
  const pending: Array<() => void> = [];
  let active = 0;
  let maxActive = 0;
  const routes: Record<string, unknown> = {
    'GET /api/drills': [
      { ...DECK, card_ids: ids },
      { ...DECK, id: 'deck-auto', curated: false },
    ],
  };
  for (const id of ids) {
    routes[`GET /api/cards/${id}`] = () =>
      new Promise<Response>((resolve) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        pending.push(() => {
          active -= 1;
          resolve(jsonResponse(cards.get(id)));
        });
      });
  }

  const { wrapper, transport } = setup(routes);
  const { result } = renderHook(() => usePracticeDeck('fonema', 'ʁ'), {
    wrapper,
  });

  // El mazo curado tiene prioridad y solo se piden cuatro tarjetas a la vez.
  await waitFor(() => expect(pending).toHaveLength(4));
  expect(maxActive).toBe(4);
  expect(
    transport.calls.filter((call) => call.url.startsWith('/api/cards/')),
  ).toHaveLength(4);

  await act(async () => {
    for (const done of pending.splice(0)) done();
  });
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(maxActive).toBe(4);

  await act(async () => {
    for (const done of pending.splice(0)) done();
  });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  if (result.current.status !== 'ready') return;

  expect(result.current.data.map((item) => item.id)).toEqual(ids);
  expect(result.current.views.get('c1')?.front_fr).toBe('mot-c1');
});

test('modo fonema sin mazo devuelve una lista vacía', async () => {
  const { wrapper } = setup({ 'GET /api/drills': [] });
  const { result } = renderHook(() => usePracticeDeck('fonema', 'ʁ'), {
    wrapper,
  });

  await waitFor(() => expect(result.current.status).toBe('ready'));
  if (result.current.status !== 'ready') return;
  expect(result.current.data).toEqual([]);
});
