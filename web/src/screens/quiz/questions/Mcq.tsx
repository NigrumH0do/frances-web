import { useId } from 'react';
import type { QuestionProps } from './types';

const LETTERS = 'ABCDEFGH';

export function Mcq({ q, value, onChange }: QuestionProps<string>) {
  const legendId = useId();

  return (
    <fieldset className="stack">
      <legend className="quiz-q" id={legendId}>
        {q.prompt_es}
        {q.prompt_fr ? (
          <span className="fr" lang="fr">
            {' '}
            {q.prompt_fr}
          </span>
        ) : null}
      </legend>
      <div className="options" role="radiogroup" aria-labelledby={legendId}>
        {q.options.map((option, index) => (
          <button
            key={`${option}-${index}`}
            type="button"
            role="radio"
            aria-checked={value === option}
            className="option"
            onClick={() => onChange(option)}
          >
            <span className="key" aria-hidden="true">
              {LETTERS[index] ?? index + 1}
            </span>
            <span lang="fr">{option}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
