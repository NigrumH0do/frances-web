import type { Transport } from '../api/transport';
import type {
  CardFlagsIn,
  CardView,
  ChatEvent,
  ChatMessageOut,
  ChatThreadOut,
  InviteStatus,
  LoginRequest,
  Me,
  PlanEntry,
  Quiz,
  QuizAttemptIn,
  QuizAttemptResult,
  ReviewIn,
  StudyPlanDay,
  UserPrefs,
} from '../contracts/generated';
import { gradeDemo } from './grade';
import {
  addAttempt,
  addThread,
  appendMessages,
  applyOverlayToBody,
  findThread,
  loadOverlay,
  mergePrefs,
  removeThread,
  reviewInOverlay,
  saveOverlay,
  setPlanDone,
  setPrefsInOverlay,
  upsertFlagsInOverlay,
  type DemoThread,
  type OverlayState,
} from './overlay';
import { demoUrl, loadIndex, routeKey, type DemoIndex } from './snapshot';
import { sseResponse } from './sse';

export interface DemoTransportOptions {
  delayMs?: number;
}

const SESSION_KEY = 'fc-demo-session';
const CSRF_TOKEN = 'demo-csrf';
const DEMO_ORIGIN = 'https://demo.invalid';
const NO_MATERIAL_TEXT = 'El material del curso no cubre esta pregunta.';

declare global {
  interface Window {
    __francesDemo?: { chatDelayMs?: number };
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(
  status: number,
  code: string,
  message_es: string,
): Response {
  return jsonResponse({ code, message_es }, status);
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseBody<T>(init: RequestInit): T | undefined {
  if (typeof init.body !== 'string') return undefined;
  try {
    return JSON.parse(init.body) as T;
  } catch {
    return undefined;
  }
}

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

function hasSession(): boolean {
  return sessionStorage.getItem(SESSION_KEY) !== null;
}

function startSession(): void {
  sessionStorage.setItem(SESSION_KEY, 'demo');
}

function endSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

function meFrom(index: DemoIndex): Me {
  return { ...index.me, csrf_token: CSRF_TOKEN };
}

function threadOut(thread: DemoThread): ChatThreadOut {
  return {
    id: thread.id,
    title: thread.title,
    created_at: thread.created_at,
    updated_at: thread.updated_at,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCard(value: unknown): value is CardView {
  return isRecord(value) && typeof value.id === 'string' && 'front_fr' in value;
}

function foldQuestion(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function finalStatus(events: ChatEvent[]): ChatMessageOut['status'] {
  const done = [...events].reverse().find((event) => event.kind === 'done');
  if (done?.code === 'no_material') return 'no_material';
  if (done?.code === 'partial') return 'partial';
  if (events.some((event) => event.kind === 'error')) return 'error';
  return 'ok';
}

function noMaterialEvents(userId: number, assistantId: number): ChatEvent[] {
  return [
    { kind: 'meta', message_id: userId },
    { kind: 'token', text: NO_MATERIAL_TEXT },
    { kind: 'done', message_id: assistantId, code: 'no_material' },
  ];
}

export function createDemoTransport(
  opts: DemoTransportOptions = {},
): Transport {
  const delayMs = opts.delayMs ?? 600;
  const base = import.meta.env.BASE_URL;
  let indexPromise: Promise<DemoIndex> | null = null;
  const bodies = new Map<string, unknown>();
  const cards = new Map<string, CardView>();

  const index = (): Promise<DemoIndex> => {
    indexPromise ??= loadIndex(base);
    return indexPromise;
  };

  const rememberCards = (body: unknown): void => {
    if (Array.isArray(body)) {
      for (const item of body) rememberCards(item);
      return;
    }
    if (!isRecord(body)) return;
    if (Array.isArray(body.cards)) {
      for (const card of body.cards) rememberCards(card);
      return;
    }
    if (isCard(body)) cards.set(body.id, body);
  };

  const loadBody = async (
    idx: DemoIndex,
    key: string,
  ): Promise<unknown | undefined> => {
    if (bodies.has(key)) return bodies.get(key);
    const file = idx.routes[key];
    if (file === undefined) return undefined;
    const res = await fetch(demoUrl(base, file));
    if (!res.ok) return undefined;
    const body = (await res.json()) as unknown;
    bodies.set(key, body);
    rememberCards(body);
    return body;
  };

  const findCard = async (
    idx: DemoIndex,
    cardId: string,
  ): Promise<CardView | undefined> => {
    const direct = cards.get(cardId);
    if (direct !== undefined) return direct;
    const directKey = `GET /api/cards/${encodeURIComponent(cardId)}`;
    const body = await loadBody(idx, directKey);
    if (body !== undefined && isCard(body)) return body;
    for (const key of Object.keys(idx.routes)) {
      if (
        key.startsWith('GET /api/review/queue') ||
        key.startsWith('GET /api/cards?')
      ) {
        await loadBody(idx, key);
        const found = cards.get(cardId);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };

  const findPlanEntry = async (
    idx: DemoIndex,
    day: string,
    position: number,
  ): Promise<PlanEntry | undefined> => {
    const today = (await loadBody(idx, 'GET /api/plan/today')) as
      StudyPlanDay | undefined;
    if (today?.day === day) {
      const entry = today.entries.find((item) => item.position === position);
      if (entry !== undefined) return entry;
    }
    const week = (await loadBody(idx, 'GET /api/plan/week')) as
      StudyPlanDay[] | undefined;
    for (const planned of week ?? []) {
      if (planned.day !== day) continue;
      const entry = planned.entries.find((item) => item.position === position);
      if (entry !== undefined) return entry;
    }
    const fallback = today?.entries.find((item) => item.position === position);
    return fallback;
  };

  const handleAuth = (
    idx: DemoIndex,
    path: string,
    method: string,
    init: RequestInit,
  ): Response | null => {
    if (path === '/api/auth/login' && method === 'POST') {
      const body = parseBody<LoginRequest>(init);
      if (
        body?.email === idx.demo_credentials.email &&
        body.password === idx.demo_credentials.password
      ) {
        startSession();
        return jsonResponse(meFrom(idx));
      }
      return errorResponse(
        401,
        'unauthenticated',
        'Email o contraseña incorrectos.',
      );
    }

    if (path === '/api/auth/invite/check' && method === 'POST') {
      const body = parseBody<{ token?: string }>(init);
      const valid = body?.token === idx.invite_token;
      const status: InviteStatus = {
        valid,
        expires_at: idx.generated_at,
      };
      return jsonResponse(status);
    }

    if (path === '/api/auth/invite/accept' && method === 'POST') {
      const body = parseBody<{ token?: string }>(init);
      if (body?.token !== idx.invite_token) {
        return errorResponse(400, 'bad_request', 'El enlace no vale o caducó.');
      }
      startSession();
      return jsonResponse(meFrom(idx));
    }

    return null;
  };

  const handleFile = async (path: string): Promise<Response | null> => {
    if (path.startsWith('/api/files/')) {
      const sha = decodeURIComponent(path.slice('/api/files/'.length));
      return fetch(demoUrl(base, `files/${sha}`));
    }
    if (path.startsWith('/api/audio/')) {
      const key = decodeURIComponent(path.slice('/api/audio/'.length));
      const file = key.endsWith('.mp3') ? key : `${key}.mp3`;
      return fetch(demoUrl(base, `audio/${file}`));
    }
    return null;
  };

  const handleGet = async (
    idx: DemoIndex,
    input: string,
  ): Promise<Response> => {
    const path = new URL(input, DEMO_ORIGIN).pathname;
    const media = await handleFile(path);
    if (media !== null) return media;

    if (path === '/api/chat/threads') {
      const key = routeKey('GET', input);
      const baseThreads =
        ((await loadBody(idx, key)) as ChatThreadOut[] | undefined) ?? [];
      const overlay = loadOverlay();
      const threads = [
        ...baseThreads.filter(
          (thread) => !overlay.deleted_threads.includes(thread.id),
        ),
        ...overlay.threads.map(threadOut),
      ];
      return jsonResponse(threads);
    }

    const threadMatch = /^\/api\/chat\/threads\/([^/]+)$/.exec(path);
    if (threadMatch !== null) {
      const threadId = decodeURIComponent(threadMatch[1]);
      const overlay = loadOverlay();
      const thread = findThread(overlay, threadId);
      if (thread !== undefined) {
        return jsonResponse({
          thread: threadOut(thread),
          messages: thread.messages,
        });
      }
      const body = await loadBody(idx, routeKey('GET', input));
      if (body !== undefined) return jsonResponse(body);
      return errorResponse(404, 'not_found', 'No encontrado.');
    }

    const key = routeKey('GET', input);
    const body = await loadBody(idx, key);
    if (body === undefined) {
      return errorResponse(404, 'not_found', 'No encontrado.');
    }
    return jsonResponse(applyOverlayToBody(body, key, loadOverlay()));
  };

  const writeReview = async (
    idx: DemoIndex,
    init: RequestInit,
  ): Promise<Response> => {
    const review = parseBody<ReviewIn>(init);
    if (review === undefined || typeof review.card_id !== 'string') {
      return errorResponse(400, 'bad_request', 'La reseña no es válida.');
    }
    const card = await findCard(idx, review.card_id);
    if (card === undefined) {
      return errorResponse(404, 'not_found', 'No encontrado.');
    }
    const overlay = loadOverlay();
    const result = reviewInOverlay(overlay, review, card.state ?? null);
    if (!result.ok) {
      return errorResponse(result.status, result.code, result.message_es);
    }
    saveOverlay(overlay);
    return jsonResponse(result.value);
  };

  const writeFlags = async (
    idx: DemoIndex,
    cardId: string,
    init: RequestInit,
  ): Promise<Response> => {
    const flags = parseBody<CardFlagsIn>(init);
    if (flags === undefined) {
      return errorResponse(400, 'bad_request', 'Las banderas no son válidas.');
    }
    const card = await findCard(idx, cardId);
    if (card === undefined) {
      return errorResponse(404, 'not_found', 'No encontrado.');
    }
    const overlay = loadOverlay();
    const result = upsertFlagsInOverlay(
      overlay,
      cardId,
      flags,
      card.state ?? null,
    );
    if (!result.ok) {
      return errorResponse(result.status, result.code, result.message_es);
    }
    saveOverlay(overlay);
    return jsonResponse(result.value);
  };

  const writeReviewQueue = async (
    idx: DemoIndex,
    path: string,
    method: string,
    init: RequestInit,
  ): Promise<Response> => {
    const plan = /^\/api\/plan\/([^/]+)\/(\d+)\/done$/.exec(path);
    if (plan !== null) {
      const day = decodeURIComponent(plan[1]);
      const position = Number(plan[2]);
      const entry = await findPlanEntry(idx, day, position);
      if (entry === undefined) {
        return errorResponse(404, 'not_found', 'No encontrado.');
      }
      const overlay = loadOverlay();
      setPlanDone(overlay, day, position, method === 'POST');
      saveOverlay(overlay);
      return jsonResponse({ ...entry, done: method === 'POST' });
    }

    const attempt = /^\/api\/quizzes\/([^/]+)\/attempts$/.exec(path);
    if (attempt !== null) {
      return writeAttempt(idx, decodeURIComponent(attempt[1]), init);
    }

    return errorResponse(404, 'not_found', 'No encontrado.');
  };

  const writeAttempt = async (
    idx: DemoIndex,
    quizId: string,
    init?: RequestInit,
  ): Promise<Response> => {
    const body =
      init === undefined ? undefined : parseBody<QuizAttemptIn>(init);
    if (body === undefined || !Array.isArray(body.answers)) {
      return errorResponse(400, 'bad_request', 'El intento no es válido.');
    }
    const quizKey = `GET /api/quizzes/${encodeURIComponent(quizId)}`;
    const quiz = (await loadBody(idx, quizKey)) as Quiz | undefined;
    const keys = idx.quiz_keys[quizId];
    if (quiz === undefined || keys === undefined) {
      return errorResponse(404, 'not_found', 'No encontrado.');
    }
    const given = new Map<string, string | string[]>();
    for (const answer of body.answers) {
      if (
        typeof answer.question_id !== 'string' ||
        !(answer.question_id in keys)
      ) {
        return errorResponse(
          400,
          'bad_request',
          'Una respuesta no es válida para este quiz.',
        );
      }
      if (given.has(answer.question_id)) {
        return errorResponse(
          400,
          'bad_request',
          'Una pregunta se respondió dos veces.',
        );
      }
      given.set(answer.question_id, answer.answer);
    }

    let correct = 0;
    const results: QuizAttemptResult['results'] = [];
    for (const question of quiz.questions) {
      const answer = given.get(question.id);
      const expected = keys[question.id];
      if (answer === undefined || expected === undefined) continue;
      const ok = gradeDemo(expected, answer);
      if (ok) correct += 1;
      results.push({
        question_id: question.id,
        correct: ok,
        expected,
        explanation_es: null,
      });
    }

    const visible = Object.keys(keys).length;
    const score =
      visible === 0 ? 0 : Math.round((correct / visible) * 10000) / 10000;
    const overlay = loadOverlay();
    const attemptId = overlay.next_id;
    overlay.next_id += 1;
    const finishedAt = nowIso();
    addAttempt(overlay, quizId, {
      attempt_id: attemptId,
      quiz_id: quizId,
      score,
      started_at: body?.started_at ?? finishedAt,
      finished_at: finishedAt,
    });
    saveOverlay(overlay);
    return jsonResponse({
      attempt_id: attemptId,
      score,
      results,
    } satisfies QuizAttemptResult);
  };

  const writeThread = (
    overlay: OverlayState,
    path: string,
    method: string,
  ): Response | null => {
    if (path === '/api/chat/threads' && method === 'POST') {
      const now = nowIso();
      const thread: DemoThread = {
        id: `th_demo_${overlay.next_id}`,
        title: 'Nueva conversación',
        created_at: now,
        updated_at: now,
        messages: [],
      };
      overlay.next_id += 1;
      addThread(overlay, thread);
      saveOverlay(overlay);
      return jsonResponse(threadOut(thread), 201);
    }

    const match = /^\/api\/chat\/threads\/([^/]+)$/.exec(path);
    if (match !== null && method === 'DELETE') {
      const threadId = decodeURIComponent(match[1]);
      if (!removeThread(overlay, threadId)) {
        return errorResponse(404, 'not_found', 'No encontrado.');
      }
      saveOverlay(overlay);
      return noContent();
    }

    return null;
  };

  const writeChat = (
    overlay: OverlayState,
    idx: DemoIndex,
    path: string,
    init: RequestInit,
  ): Response | null => {
    const match = /^\/api\/chat\/threads\/([^/]+)\/messages$/.exec(path);
    if (match === null) return null;
    const threadId = decodeURIComponent(match[1]);
    const thread = findThread(overlay, threadId);
    if (thread === undefined) {
      return errorResponse(404, 'not_found', 'No encontrado.');
    }
    const body = parseBody<{ question?: string }>(init);
    const question = body?.question?.trim();
    if (!question) {
      return errorResponse(400, 'bad_request', 'La pregunta no es válida.');
    }

    const wanted = foldQuestion(question);
    const recorded = idx.chat.find(
      (entry) => foldQuestion(entry.question) === wanted,
    );
    const now = nowIso();
    const userId = overlay.next_id;
    overlay.next_id += 1;
    const assistantId = overlay.next_id;
    overlay.next_id += 1;
    const events =
      recorded !== undefined && recorded.events.length > 0
        ? recorded.events
        : noMaterialEvents(userId, assistantId);

    const done = [...events].reverse().find((event) => event.kind === 'done');
    const savedAssistantId =
      typeof done?.message_id === 'number' ? done.message_id : assistantId;
    const userMessage: ChatMessageOut = {
      id: userId,
      role: 'user',
      content: question,
      citations: [],
      status: 'ok',
      created_at: now,
    };
    const assistantMessage: ChatMessageOut = {
      id: savedAssistantId,
      role: 'assistant',
      content:
        events
          .filter((event) => event.kind === 'token')
          .map((event) => event.text ?? '')
          .join('') || NO_MATERIAL_TEXT,
      citations: events
        .filter((event) => event.kind === 'citation')
        .flatMap((event) => (event.citation ? [event.citation] : [])),
      status: finalStatus(events),
      created_at: now,
    };
    appendMessages(overlay, threadId, [userMessage, assistantMessage], now);
    saveOverlay(overlay);

    const chatDelay =
      typeof window === 'undefined'
        ? delayMs
        : (window.__francesDemo?.chatDelayMs ?? delayMs);
    return sseResponse(events, {
      delayMs: chatDelay,
      signal: init.signal,
    });
  };

  const handleWrite = async (
    idx: DemoIndex,
    input: string,
    init: RequestInit,
  ): Promise<Response> => {
    const method = (init.method ?? 'GET').toUpperCase();
    const path = new URL(input, DEMO_ORIGIN).pathname;
    if (path === '/api/reviews' && method === 'POST') {
      return writeReview(idx, init);
    }
    const flags = /^\/api\/cards\/([^/]+)\/flags$/.exec(path);
    if (flags !== null && method === 'PATCH') {
      return writeFlags(idx, decodeURIComponent(flags[1]), init);
    }
    if (path === '/api/me/prefs' && method === 'PUT') {
      const prefs = parseBody<UserPrefs>(init);
      if (prefs === undefined) {
        return errorResponse(400, 'bad_request', 'Las prefs no son válidas.');
      }
      if (
        prefs.daily_new_cards !== undefined &&
        (!Number.isInteger(prefs.daily_new_cards) ||
          prefs.daily_new_cards < 0 ||
          prefs.daily_new_cards > 100)
      ) {
        return errorResponse(400, 'bad_request', 'Las prefs no son válidas.');
      }
      if (
        prefs.preferred_voice_ids !== undefined &&
        (!Array.isArray(prefs.preferred_voice_ids) ||
          !prefs.preferred_voice_ids.every((id) => typeof id === 'string'))
      ) {
        return errorResponse(400, 'bad_request', 'Las prefs no son válidas.');
      }
      const basePrefs = (await loadBody(idx, 'GET /api/me/prefs')) as
        UserPrefs | undefined;
      const overlay = loadOverlay();
      setPrefsInOverlay(overlay, prefs);
      saveOverlay(overlay);
      return jsonResponse(mergePrefs(basePrefs ?? null, prefs));
    }
    if (path === '/api/speech/token' && method === 'POST') {
      return errorResponse(
        503,
        'speech_unavailable',
        'La pronunciación no está disponible en el demo.',
      );
    }
    if (path === '/api/practice/tts' && method === 'POST') {
      return errorResponse(
        503,
        'tts_unavailable',
        'El demo no genera audio de texto libre.',
      );
    }
    if (path === '/api/auth/password' && method === 'POST') {
      return noContent();
    }

    const overlay = loadOverlay();
    const thread = writeThread(overlay, path, method);
    if (thread !== null) return thread;
    const chat = writeChat(overlay, idx, path, init);
    if (chat !== null) return chat;
    return writeReviewQueue(idx, path, method, init);
  };

  return async (input, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && navigator.onLine === false) {
      throw new TypeError('Failed to fetch');
    }

    const idx = await index();
    const path = new URL(input, DEMO_ORIGIN).pathname;

    if (path === '/api/health' && method === 'GET') {
      const body = await loadBody(idx, routeKey('GET', input));
      if (body === undefined) {
        return errorResponse(404, 'not_found', 'No encontrado.');
      }
      return jsonResponse(body);
    }

    const auth = handleAuth(idx, path, method, init);
    if (auth !== null) return auth;

    if (!hasSession()) {
      return errorResponse(401, 'unauthenticated', 'No has iniciado sesión.');
    }

    if (method !== 'GET' && header(init, 'X-CSRF-Token') !== CSRF_TOKEN) {
      return errorResponse(403, 'csrf', 'La sesión caducó; recarga la página.');
    }

    if (path.startsWith('/api/admin/')) {
      return errorResponse(403, 'forbidden', 'No tienes permiso.');
    }

    if (path === '/api/auth/me' && method === 'GET') {
      return jsonResponse(meFrom(idx));
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      endSession();
      return noContent();
    }

    if (method === 'GET') return handleGet(idx, input);
    return handleWrite(idx, input, init);
  };
}

// Reexportado para que las pantallas puedan enseñar las credenciales del
// demo sin volver a cargar la instantánea (UI-08).
export { loadIndex } from './snapshot';
export type { DemoIndex } from './snapshot';
