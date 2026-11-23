import { Field } from '../../../components';
import { quizStrings } from '../strings';
import type { QuestionProps } from './types';

export function Translate({ q, value, onChange }: QuestionProps<string>) {
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
      <div className="quiz-answer" key={q.id}>
        <Field
          label={quizStrings.translateLabel}
          hint={quizStrings.translateHint}
        >
          <textarea
            className="textarea fr"
            lang="fr"
            rows={4}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </div>
    </fieldset>
  );
}
