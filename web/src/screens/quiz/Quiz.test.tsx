import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { jsonResponse } from '../../api/testing';
import type {
  Quiz as QuizContract,
  QuizAttemptIn,
  QuizAttemptResult,
} from '../../contracts/generated';
import { closeV2DbForTests } from '../../offline/db';
import { renderScreen } from '../../shell/testing';
import Quiz from './Quiz';

const QUIZ_5: QuizContract = {
  id: 'qz_1',
  scope_kind: 'topic',
  scope_id: 'tp_1',
  title_es: 'Le passé composé',
  stale: false,
  questions: [
    {
      id: 'q_1',
      kind: 'mcq',
      prompt_es: '¿Cuál es la forma correcta?',
      prompt_fr: null,
      options: ['suis', 'est', 'sommes', 'sont'],
      audio: null,
      source_item_id: 'i_1',
    },
    {
      id: 'q_2',
      kind: 'cloze',
      prompt_es: 'Completa la frase.',
      prompt_fr: 'Hier, elle est ___ à huit heures.',
      options: [],
      audio: null,
      source_item_id: 'i_1',
    },
    {
      id: 'q_3',
      kind: 'translate',
      prompt_es: 'Traduce al francés: «Comimos una crepa».',
      prompt_fr: null,
      options: [],
      audio: null,
      source_item_id: 'i_2',
    },
    {
      id: 'q_4',
      kind: 'order',
      prompt_es: 'Ordena las palabras.',
      prompt_fr: null,
      options: ['suis', 'Je', 'allé'],
      audio: null,
      source_item_id: 'i_2',
    },
    {
      id: 'q_5',
      kind: 'dictation',
      prompt_es: 'Escucha y escribe lo que oyes.',
      prompt_fr: null,
      options: [],
      audio: {
        field: 'front',
        voice_id: 'voice-a',
        url: '/api/audio/k1',
        duration_ms: 1200,
      },
      source_item_id: 'i_3',
    },
  ],
};

const RESULT_5: QuizAttemptResult = {
  attempt_id: 7,
  score: 0.8,
  results: [
    {
      question_id: 'q_1',
      correct: true,
      expected: 'suis',
      explanation_es: 'El verbo aller usa être.',
    },
    {
      question_id: 'q_2',
      correct: true,
      expected: 'allée',
      explanation_es: 'El participio concuerda con elle.',
    },
    {
      question_id: 'q_3',
      correct: true,
      expected: 'Nous avons mangé',
      explanation_es: 'El passé composé usa avoir.',
    },
    {
      question_id: 'q_4',
      correct: true,
      expected: ['Je', 'suis', 'allé'],
      explanation_es: 'El orden natural es sujeto, auxiliar y participio.',
    },
    {
      question_id: 'q_5',
      correct: false,
      expected: 'bonjour',
      explanation_es: 'La palabra empieza por b.',
    },
  ],
};

const QUIZ_ONE: QuizContract = {
  ...QUIZ_5,
  questions: [QUIZ_5.questions[0]!],
};

const RESULT_ONE: QuizAttemptResult = {
  attempt_id: 8,
  score: 1,
  results: [RESULT_5.results[0]!],
};

const QUIZ_TWO: QuizContract = {
  ...QUIZ_5,
  questions: [QUIZ_5.questions[0]!, QUIZ_5.questions[2]!],
};

const RESULT_TWO: QuizAttemptResult = {
  attempt_id: 9,
  score: 0.5,
  results: [
    RESULT_5.results[0]!,
    {
      question_id: 'q_3',
      correct: false,
      expected: 'Nous avons mangé une crêpe',
      explanation_es: 'Falta el complemento de la frase.',
    },
  ],
};

const RESULT_PARTIAL: QuizAttemptResult = {
  attempt_id: 10,
  score: 0.5,
  results: [RESULT_5.results[0]!],
};

const QUIZ_ORDER: QuizContract = {
  ...QUIZ_5,
  questions: [QUIZ_5.questions[3]!],
};

const RESULT_ORDER: QuizAttemptResult = {
  attempt_id: 11,
  score: 1,
  results: [RESULT_5.results[3]!],
};

const QUIZ_EMPTY: QuizContract = {
  ...QUIZ_5,
  questions: [],
};

const mp3 = () =>
  new Response(new Uint8Array([1, 2, 3]), {
    headers: { 'Content-Type': 'audio/mpeg' },
  });

function renderQuiz(
  quiz: QuizContract,
  result: QuizAttemptResult,
  opts: {
    online?: boolean;
    extraRoutes?: Record<string, unknown>;
  } = {},
) {
  return renderScreen(<Quiz />, {
    path: `/quiz/${quiz.id}`,
    pattern: '/quiz/:quizId',
    online: opts.online,
    routes: {
      [`GET /api/quizzes/${quiz.id}`]: quiz,
      [`POST /api/quizzes/${quiz.id}/attempts`]: () =>
        jsonResponse(result, 201),
      'GET /api/audio/k1': mp3,
      ...(opts.extraRoutes ?? {}),
    },
  });
}

async function next() {
  const button =
    screen.queryByRole('button', { name: 'Siguiente' }) ??
    screen.getByRole('button', { name: 'Revisar' });
  await userEvent.click(button);
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  sessionStorage.clear();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('responde los 5 tipos y envía AnswerIn con la forma correcta', async () => {
  const { transport } = renderQuiz(QUIZ_5, RESULT_5);

  await userEvent.click(await screen.findByRole('radio', { name: 'suis' }));
  await next();

  await userEvent.type(
    screen.getByRole('textbox', { name: 'Respuesta' }),
    'allée',
  );
  await next();

  await userEvent.type(
    screen.getByRole('textbox', { name: /Traducción/ }),
    'Nous avons mangé',
  );
  await next();

  for (const word of ['Je', 'suis', 'allé']) {
    await userEvent.click(screen.getByRole('button', { name: word }));
  }
  await next();

  await userEvent.click(screen.getByRole('button', { name: 'Reproducir' }));
  await userEvent.type(
    screen.getByRole('textbox', { name: /Lo que oyes/ }),
    'bonjour',
  );
  await next();

  await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
  expect(await screen.findByRole('status')).toHaveTextContent('4 de 5');

  const post = transport.calls.find((call) => call.method === 'POST');
  expect(post).toBeDefined();
  const sent = post!.body as QuizAttemptIn;
  expect(sent.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(sent.answers.map((answer) => answer.answer)).toEqual([
    'suis',
    'allée',
    'Nous avons mangé',
    ['Je', 'suis', 'allé'],
    'bonjour',
  ]);
  expect(post!.headers.get('X-CSRF-Token')).toBe('csrf-test');
}, 15_000);

test('Order se puede resolver solo con teclado', async () => {
  const { transport } = renderQuiz(QUIZ_ORDER, RESULT_ORDER);

  const first = await screen.findByRole('button', { name: 'suis' });
  first.focus();
  await userEvent.keyboard('{Enter}');

  const second = screen.getByRole('button', { name: 'Je' });
  second.focus();
  await userEvent.keyboard('{Enter}');

  const up = screen.getByRole('button', { name: 'Subir Je' });
  up.focus();
  await userEvent.keyboard('{Enter}');

  const third = screen.getByRole('button', { name: 'allé' });
  third.focus();
  await userEvent.keyboard('{Enter}');

  const review = screen.getByRole('button', { name: 'Revisar' });
  review.focus();
  await userEvent.keyboard('{Enter}');

  const send = screen.getByRole('button', { name: 'Enviar' });
  send.focus();
  await userEvent.keyboard('{Enter}');

  await waitFor(() =>
    expect(transport.calls.some((call) => call.method === 'POST')).toBe(true),
  );
  const sent = transport.calls.find((call) => call.method === 'POST')!
    .body as QuizAttemptIn;
  expect(sent.answers[0]!.answer).toEqual(['Je', 'suis', 'allé']);
});

test('el borrador sobrevive a recargar y se borra al enviar', async () => {
  renderQuiz(QUIZ_ONE, RESULT_ONE);

  await userEvent.click(await screen.findByRole('radio', { name: 'suis' }));
  const saved = JSON.parse(sessionStorage.getItem('fc-quiz:qz_1') ?? '{}') as {
    answers?: Record<string, unknown>;
  };
  expect(saved.answers?.q_1).toBe('suis');

  cleanup();
  renderQuiz(QUIZ_ONE, RESULT_ONE);
  expect(await screen.findByRole('radio', { name: 'suis' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await next();
  await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
  expect(await screen.findByText('1 de 1 correctas')).toBeVisible();
  expect(sessionStorage.getItem('fc-quiz:qz_1')).toBeNull();
});

test('sin red no envía y conserva las respuestas en el borrador', async () => {
  const { transport } = renderQuiz(QUIZ_ONE, RESULT_ONE, { online: false });

  await userEvent.click(await screen.findByRole('radio', { name: 'suis' }));
  await next();

  expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  expect(screen.getByText(/Necesitas conexión/)).toBeVisible();
  expect(transport.calls.some((call) => call.method === 'POST')).toBe(false);

  const saved = JSON.parse(sessionStorage.getItem('fc-quiz:qz_1') ?? '{}') as {
    answers?: Record<string, unknown>;
  };
  expect(saved.answers?.q_1).toBe('suis');
});

test('muestra carga, vacío y error con reintentar', async () => {
  const never = new Promise<Response>(() => undefined);
  renderScreen(<Quiz />, {
    path: '/quiz/qz_1',
    pattern: '/quiz/:quizId',
    routes: { 'GET /api/quizzes/qz_1': () => never },
  });
  expect(screen.getByRole('status')).toHaveTextContent('Cargando');
  cleanup();

  renderQuiz(QUIZ_EMPTY, RESULT_ONE);
  expect(
    await screen.findByText('Este quiz todavía no tiene preguntas.'),
  ).toBeVisible();
  cleanup();

  let attempts = 0;
  const { transport } = renderScreen(<Quiz />, {
    path: '/quiz/qz_1',
    pattern: '/quiz/:quizId',
    routes: {
      'GET /api/quizzes/qz_1': () => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ code: 'internal', message_es: '' }, 500)
          : jsonResponse(QUIZ_ONE);
      },
    },
  });

  expect(
    await screen.findByText('Algo salió mal en el servidor'),
  ).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('radio', { name: 'suis' })).toBeVisible();
  expect(
    transport.calls.filter((call) => call.url === '/api/quizzes/qz_1'),
  ).toHaveLength(2);
});

test('un quiz de una versión anterior del tema lo avisa', async () => {
  renderQuiz({ ...QUIZ_ONE, stale: true }, RESULT_ONE);

  expect(
    await screen.findByText('Este quiz es de una versión anterior del tema.'),
  ).toBeVisible();
});

test('las respuestas correctas solo aparecen tras enviar y solo de las respondidas', async () => {
  const { transport } = renderQuiz(QUIZ_TWO, RESULT_PARTIAL);

  await userEvent.click(await screen.findByRole('radio', { name: 'suis' }));
  await next();
  expect(screen.queryByText('Nous avons mangé une crêpe')).toBeNull();
  await next();
  expect(screen.queryByText('El verbo aller usa être.')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
  expect(await screen.findByText('El verbo aller usa être.')).toBeVisible();
  expect(screen.getByText('Sin responder')).toBeVisible();
  expect(screen.queryByText('Nous avons mangé une crêpe')).toBeNull();

  const sent = transport.calls.find((call) => call.method === 'POST')!
    .body as QuizAttemptIn;
  expect(sent.answers).toEqual([{ question_id: 'q_1', answer: 'suis' }]);
});

test('el resultado dice correcto o incorrecto con texto e icono, no solo color', async () => {
  renderQuiz(QUIZ_TWO, RESULT_TWO);

  await userEvent.click(await screen.findByRole('radio', { name: 'suis' }));
  await next();
  await userEvent.type(
    screen.getByRole('textbox', { name: /Traducción/ }),
    'Nous avons mangé',
  );
  await next();
  await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

  expect(await screen.findByText('Correcto')).toBeVisible();
  expect(screen.getByText('Incorrecto')).toBeVisible();
  expect(document.querySelector('.feedback.ok .icon')).not.toBeNull();
  expect(document.querySelector('.feedback.ko .icon')).not.toBeNull();
});
