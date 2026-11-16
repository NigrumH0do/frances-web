import type { CardView, OwnCardIn } from '../contracts/generated';

// Textos de la gestión de tarjetas (MGT-08). Todo en español.

export type CardEditorMode = 'override' | 'admin' | 'own';
export type OwnCardKind = OwnCardIn['kind'];

const KIND_LABELS: Record<CardView['kind'], string> = {
  vocab: 'Vocabulario',
  phrase: 'Frase',
  grammar: 'Gramática',
  conjugation: 'Conjugación',
  drill: 'Taladro',
};

export const manageStrings = {
  kinds: KIND_LABELS,
  editor: {
    titleOverride: 'Editar mi copia',
    titleAdmin: 'Editar tarjeta compartida',
    titleOwn: 'Nueva tarjeta',
    kind: 'Tipo',
    front: 'Francés',
    back: 'Español',
    exampleFr: 'Ejemplo en francés',
    exampleEs: 'Ejemplo en español',
    notes: 'Notas',
    save: 'Guardar',
    create: 'Crear tarjeta',
    cancel: 'Cancelar',
    requiredFront: 'Escribe el francés.',
    requiredBack: 'Escribe el español.',
    maxFront: 'El francés no puede pasar de 500 caracteres.',
    maxBack: 'El español no puede pasar de 500 caracteres.',
    maxExampleFr: 'El ejemplo en francés no puede pasar de 2000 caracteres.',
    maxExampleEs: 'El ejemplo en español no puede pasar de 2000 caracteres.',
    maxNotes: 'Las notas no pueden pasar de 2000 caracteres.',
    retry: 'Reintentar',
  },
  actions: {
    editMine: 'Editar mi copia',
    restore: 'Restaurar original',
    deleteOwn: 'Borrar tarjeta',
    editShared: 'Editar tarjeta compartida',
    deleteShared: 'Borrar tarjeta compartida',
    regenerateItem: 'Regenerar tarjetas de la publicación',
    regenerateAudio: 'Regenerar audio',
    listen: 'Escuchar',
    adminCopyNotice:
      'Quita tu copia personal para editar la tarjeta compartida.',
    retry: 'Reintentar',
    confirm: 'Confirmar',
    cancel: 'Cancelar',
    deleteOwnTitle: 'Borrar tarjeta',
    deleteOwnBody: '¿Borrar esta tarjeta?',
    deleteSharedTitle: 'Borrar tarjeta compartida',
    deleteSharedBody: '¿Borrar esta tarjeta compartida?',
    audioFor: (field: 'front' | 'example', voiceId: string) =>
      `Audio de ${field === 'front' ? 'frente' : 'ejemplo'} · ${voiceId}`,
  },
} as const;
