import type { UserStats } from '../../contracts/generated';
import { masStrings } from './strings';

// Métricas del usuario. La retención nula se explica en texto: nunca se
// muestra un cero que parezca un dato real cuando aún faltan repasos.
export function ProgressSection({ stats }: { stats: UserStats }) {
  const strings = masStrings.progress;
  const retention =
    stats.retention_30d === null
      ? strings.retentionUnknown
      : `${Math.round(stats.retention_30d * 100)} %`;

  return (
    <div className="stack">
      <div className="stats">
        <div className="stat">
          <b>{stats.cards_learned}</b>
          <span>{strings.cardsLearned}</span>
        </div>
        <div className="stat">
          <b>{retention}</b>
          <span>{strings.retention}</span>
          {stats.retention_30d === null ? (
            <span className="xs">{strings.retentionHint}</span>
          ) : null}
        </div>
        <div className="stat">
          <b>{stats.streak_days}</b>
          <span>{strings.streak}</span>
        </div>
      </div>

      {stats.quiz_best.length === 0 ? (
        <p className="small muted">{strings.quizEmpty}</p>
      ) : (
        <ul className="list">
          {stats.quiz_best.map((quiz) => (
            <li key={quiz.quiz_id}>
              <div className="list-item">
                <span className="grow">
                  <span className="title">{quiz.title_es}</span>
                  <br />
                  <span className="meta">
                    {strings.attempts(quiz.attempts)}
                  </span>
                </span>
                <span
                  className="chip"
                  aria-label={`Nota: ${strings.score(quiz.best_score)}`}
                >
                  {strings.score(quiz.best_score)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ProgressSection;
