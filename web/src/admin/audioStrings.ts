import type { JobOut } from '../contracts/generated';

type JobState = JobOut['state'];

// Textos de la pantalla de audio del admin (MGT-05).
export const audioStrings = {
  title: 'Audio',
  voicesTitle: 'Voces por defecto',
  hint: 'Elige al menos una voz. Las voces marcadas serán las voces por defecto del audio.',
  emptyVoices: 'No hay voces disponibles',
  save: 'Guardar voces',
  saved: 'Voces guardadas. Se encoló la regeneración del audio.',
  saveError: 'No se pudieron guardar las voces.',
  needOne: 'Elige al menos una voz.',
  queueTitle: 'Cola de audio',
  emptyQueue: 'No hay trabajos de audio',
  jobKind: 'Regenerar audio',
  jobMeta: (id: number, attempts: number, max: number) =>
    `Trabajo ${id} · intento ${attempts} de ${max}`,
} as const;

const STATE_LABELS: Record<JobState, string> = {
  queued: 'En cola',
  running: 'En curso',
  done: 'Hecho',
  failed: 'Fallido',
};

export function audioStateLabel(state: JobState): string {
  return STATE_LABELS[state];
}
