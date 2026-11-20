import type { AzureAccountOut, AzurePoolSummary } from '../contracts/generated';

export type AzureAccountKind = AzureAccountOut['kind'];
export type AzurePoolStrategy = AzurePoolSummary['strategy'];

export const azureStrings = {
  title: 'Cuentas Azure',
  subtitle: 'Pool de Speech (voz y pronunciación) y Translator',
  encryptionMissing:
    'Falta FRANCES_SECRETS_KEY en el servidor: no se podrán guardar claves nuevas cifradas hasta configurarla.',
  summaryTitle: 'Consumo mensual del pool',
  strategyLabel: 'Estrategia de selección',
  strategies: {
    priority: 'Por prioridad',
    least_used: 'Menor uso',
  } satisfies Record<AzurePoolStrategy, string>,
  strategySaved: 'Estrategia actualizada.',
  sttLabel: 'Reconocimiento de voz (STT)',
  ttsLabel: 'Síntesis de audio (TTS)',
  translatorLabel: 'Traducción',
  secondsProgress: (used: number, cap: number) =>
    `${used.toLocaleString('es-CO')} / ${cap.toLocaleString('es-CO')} s`,
  charsProgress: (used: number, cap: number) =>
    `${used.toLocaleString('es-CO')} / ${cap.toLocaleString('es-CO')} car.`,
  activePool: (active: number, total: number) =>
    `${active} de ${total} cuentas activas`,
  accountsTitle: 'Cuentas registradas',
  addAccount: 'Agregar cuenta',
  empty: 'No hay cuentas Azure registradas todavía.',
  kinds: {
    speech: 'Azure Speech',
    translator: 'Azure Translator',
  } satisfies Record<AzureAccountKind, string>,
  sourceDb: 'Base de datos',
  sourceEnv: 'Entorno (.env)',
  statusActive: 'Activa',
  statusDisabled: 'Deshabilitada',
  statusCooldown: 'En pausa',
  priorityBadge: (n: number) => `Prioridad ${n}`,
  test: 'Probar',
  testing: 'Probando…',
  testSuccess: (label: string, detail: string, latencyMs?: number | null) =>
    `${label}: conexión OK${latencyMs !== undefined && latencyMs !== null ? ` (${latencyMs} ms)` : ''} · ${detail}`,
  testFailure: (label: string, detail: string) =>
    `${label}: error al probar · ${detail}`,
  enable: 'Habilitar',
  disable: 'Deshabilitar',
  remove: 'Eliminar',
  enabledNotice: (label: string) => `${label} quedó habilitada.`,
  disabledNotice: (label: string) => `${label} quedó deshabilitada.`,
  removedNotice: (label: string) => `${label} fue eliminada del pool.`,
  createdNotice: (label: string) => `${label} agregada al pool.`,
  deleteTitle: 'Eliminar cuenta Azure',
  deleteConfirm: (label: string) =>
    `¿Eliminar la cuenta «${label}» del pool? Dejará de usarse de inmediato.`,
  cancel: 'Cancelar',
  confirm: 'Confirmar',
  save: 'Guardar cuenta',
  formTitle: 'Nueva cuenta Azure',
  fieldLabel: 'Nombre descriptivo',
  fieldLabelPlaceholder: 'Ej. Speech secundaria',
  fieldKind: 'Servicio',
  fieldRegion: 'Región Azure',
  fieldRegionHint: 'Ej. eastus, westeurope, brazilsouth',
  fieldKey: 'Clave API',
  fieldKeyHint: 'Se guarda cifrada en el servidor y nunca vuelve a mostrarse.',
  fieldPriority: 'Prioridad (menor número = mayor preferencia)',
  fieldSttCap: 'Tope mensual STT (segundos)',
  fieldTtsCap: 'Tope mensual TTS (caracteres)',
  fieldTranslatorCap: 'Tope mensual Translator (caracteres)',
  validationRequired:
    'Completa nombre, región y una clave de al menos 8 caracteres.',
} as const;

export function usagePercent(used: number, cap: number): number {
  if (cap <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / cap) * 100));
}
