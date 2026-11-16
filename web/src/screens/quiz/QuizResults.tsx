import { Icon, Progress } from '../../components';
import type { Quiz, QuizAttemptResult } from '../../contracts/generated';
import { tr } from '../../l10n/es';
import { quizStrings } from './strings';

function formatExpected(expected: string | string[]): string {
  return Array.isArray(expected) ? expected.join(' ') : expected;
}

export function QuizResults({
  quiz,
  result,
}: {
  quiz: Quiz;
  result: QuizAttemptResult;
}) {
  const byQuestion = new Map(
    result.results.map((answer) => [answer.question_id, answer]),
  );
  const correct = result.results.filter((answer) => answer.correct).length;
  const total = quiz.questions.length;
  const percent = Math.round(result.score * 100);

  return (
    <section className="stack-lg" role="status" aria-live="polite">
      <h2>{quizStrings.resultTitle}</h2>
      <p className="quiz-q">{tr(quizStrings.score, { correct, total })}</p>
      <Progress value={correct} max={total} label={quizStrings.scoreLabel} />
      <p className="small muted">{tr(quizStrings.percent, { percent })}</p>

      <ol className="stack">
        {quiz.questions.map((question, index) => {
          const answer = byQuestion.get(question.id);
          return (
            <li
              key={question.id}
              className={
                answer === undefined
                  ? 'card card-tight'
                  : answer.correct
                    ? 'feedback ok'
                    : 'feedback ko'
              }
            >
              <div className="row-between">
                <p className="small muted">
                  {tr(quizStrings.question, { i: index + 1 })}
                </p>
                {answer === undefined ? (
                  <span className="row small">
                    <Icon name="alert" size="sm" />
                    {quizStrings.unanswered}
                  </span>
                ) : (
                  <strong className={answer.correct ? 'ok' : 'ko'}>
                    <Icon name={answer.correct ? 'check' : 'x'} size="sm" />
                    {answer.correct
                      ? quizStrings.correct
                      : quizStrings.incorrect}
                  </strong>
                )}
              </div>
              <p>{question.prompt_es}</p>
              {answer !== undefined ? (
                <div className="stack">
                  <p className="small">
                    {quizStrings.expected}:{' '}
                    <span className="fr" lang="fr">
                      {formatExpected(answer.expected)}
                    </span>
                  </p>
                  {answer.explanation_es !== null ? (
                    <p className="small muted">{answer.explanation_es}</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
