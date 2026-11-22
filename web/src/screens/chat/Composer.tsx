import { useId, useState, type JSX, type KeyboardEvent, type Ref } from 'react';
import { Button } from '../../components';
import { tr } from '../../l10n/es';
import { chatStrings } from './strings';

const MAX_QUESTION = 2000;

/**
 * Caja de pregunta del chat: 1…2000 caracteres, Enter envía y Mayús+Enter
 * salta de línea. Deshabilitada sin red, sin hilo o mientras hay una pregunta
 * en curso; el motivo se muestra en texto.
 */
export function Composer({
  disabled,
  reason,
  onSend,
  draft,
  onDraftChange,
  inputRef,
}: {
  disabled: boolean;
  reason?: string;
  onSend: (question: string) => void | Promise<void>;
  draft?: string;
  onDraftChange?: (value: string) => void;
  inputRef?: Ref<HTMLTextAreaElement>;
}): JSX.Element {
  const [internal, setInternal] = useState('');
  const controlled = draft !== undefined;
  const value = controlled ? draft : internal;
  const id = useId();
  const counterId = `${id}-counter`;

  function update(next: string): void {
    if (controlled) onDraftChange?.(next);
    else setInternal(next);
  }

  function send(questionValue: string = value): void {
    const question = questionValue.trim();
    if (disabled || question.length === 0) return;
    update('');
    void onSend(question);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      // Se lee el valor del DOM: Enter puede llegar en el mismo lote que la
      // última pulsación y el estado de React todavía no incluirla.
      send(event.currentTarget.value);
    }
  }

  return (
    <>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor={id}>
          {chatStrings.questionLabel}
        </label>
        <textarea
          ref={inputRef}
          id={id}
          className="textarea"
          name="question"
          aria-label={chatStrings.questionLabel}
          aria-describedby={counterId}
          placeholder={chatStrings.questionPlaceholder}
          maxLength={MAX_QUESTION}
          value={value}
          disabled={disabled}
          onChange={(event) => update(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          type="submit"
          variant="primary"
          icon="send"
          disabled={disabled || value.trim().length === 0}
        >
          {chatStrings.send}
        </Button>
        <span id={counterId} className="composer-count">
          {tr(chatStrings.counter, {
            n: value.length,
            max: MAX_QUESTION,
          })}
        </span>
      </form>
      {reason !== undefined ? (
        <p className="small muted" aria-live="polite">
          {reason}
        </p>
      ) : null}
    </>
  );
}
