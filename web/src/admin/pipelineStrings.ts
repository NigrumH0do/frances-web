import type { JobOut } from '../contracts/generated';

type JobState = JobOut['state'];
type JobKind = JobOut['kind'];

// Textos de la pantalla de pipeline (MGT-05). Los comunes viven en `l10n/es.ts`.
export const pipelineStrings = {
  title: 'Pipeline',
  actionsTitle: 'Acciones',
  runDaily: 'Lanzar pipeline diario',
  runReconcile: 'Lanzar reconciliación',
  runTitle: 'Lanzar pipeline',
  runDailyConfirm: '¿Lanzar el pipeline diario ahora?',
  runReconcileConfirm: '¿Lanzar la reconciliación ahora?',
  runDailyQueued: 'Pipeline diario encolado.',
  runReconcileQueued: 'Reconciliación encolada.',
  retry: 'Reintentar',
  retryTitle: 'Reintentar trabajo',
  retryConfirm: (id: number) => `¿Reintentar el trabajo ${id}?`,
  retryQueued: (id: number) => `Trabajo ${id} reencolado.`,
  confirm: 'Confirmar',
  cancel: 'Cancelar',
  scheduleTitle: 'Programación y estado',
  nextDaily: (date: string) => `Próximo diario: ${date}`,
  nextReconcile: (date: string) => `Próxima reconciliación: ${date}`,
  workerSeen: (date: string) => `Última señal del worker: ${date}`,
  workerNever: 'El worker no ha dado señales de vida.',
  backupLast: (date: string, status: string | null) =>
    `Último respaldo: ${date}${status !== null ? ` (${status})` : ''}`,
  backupNone: 'Sin respaldos registrados.',
  runsTitle: 'Últimas ejecuciones',
  emptyRuns: 'No hay ejecuciones registradas',
  counts: (counts: Record<string, number>) => {
    const entries = Object.entries(counts);
    if (entries.length === 0) return 'Sin cifras';
    return entries.map(([key, value]) => `${key}: ${value}`).join(' · ');
  },
  jobsTitle: 'Trabajos por estado',
  failedTitle: 'Trabajos fallidos',
  emptyFailed: 'No hay trabajos fallidos',
  jobMeta: (kind: JobKind, id: number) =>
    `${jobKindLabel(kind)} · trabajo ${id}`,
  attempts: (attempts: number, max: number) => `Intento ${attempts} de ${max}`,
} as const;

const RUN_STATUS_LABELS: Record<string, string> = {
  ok: 'Correcto',
  partial: 'Parcial',
  failed: 'Fallido',
};

export function runStatusLabel(status: string | null): string {
  if (status === null) return 'Sin estado';
  return RUN_STATUS_LABELS[status] ?? status;
}

const STATE_LABELS: Record<JobState, string> = {
  queued: 'En cola',
  running: 'En curso',
  done: 'Hecho',
  failed: 'Fallido',
};

export function jobStateLabel(state: JobState): string {
  return STATE_LABELS[state];
}

const KIND_LABELS: Record<JobKind, string> = {
  'pipeline.daily': 'Pipeline diario',
  'pipeline.reconcile': 'Reconciliación',
  'auth.check': 'Comprobación de acceso',
  'index.text_blocks': 'Índice de texto',
  'llm.sheet': 'Ficha de estudio',
  'llm.topics': 'Temas del curso',
  'llm.quiz': 'Quizzes',
  'plan.daily': 'Plan diario',
  'cards.regenerate_item': 'Regenerar tarjetas',
  'audio.regenerate': 'Regenerar audio',
};

export function jobKindLabel(kind: JobKind): string {
  return KIND_LABELS[kind];
}
