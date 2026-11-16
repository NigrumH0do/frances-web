import { tr } from '../../../l10n/es';
import { quizStrings } from '../strings';
import type { QuestionProps } from './types';

function remainingWords(options: string[], selected: string[]): string[] {
  const pool = [...options];
  for (const word of selected) {
    const index = pool.indexOf(word);
    if (index >= 0) pool.splice(index, 1);
  }
  return pool;
}

export function Order({ q, value, onChange }: QuestionProps<string[]>) {
  const remaining = remainingWords(q.options, value);

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [word] = next.splice(index, 1);
    next.splice(target, 0, word);
    onChange(next);
  }

  return (
    <fieldset className="stack">
      <legend className="quiz-q">
        {q.prompt_es}
        {q.prompt_fr ? (
          <span className="fr" lang="fr">
            {' '}
            {q.prompt_fr}
          </span>
        ) : null}
      </legend>
      <p className="small muted">{quizStrings.orderHelp}</p>

      <p className="small muted">{quizStrings.orderPhrase}</p>
      <div
        className="answer-line"
        role="group"
        aria-label={quizStrings.orderPhrase}
      >
        {value.length === 0 ? (
          <span className="small muted" aria-hidden="true">
            —
          </span>
        ) : null}
        {value.map((word, index) => (
          <span key={`${word}-${index}`} className="row">
            <button
              type="button"
              className="tile"
              onClick={() => onChange(value.filter((_, at) => at !== index))}
            >
              {word}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm-text"
              aria-label={tr(quizStrings.moveUp, { word })}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              {quizStrings.up}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm-text"
              aria-label={tr(quizStrings.moveDown, { word })}
              disabled={index === value.length - 1}
              onClick={() => move(index, 1)}
            >
              {quizStrings.down}
            </button>
          </span>
        ))}
      </div>

      <p className="small muted">{quizStrings.orderWords}</p>
      <div className="tiles" role="group" aria-label={quizStrings.orderWords}>
        {remaining.length === 0 ? (
          <span className="small muted" aria-hidden="true">
            —
          </span>
        ) : null}
        {remaining.map((word, index) => (
          <button
            key={`${word}-${index}`}
            type="button"
            className="tile"
            onClick={() => onChange([...value, word])}
          >
            {word}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
