import { openFrancesDb } from '../db/idb';

export const QUOTA_SECONDS = 18000;
export const WARN_SECONDS = 14400;

export function monthOf(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
  }).format(now);
}

export function secondsOf(durationMs: number): number {
  return Math.ceil(durationMs / 1000);
}

export function quotaState(usageSeconds: number): 'ok' | 'warn' | 'exceeded' {
  if (usageSeconds >= QUOTA_SECONDS) {
    return 'exceeded';
  }
  if (usageSeconds >= WARN_SECONDS) {
    return 'warn';
  }
  return 'ok';
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) {
    return `${hours} h ${minutes} min`;
  }
  if (hours > 0) {
    return `${hours} h`;
  }
  return `${minutes} min`;
}

// Lo que este navegador ya envió a Azure Speech en el mes, frente a las 5 h
// gratis del plan F0. No es el panel de Azure: cuenta los intentos guardados aquí.
export function formatSpeechQuota(usedSeconds: number): string {
  const used = formatDuration(usedSeconds);
  const left = formatDuration(Math.max(0, QUOTA_SECONDS - usedSeconds));
  if (usedSeconds >= QUOTA_SECONDS) {
    return `Azure Speech: ${used} de 5 h. La cuota gratis de este mes se agotó.`;
  }
  return `Azure Speech: ${used} de 5 h · quedan ${left}`;
}

export const QUOTA_MESSAGES = {
  warn: 'Llevas 4 h de las 5 h gratis de este mes',
  exceeded: 'Es probable que Azure rechace los intentos hasta el próximo mes',
} as const;

function rowSeconds(
  row:
    ({ month: string; seconds: number } & Record<string, unknown>) | undefined,
): number {
  const recorded = row?.pron_seconds;
  if (typeof recorded === 'number') {
    return recorded;
  }
  return row?.seconds ?? 0;
}

export async function getUsage(month: string): Promise<number> {
  const db = await openFrancesDb();
  return rowSeconds(await db.get('usage', month));
}

export async function addSeconds(month: string, s: number): Promise<number> {
  const db = await openFrancesDb();
  const tx = db.transaction('usage', 'readwrite');
  const store = tx.objectStore('usage');
  const total = rowSeconds(await store.get(month)) + s;
  await store.put({ month, seconds: total, pron_seconds: total });
  await tx.done;
  return total;
}
