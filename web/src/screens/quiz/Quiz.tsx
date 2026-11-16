import { useEffect, useId, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { AppBar, Button, Chip, Icon, StateView } from '../../components';
import { useApi } from '../../api/ApiContext';
import { toUiError, type UiError } from '../../api/client';
import { useResource } from '../../api/useResource';
import type {
  AnswerIn,
  Quiz as QuizContract,
  QuizAttemptIn,
  QuizAttemptResult,
} from '../../contracts/generated';
import { messageFor } from '../../l10n/errors';
import { common, tr } from '../../l10n/es';
import { useOffline } from '../../offline/OfflineContext';
import {
  clearDraft,
  isAnswered,
  newDraft,
  readDraft,
  saveDraft,
  type QuizAnswer,
} from './draft';
import { Cloze } from './questions/Cloze';
import { Dictation } from './questions/Dictation';
import { Mcq } from './questions/Mcq';
import { Order } from './questions/Order';
import { Translate } from './questions/Translate';
import type { QuizQuestion } from './questions/types';
import { QuizResults } from './QuizResults';
import { quizStrings } from './strings';

function QuestionControl({
  question,
  value,
  onChange,
}: {
  question: QuizQuestion;
  value: QuizAnswer | undefined;
  onChange: (value: QuizAnswer) => void;
}) {
  switch (question.kind) {
    case 'mcq':
      return (
        <Mcq
          q={question}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      );
    case 'cloze':
      return (
        <Cloze
          q={question}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      );
    case 'translate':
      return (
        <Translate
          q={question}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      );
    case 'order':
      return (
        <Order
          q={question}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
        />
      );
    case 'dictation':
      return (
        <Dictation
          q={question}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      );
  }
}

export default function Quiz() {
  const { quizId } = useParams<{ quizId: string }>();
  const api = useApi();
  const id = quizId ?? '';
  const state = useResource(id === '' ? null : `quiz:${id}`, (signal) =>
    api.quiz(id, { signal }),
  );
  const title =
    state.status === 'ready' ? state.data.title_es : quizStrings.title;

  return (
    <div className="stack">
      <AppBar title={title} back={{ to: '/temas', label: quizStrings.back }} />
      {state.status === 'ready' && state.data.stale ? (
        <p className="callout info" role="status">
          <Icon name="alert" size="sm" />
          <span className="grow">{quizStrings.stale}</span>
        </p>
      ) : null}
      <StateView
        state={state}
        empty={(quiz) => quiz.questions.length === 0}
        emptyText={quizStrings.empty}
        onRetry={state.reload}
      >
        {(quiz) => <QuizBody key={quiz.id} quiz={quiz} />}
      </StateView>
    </div>
  );
}

function QuizBody({ quiz }: { quiz: QuizContract }) {
  const api = useApi();
  const { online } = useOffline();
  const [draft] = useState(() => readDraft(quiz.id) ?? newDraft());
  const [startedAt] = useState(() => draft.started_at);
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>(
    () => draft.answers,
  );
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'questions' | 'review'>('questions');
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<UiError | null>(null);
  const offlineId = useId();
  const noAnswersId = useId();

  useEffect(() => {
    if (result !== null) return;
    saveDraft(quiz.id, { started_at: startedAt, answers });
  }, [answers, quiz.id, result, startedAt]);

  const answeredCount = useMemo(
    () =>
      quiz.questions.filter((question) => isAnswered(answers[question.id]))
        .length,
    [answers, quiz.questions],
  );

  const payload = useMemo<AnswerIn[]>(
    () =>
      quiz.questions.flatMap((question) => {
        const answer = answers[question.id];
        return isAnswered(answer)
          ? [{ question_id: question.id, answer: answer! }]
          : [];
      }),
    [answers, quiz.questions],
  );

  function changeAnswer(questionId: string, value: QuizAnswer): void {
    setAnswers((previous) => ({ ...previous, [questionId]: value }));
  }

  async function submit(): Promise<void> {
    if (!online || submitting) return;
    const [first, ...rest] = payload;
    if (first === undefined) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: QuizAttemptIn = {
        started_at: startedAt,
        answers: [first, ...rest],
      };
      const next = await api.submitAttempt(quiz.id, body);
      clearDraft(quiz.id);
      setResult(next);
    } catch (error) {
      setSubmitError(toUiError(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (result !== null) {
    return <QuizResults quiz={quiz} result={result} />;
  }

  if (phase === 'review') {
    return (
      <section className="stack-lg">
        <h2>{quizStrings.reviewTitle}</h2>
        <p className="small muted">
          {tr(quizStrings.answeredCount, {
            answered: answeredCount,
            total: quiz.questions.length,
          })}
        </p>
        <ol className="stack">
          {quiz.questions.map((question, position) => {
            const answered = isAnswered(answers[question.id]);
            return (
              <li key={question.id} className="card card-tight">
                <div className="row-between">
                  <button
                    type="button"
                    className="btn btn-ghost grow"
                    onClick={() => {
                      setIndex(position);
                      setPhase('questions');
                    }}
                  >
                    {tr(quizStrings.question, { i: position + 1 })} ·{' '}
                    {question.prompt_es}
                  </button>
                  <Chip tone={answered ? 'success' : 'danger'}>
                    <Icon name={answered ? 'check' : 'alert'} size="sm" />
                    {answered ? quizStrings.answered : quizStrings.unanswered}
                  </Chip>
                </div>
              </li>
            );
          })}
        </ol>

        {!online ? (
          <p id={offlineId} className="callout info" role="status">
            <Icon name="offline" size="sm" />
            <span className="grow">{quizStrings.offline}</span>
          </p>
        ) : null}

        {payload.length === 0 ? (
          <p id={noAnswersId} className="small muted">
            {quizStrings.nothingAnswered}
          </p>
        ) : null}

        {submitError !== null ? (
          <div className="callout error" role="alert">
            <Icon name="alert" size="sm" />
            <p className="grow">
              {quizStrings.submitError} {messageFor(submitError)}
            </p>
            <Button
              variant="secondary"
              onClick={() => void submit()}
              disabled={!online}
              busy={submitting}
            >
              {common.retry}
            </Button>
          </div>
        ) : null}

        <Button
          variant="primary"
          block
          onClick={() => void submit()}
          disabled={!online || payload.length === 0}
          busy={submitting}
          aria-describedby={
            !online ? offlineId : payload.length === 0 ? noAnswersId : undefined
          }
        >
          {submitting ? quizStrings.sending : quizStrings.send}
        </Button>
      </section>
    );
  }

  const question = quiz.questions[index];
  if (question === undefined) return null;

  return (
    <section className="stack-lg">
      <p className="small muted">
        {tr(quizStrings.progress, {
          i: index + 1,
          n: quiz.questions.length,
        })}
      </p>

      <QuestionControl
        question={question}
        value={answers[question.id]}
        onChange={(value) => changeAnswer(question.id, value)}
      />

      <div className="row-between">
        <Button
          variant="secondary"
          onClick={() => setIndex(index - 1)}
          disabled={index === 0}
        >
          {quizStrings.previous}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            if (index < quiz.questions.length - 1) {
              setIndex(index + 1);
            } else {
              setPhase('review');
            }
          }}
        >
          {index === quiz.questions.length - 1
            ? quizStrings.review
            : quizStrings.next}
        </Button>
      </div>
    </section>
  );
}
