// Textos recientes del texto libre, solo en este dispositivo (localStorage).
//
// Se guardan por usuario para que dos cuentas en el mismo navegador no se
// mezclen. Son textos que el propio usuario escribió; nunca van al servidor
// salvo para pedir su audio.

export const HISTORY_MAX = 8;

export interface HistoryEntry {
  text: string;
  at: string;
}

function keyFor(userId: string): string {
  return `frances.texto.history.v1:${userId}`;
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase('fr') === b.trim().toLocaleLowerCase('fr');
}

export function loadHistory(userId: string): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is HistoryEntry =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as HistoryEntry).text === 'string' &&
          typeof (entry as HistoryEntry).at === 'string',
      )
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function save(userId: string, entries: HistoryEntry[]): HistoryEntry[] {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(entries));
  } catch {
    // Sin espacio o almacenamiento bloqueado: la lista vive solo en memoria.
  }
  return entries;
}

/** Pone `text` primero (sin duplicados) y recorta a `HISTORY_MAX`. */
export function rememberText(
  userId: string,
  text: string,
  now: Date = new Date(),
): HistoryEntry[] {
  const clean = text.trim();
  const current = loadHistory(userId);
  if (clean === '') return current;
  const next = [
    { text: clean, at: now.toISOString() },
    ...current.filter((entry) => !sameText(entry.text, clean)),
  ].slice(0, HISTORY_MAX);
  return save(userId, next);
}

export function forgetText(userId: string, text: string): HistoryEntry[] {
  return save(
    userId,
    loadHistory(userId).filter((entry) => !sameText(entry.text, text)),
  );
}
