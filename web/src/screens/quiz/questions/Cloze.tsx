import { Field } from '../../../components';
import { quizStrings } from '../strings';
import type { QuestionProps } from './types';

export function Cloze({ q, value, onChange }: QuestionProps<string>) {
  const prompt = q.prompt_fr ?? '';
  const gap = prompt.indexOf('___');
  const before = gap >= 0 ? prompt.slice(0, gap) : '';
  const after = gap >= 0 ? prompt.slice(gap + 3) : '';

  return (
    <fieldset className="stack">
      <legend className="quiz-q">{q.prompt_es}</legend>
      {gap >= 0 ? (
        <p className="quiz-q">
          <span className="fr" lang="fr">
            {before}
            <input
              className="gap"
              aria-label={quizStrings.clozeAnswer}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {after}
          </span>
        </p>
      ) : (
        <>
          {prompt !== '' ? (
            <p className="fr" lang="fr">
              {prompt}
            </p>
          ) : null}
          <Field label={quizStrings.clozeAnswer}>
            <input
              className="input fr"
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
          </Field>
        </>
      )}
    </fieldset>
  );
}
