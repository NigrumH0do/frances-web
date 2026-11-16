import type {
  CardFlagsIn,
  CardView,
  ChatMessageOut,
  ChatThreadOut,
  QuizAttemptOut,
  ReviewIn,
  UserCardStateOut,
  UserPrefs,
} from '../contracts/generated';

// Estado de las escrituras simuladas del demo. Vive en sessionStorage para
// que recargar la pestaña conserve lo hecho; nunca se guarda en localStorage.

export const OVERLAY_KEY = 'fc-demo-overlay';

export interface DemoThread extends ChatThreadOut {
  messages: ChatMessageOut[];
}

export interface OverlayState {
  states: Record<string, UserCardStateOut>;
  reviews: Record<string, string[]>;
  flags: Record<string, CardFlagsIn>;
  prefs: UserPrefs | null;
  plan_done: Record<string, boolean>;
  attempts: Record<string, QuizAttemptOut[]>;
  threads: DemoThread[];
  deleted_threads: string[];
  next_id: number;
}

export type OverlayResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message_es: string };

export function emptyOverlay(): OverlayState {
  return {
    states: {},
    reviews: {},
    flags: {},
    prefs: null,
    plan_done: {},
    attempts: {},
    threads: [],
    deleted_threads: [],
    next_id: 1,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalise(raw: unknown): OverlayState {
  const empty = emptyOverlay();
  if (!isRecord(raw)) return empty;
  return {
    states: isRecord(raw.states) ? (raw.states as OverlayState['states']) : {},
    reviews: isRecord(raw.reviews)
      ? (raw.reviews as OverlayState['reviews'])
      : {},
    flags: isRecord(raw.flags) ? (raw.flags as OverlayState['flags']) : {},
    prefs: isRecord(raw.prefs) ? (raw.prefs as UserPrefs) : null,
    plan_done: isRecord(raw.plan_done)
      ? (raw.plan_done as Record<string, boolean>)
      : {},
    attempts: isRecord(raw.attempts)
      ? (raw.attempts as OverlayState['attempts'])
      : {},
    threads: Array.isArray(raw.threads) ? (raw.threads as DemoThread[]) : [],
    deleted_threads: Array.isArray(raw.deleted_threads)
      ? (raw.deleted_threads as string[])
      : [],
    next_id: typeof raw.next_id === 'number' ? raw.next_id : 1,
  };
}

export function loadOverlay(storage: Storage = sessionStorage): OverlayState {
  const raw = storage.getItem(OVERLAY_KEY);
  if (raw === null) return emptyOverlay();
  try {
    return normalise(JSON.parse(raw) as unknown);
  } catch {
    return emptyOverlay();
  }
}

export function saveOverlay(
  state: OverlayState,
  storage: Storage = sessionStorage,
): void {
  storage.setItem(OVERLAY_KEY, JSON.stringify(state));
}

export function clearOverlay(storage: Storage = sessionStorage): void {
  storage.removeItem(OVERLAY_KEY);
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyUserCardState(cardId: string, now = nowIso()): UserCardStateOut {
  return {
    card_id: cardId,
    fsrs: {
      difficulty: 0,
      due: now,
      elapsed_days: 0,
      lapses: 0,
      last_review: null,
      learning_steps: 0,
      reps: 0,
      scheduled_days: 0,
      stability: 0,
      state: 0,
    },
    flagged_hard: false,
    suspended: false,
    updated_at: now,
  };
}

function parseTs(value: string | null): number {
  return value === null ? Number.NaN : Date.parse(value);
}

function validNext(input: ReviewIn): boolean {
  const next = input.next;
  if (!Number.isFinite(next.stability) || next.stability <= 0) return false;
  if (
    !Number.isFinite(next.difficulty) ||
    next.difficulty < 1 ||
    next.difficulty > 10
  ) {
    return false;
  }
  const due = parseTs(next.due);
  const reviewed = parseTs(input.reviewed_at);
  if (!Number.isFinite(due) || !Number.isFinite(reviewed) || due < reviewed) {
    return false;
  }
  return next.last_review === input.reviewed_at;
}

function badRequest(): OverlayResult<never> {
  return {
    ok: false,
    status: 400,
    code: 'bad_request',
    message_es: 'El estado de repaso no es válido.',
  };
}

/** Aplica un `POST /api/reviews` con la validación R-38 y la idempotencia del servidor. */
export function reviewInOverlay(
  state: OverlayState,
  input: ReviewIn,
  base: UserCardStateOut | null,
): OverlayResult<UserCardStateOut> {
  if (!isRecord(input.next) || typeof input.reviewed_at !== 'string') {
    return badRequest();
  }
  const seen = state.reviews[input.card_id] ?? [];
  if (seen.includes(input.reviewed_at)) {
    return {
      ok: true,
      value: state.states[input.card_id] ?? emptyUserCardState(input.card_id),
    };
  }

  const previous = state.states[input.card_id] ?? base;
  const lastReview = previous?.fsrs.last_review ?? null;
  const last = parseTs(lastReview);
  const reviewed = parseTs(input.reviewed_at);
  if (Number.isFinite(last) && Number.isFinite(reviewed) && last > reviewed) {
    return {
      ok: false,
      status: 409,
      code: 'conflict',
      message_es: 'La tarjeta ya tiene un repaso más reciente.',
    };
  }

  if (!validNext(input)) return badRequest();

  const value: UserCardStateOut = {
    card_id: input.card_id,
    fsrs: input.next,
    suspended: previous?.suspended ?? false,
    flagged_hard: previous?.flagged_hard ?? false,
    updated_at: input.reviewed_at,
  };
  state.states[input.card_id] = value;
  state.reviews[input.card_id] = [...seen, input.reviewed_at];
  return { ok: true, value };
}

/** Aplica `PATCH /api/cards/{id}/flags`; conserva el estado FSRS si ya existía. */
export function upsertFlagsInOverlay(
  state: OverlayState,
  cardId: string,
  flags: CardFlagsIn,
  base: UserCardStateOut | null,
  now = nowIso(),
): OverlayResult<UserCardStateOut> {
  const current =
    state.states[cardId] ?? base ?? emptyUserCardState(cardId, now);
  const value: UserCardStateOut = {
    ...current,
    suspended: flags.suspended ?? current.suspended,
    flagged_hard: flags.flagged_hard ?? current.flagged_hard,
    updated_at: now,
  };
  state.states[cardId] = value;
  state.flags[cardId] = { ...state.flags[cardId], ...flags };
  return { ok: true, value };
}

export function setPrefsInOverlay(state: OverlayState, prefs: UserPrefs): void {
  state.prefs = prefs;
}

export function mergePrefs(
  base: UserPrefs | null,
  prefs: UserPrefs | null,
): UserPrefs {
  return { ...(base ?? {}), ...(prefs ?? {}) };
}

export function planKey(day: string, position: number): string {
  return `${day}:${position}`;
}

export function setPlanDone(
  state: OverlayState,
  day: string,
  position: number,
  done: boolean,
): void {
  state.plan_done[planKey(day, position)] = done;
}

export function isPlanDone(
  state: OverlayState,
  day: string,
  position: number,
): boolean {
  return state.plan_done[planKey(day, position)] === true;
}

export function addAttempt(
  state: OverlayState,
  quizId: string,
  attempt: QuizAttemptOut,
): void {
  state.attempts[quizId] = [attempt, ...(state.attempts[quizId] ?? [])];
}

export function attemptsFor(
  state: OverlayState,
  quizId: string,
): QuizAttemptOut[] {
  return state.attempts[quizId] ?? [];
}

export function setThreadsInOverlay(
  state: OverlayState,
  threads: DemoThread[],
): void {
  state.threads = threads;
}

export function addThread(state: OverlayState, thread: DemoThread): void {
  state.threads.push(thread);
}

export function findThread(
  state: OverlayState,
  threadId: string,
): DemoThread | undefined {
  return state.threads.find((thread) => thread.id === threadId);
}

export function removeThread(state: OverlayState, threadId: string): boolean {
  const before = state.threads.length;
  state.threads = state.threads.filter((thread) => thread.id !== threadId);
  if (state.threads.length === before) return false;
  state.deleted_threads.push(threadId);
  return true;
}

export function appendMessages(
  state: OverlayState,
  threadId: string,
  messages: ChatMessageOut[],
  now = nowIso(),
): void {
  const thread = findThread(state, threadId);
  if (!thread) return;
  thread.messages.push(...messages);
  thread.updated_at = now;
}

function isCard(value: unknown): value is CardView {
  return isRecord(value) && typeof value.id === 'string' && 'front_fr' in value;
}

function applyCard(card: CardView, state: OverlayState): CardView {
  return {
    ...card,
    state: state.states[card.id] ?? card.state,
  };
}

function queueVisible(card: CardView, state: OverlayState): boolean {
  if ((state.reviews[card.id]?.length ?? 0) > 0) return false;
  if (state.states[card.id]?.suspended === true) return false;
  return true;
}

function applyPlan(body: unknown, state: OverlayState): unknown {
  if (!isRecord(body) || !Array.isArray(body.entries)) return body;
  if (typeof body.day !== 'string') return body;
  const day = body.day;
  return {
    ...body,
    entries: body.entries.map((entry) => {
      if (!isRecord(entry) || typeof entry.position !== 'number') return entry;
      const key = planKey(day, entry.position);
      return key in state.plan_done
        ? { ...entry, done: state.plan_done[key] }
        : entry;
    }),
  };
}

/**
 * Aplica el overlay a un cuerpo de `GET`. No toca la instantánea: devuelve
 * una copia con las escrituras simuladas del usuario.
 */
export function applyOverlayToBody(
  body: unknown,
  key: string,
  state: OverlayState,
): unknown {
  const space = key.indexOf(' ');
  const path = (space < 0 ? key : key.slice(space + 1)).split('?')[0];

  if (path === '/api/review/queue' && Array.isArray(body)) {
    return body
      .filter(isCard)
      .filter((card) => queueVisible(card, state))
      .map((card) => applyCard(card, state));
  }

  if (path === '/api/cards' && isRecord(body) && Array.isArray(body.cards)) {
    return {
      ...body,
      cards: body.cards.filter(isCard).map((card) => applyCard(card, state)),
    };
  }

  if (/^\/api\/cards\/[^/]+$/.test(path) && isCard(body)) {
    return applyCard(body, state);
  }

  if (path === '/api/me/prefs') {
    return mergePrefs(isRecord(body) ? (body as UserPrefs) : null, state.prefs);
  }

  if (path === '/api/plan/today') {
    return applyPlan(body, state);
  }

  if (path === '/api/plan/week' && Array.isArray(body)) {
    return body.map((day) => applyPlan(day, state));
  }

  const attempts = /^\/api\/quizzes\/([^/]+)\/attempts$/.exec(path);
  if (attempts && Array.isArray(body)) {
    const quizId = decodeURIComponent(attempts[1]);
    return [...attemptsFor(state, quizId), ...body];
  }

  return body;
}
