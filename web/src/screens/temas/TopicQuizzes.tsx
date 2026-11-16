import type { JSX } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../api/ApiContext';
import { useResource } from '../../api/useResource';
import { Card, Chip, StateView } from '../../components';
import type {
  Quiz as QuizContract,
  QuizAttemptOut,
} from '../../contracts/generated';
import { tr } from '../../l10n/es';
import { temaStrings as s } from './strings';

interface QuizWithAttempts {
  quiz: QuizContract;
  attempts: QuizAttemptOut[];
}

function bestScore(attempts: QuizAttemptOut[]): number | null {
  if (attempts.length === 0) return null;
  return Math.max(...attempts.map((attempt) => attempt.score));
}

function QuizCard({ entry }: { entry: QuizWithAttempts }): JSX.Element {
  const { quiz, attempts } = entry;
  const best = bestScore(attempts);
  const questions =
    quiz.questions.length === 1
      ? s.questionsOne
      : tr(s.questions, { n: quiz.questions.length });

  return (
    <Card>
      <div className="stack">
        <div className="row-between wrap">
          <h3>{quiz.title_es}</h3>
          <Chip>{questions}</Chip>
        </div>
        {quiz.stale ? <Chip tone="warning">{s.quizStale}</Chip> : null}
        <p className="small muted">
          {best === null
            ? s.noAttempts
            : tr(s.best, { n: Math.round(best * 100) })}
        </p>
        <Link className="btn btn-primary btn-block" to={`/quiz/${quiz.id}`}>
          {s.start}
        </Link>
      </div>
    </Card>
  );
}

// Quiz del tema con la mejor nota del usuario en cada uno. Los intentos solo
// traen nota y fechas (QuizAttemptOut), nunca respuestas de otro usuario.
export function TopicQuizzes({ topicId }: { topicId: string }): JSX.Element {
  const api = useApi();
  const state = useResource<QuizWithAttempts[]>(
    `topic-quizzes:${topicId}`,
    async (signal) => {
      const quizzes = await api.quizzes('topic', topicId, { signal });
      return Promise.all(
        quizzes.map(async (quiz) => ({
          quiz,
          attempts: await api.attempts(quiz.id, { signal }),
        })),
      );
    },
  );

  return (
    <StateView
      state={state}
      empty={(quizzes) => quizzes.length === 0}
      emptyText={s.quizEmpty}
      onRetry={state.reload}
    >
      {(quizzes) => (
        <div className="stack">
          {quizzes.map((entry) => (
            <QuizCard entry={entry} key={entry.quiz.id} />
          ))}
        </div>
      )}
    </StateView>
  );
}

export default TopicQuizzes;
