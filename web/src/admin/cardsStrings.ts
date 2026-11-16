import type { CardView } from '../contracts/generated';

const KIND_LABELS: Record<CardView['kind'], string> = {
  vocab: 'Vocabulario',
  phrase: 'Frase',
  grammar: 'Gramática',
  conjugation: 'Conjugación',
  drill: 'Taladro',
};

// Textos de la pantalla de tarjetas del admin (MGT-08).
export const cardsStrings = {
  title: 'Tarjetas',
  intro:
    'Busca y filtra las tarjetas. Puedes editar o borrar las compartidas y regenerar sus tarjetas y audios.',
  search: 'Buscar tarjetas',
  item: 'Publicación',
  searchAction: 'Buscar',
  clear: 'Limpiar',
  kinds: KIND_LABELS,
  own: 'Propia',
  copy: 'Copia personal',
  edited: 'Editada por una persona',
  changed: 'La publicación cambió',
  stale: 'Desactualizada',
  hard: 'Difícil',
  suspended: 'Suspendida',
  source: (ids: string) => `Publicación: ${ids}`,
  empty: 'No hay tarjetas',
  emptyFiltered: 'No hay tarjetas con esos filtros',
} as const;
