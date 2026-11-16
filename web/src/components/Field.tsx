import { cloneElement, useId, type ReactElement } from 'react';

interface FieldControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

// Etiqueta y mensajes de un campo. Asocia id, aria-describedby y aria-invalid al control.
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactElement<FieldControlProps>;
}) {
  const generated = useId();
  const controlId = children.props.id ?? generated;
  const hintId = `${generated}-hint`;
  const errorId = `${generated}-error`;
  // Se conservan los ids que el hijo ya traía y se añaden los de pista y error.
  const describedBy = [
    children.props['aria-describedby'],
    hint ? hintId : null,
    error ? errorId : null,
  ]
    .filter(Boolean)
    .join(' ');
  const control = cloneElement(children, {
    id: controlId,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': error ? true : children.props['aria-invalid'],
  });
  return (
    <div className="field">
      <label htmlFor={controlId}>{label}</label>
      {control}
      {hint ? (
        <p id={hintId} className="small muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="small" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
