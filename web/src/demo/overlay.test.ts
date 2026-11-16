import type {
  CardView,
  QuizAttemptOut,
  ReviewIn,
  UserCardStateOut,
} from '../contracts/generated';
import {
  addAttempt,
  applyOverlayToBody,
  clearOverlay,
  emptyOverlay,
  isPlanDone,
  loadOverlay,
  reviewInOverlay,
  saveOverlay,
  setPlanDone,
  setPrefsInOverlay,
  setThreadsInOverlay,
  upsertFlagsInOverlay,
} from './overlay';

const CARD_ID = 'c1';
const T0 = '2026-11-06T15:00:00.000Z';

const BASE_STATE = {
  card_id: CARD_ID,
  fsrs: {
    difficulty: 0,
    due: '2026-11-06T12:00:00.000Z',
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
  updated_at: '2026-11-06T12:00:00.000Z',
} as UserCardStateOut;

const CARD = {
  id: CARD_ID,
  front_fr: 'bonjour',
  back_es: 'hola',
  state: BASE_STATE,
} as unknown as CardView;

const REVIEW: ReviewIn = {
  card_id: CARD_ID,
  rating: 3,
  reviewed_at: T0,
  next: {
    difficulty: 5,
    due: '2026-11-07T15:00:00.000Z',
    elapsed_days: 0,
    lapses: 0,
    last_review: T0,
    learning_steps: 0,
    reps: 1,
    scheduled_days: 1,
    stability: 2,
    state: 2,
  },
};

describe('overlay', () => {
  test('una reseña saca la tarjeta de la cola del overlay', () => {
    const overlay = emptyOverlay();
    const result = reviewInOverlay(overlay, REVIEW, BASE_STATE);
    expect(result.ok).toBe(true);
    expect(overlay.reviews[CARD_ID]).toEqual([T0]);

    const queue = applyOverlayToBody(
      [CARD],
      'GET /api/review/queue?limit=50',
      overlay,
    );
    expect(queue).toEqual([]);

    const card = applyOverlayToBody(
      CARD,
      'GET /api/cards/c1',
      overlay,
    ) as CardView;
    expect(card.state?.fsrs.last_review).toBe(T0);
  });

  test('una reseña repetida es idempotente y una más vieja es 409', () => {
    const overlay = emptyOverlay();
    expect(reviewInOverlay(overlay, REVIEW, BASE_STATE).ok).toBe(true);
    expect(reviewInOverlay(overlay, REVIEW, BASE_STATE).ok).toBe(true);

    const older: ReviewIn = {
      ...REVIEW,
      reviewed_at: '2026-11-05T15:00:00.000Z',
      next: { ...REVIEW.next, last_review: '2026-11-05T15:00:00.000Z' },
    };
    const result = reviewInOverlay(overlay, older, BASE_STATE);
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'conflict',
    });
  });

  test('R-38: dificultad fuera de rango o due anterior es 400', () => {
    const overlay = emptyOverlay();
    const badDifficulty: ReviewIn = {
      ...REVIEW,
      next: { ...REVIEW.next, difficulty: 0 },
    };
    expect(reviewInOverlay(overlay, badDifficulty, BASE_STATE)).toMatchObject({
      ok: false,
      status: 400,
      code: 'bad_request',
    });

    const badDue: ReviewIn = {
      ...REVIEW,
      next: { ...REVIEW.next, due: '2026-11-05T00:00:00.000Z' },
    };
    expect(reviewInOverlay(overlay, badDue, BASE_STATE)).toMatchObject({
      ok: false,
      status: 400,
      code: 'bad_request',
    });
  });

  test('las banderas y las prefs se aplican a los GET', () => {
    const overlay = emptyOverlay();
    expect(
      upsertFlagsInOverlay(overlay, CARD_ID, { suspended: true }, BASE_STATE)
        .ok,
    ).toBe(true);
    expect(
      applyOverlayToBody([CARD], 'GET /api/review/queue?limit=50', overlay),
    ).toEqual([]);

    setPrefsInOverlay(overlay, {
      daily_new_cards: 7,
      preferred_voice_ids: ['v1'],
      theme: 'dark',
    });
    expect(
      applyOverlayToBody(
        { daily_new_cards: 20, preferred_voice_ids: [], theme: 'auto' },
        'GET /api/me/prefs',
        overlay,
      ),
    ).toMatchObject({ daily_new_cards: 7, theme: 'dark' });
  });

  test('plan, intentos e hilos persisten en sessionStorage', () => {
    sessionStorage.clear();
    const overlay = emptyOverlay();
    setPlanDone(overlay, '2026-11-06', 1, true);
    expect(isPlanDone(overlay, '2026-11-06', 1)).toBe(true);
    const attempt: QuizAttemptOut = {
      attempt_id: 9,
      quiz_id: 'qz1',
      score: 1,
      started_at: T0,
      finished_at: T0,
    };
    addAttempt(overlay, 'qz1', attempt);
    setThreadsInOverlay(overlay, [
      {
        id: 'th1',
        title: 'Hola',
        created_at: T0,
        updated_at: T0,
        messages: [],
      },
    ]);
    saveOverlay(overlay);

    const loaded = loadOverlay();
    expect(isPlanDone(loaded, '2026-11-06', 1)).toBe(true);
    expect(loaded.attempts.qz1).toEqual([attempt]);
    expect(loaded.threads).toHaveLength(1);

    clearOverlay();
    expect(loadOverlay()).toEqual(emptyOverlay());
  });
});
