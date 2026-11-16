// Borrador local de un quiz. Vive en `sessionStorage` para sobrevivir a una
// recarga o a quedarse sin red; se borra en cuanto el servidor corrige el
// intento. La corrección siempre es del servidor: aquí no se guarda `expected`.

export type QuizAnswer = string | string[];

export interface QuizDraft {
  started_at: string;
  answers: Record<string, QuizAnswer>;
}

export function draftKey(quizId: string): string {
  return `fc-quiz:${quizId}`;
}

export function newDraft(now: Date = new Date()): QuizDraft {
  return { started_at: now.toISOString(), answers: {} };
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // El navegador puede bloquear el almacenamiento (modo privado).
    return null;
  }
}

function isAnswer(value: unknown): value is QuizAnswer {
  if (typeof value === 'string') return true;
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

export function readDraft(quizId: string): QuizDraft | null {
  const target = storage();
  if (target === null) return null;

  try {
    const raw = target.getItem(draftKey(quizId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as {
      started_at?: unknown;
      answers?: unknown;
    } | null;
    if (
      parsed === null ||
      typeof parsed.started_at !== 'string' ||
      typeof parsed.answers !== 'object' ||
      parsed.answers === null ||
      Array.isArray(parsed.answers)
    ) {
      return null;
    }

    const answers: Record<string, QuizAnswer> = {};
    for (const [questionId, value] of Object.entries(parsed.answers)) {
      if (isAnswer(value)) answers[questionId] = value;
    }
    return { started_at: parsed.started_at, answers };
  } catch {
    return null;
  }
}

export function saveDraft(quizId: string, draft: QuizDraft): void {
  const target = storage();
  if (target === null) return;
  try {
    target.setItem(draftKey(quizId), JSON.stringify(draft));
  } catch {
    // Sin espacio o almacenamiento bloqueado: seguimos con el estado en memoria.
  }
}

export function clearDraft(quizId: string): void {
  const target = storage();
  if (target === null) return;
  try {
    target.removeItem(draftKey(quizId));
  } catch {
    // Nada que borrar si el almacenamiento está bloqueado.
  }
}

export function isAnswered(value: QuizAnswer | undefined): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return Array.isArray(value) && value.length > 0;
}
