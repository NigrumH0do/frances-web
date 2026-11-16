import { useId, useRef, type JSX } from 'react';
import { Icon } from '../../components';
import { tr } from '../../l10n/es';
import { FRENCH_KEYS, textoStrings as s } from './strings';

// Hoja pautada del texto libre: el texto en francés se escribe sobre la pauta
// Seyès. La fila de letras inserta en el cursor los caracteres que no están en
// un teclado español, sin quitar el foco del texto.
export function TextEditor({
  value,
  max,
  onChange,
}: {
  value: string;
  max: number;
  onChange: (next: string) => void;
}): JSX.Element {
  const id = useId();
  const countId = `${id}-count`;
  const ref = useRef<HTMLTextAreaElement | null>(null);

  function insert(char: string): void {
    const element = ref.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    const next = value.slice(0, start) + char + value.slice(end);
    if (next.length > max) return;
    onChange(next);
    const caret = start + char.length;
    requestAnimationFrame(() => {
      if (element === null) return;
      element.focus();
      element.setSelectionRange(caret, caret);
    });
  }

  return (
    <section className="lab-editor">
      <div className="lab-editor-head">
        <label htmlFor={id} className="lab-label">
          {s.editorLabel}
        </label>
        <span className="lab-editor-tools">
          <span id={countId} className="lab-count">
            {tr(s.counter, { n: value.length, max })}
          </span>
          {value !== '' ? (
            <button
              type="button"
              className="btn btn-ghost lab-clear"
              onClick={() => {
                onChange('');
                ref.current?.focus();
              }}
            >
              <Icon name="x" size="sm" />
              {s.clear}
            </button>
          ) : null}
        </span>
      </div>
      <div className="lab-sheet paper">
        <textarea
          id={id}
          ref={ref}
          className="lab-textarea"
          lang="fr"
          rows={4}
          maxLength={max}
          // El corrector del navegador suele estar en español y marcaría
          // cada palabra francesa como error.
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="sentences"
          aria-describedby={countId}
          placeholder={s.placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <div className="lab-editor-bar">
        <div className="lab-keys" role="group" aria-label={s.keysLabel}>
          {FRENCH_KEYS.map((char) => (
            <button
              key={char}
              type="button"
              className="lab-key"
              lang="fr"
              aria-label={tr(s.keyInsert, { char })}
              // Mantiene la selección del texto al pulsar con el ratón.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(char)}
            >
              {char}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
