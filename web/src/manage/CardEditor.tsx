import { useState, type FormEvent } from 'react';
import { HttpError, toUiError } from '../api/client';
import { Button, Field, Segmented } from '../components';
import type { CardView } from '../contracts/generated';
import { messageFor } from '../l10n/errors';
import type { CardEditorMode, OwnCardKind } from './strings';
import { manageStrings as s } from './strings';

export type { CardEditorMode } from './strings';

export interface CardEditorValues {
  kind: OwnCardKind;
  front_fr: string;
  back_es: string;
  example_fr: string;
  example_es: string;
  notes: string;
}

interface FieldErrors {
  front_fr?: string;
  back_es?: string;
  example_fr?: string;
  example_es?: string;
  notes?: string;
}

const MAX_SHORT = 500;
const MAX_LONG = 2000;

const OWN_KINDS: OwnCardKind[] = ['vocab', 'phrase', 'grammar', 'conjugation'];

function ownKind(kind: CardView['kind']): OwnCardKind {
  return kind === 'drill' ? 'vocab' : kind;
}

/** Campos editables de una tarjeta. En modo `override` manda la copia personal. */
function initialValues(
  mode: CardEditorMode,
  card: CardView | undefined,
  initial: Partial<CardEditorValues> | undefined,
): CardEditorValues {
  if (initial !== undefined) {
    return {
      kind: initial.kind ?? 'vocab',
      front_fr: initial.front_fr ?? '',
      back_es: initial.back_es ?? '',
      example_fr: initial.example_fr ?? '',
      example_es: initial.example_es ?? '',
      notes: initial.notes ?? '',
    };
  }
  if (card === undefined) {
    return {
      kind: 'vocab',
      front_fr: '',
      back_es: '',
      example_fr: '',
      example_es: '',
      notes: '',
    };
  }
  const source = mode === 'override' ? (card.mine ?? card) : card;
  return {
    kind: ownKind(card.kind),
    front_fr: source.front_fr,
    back_es: source.back_es,
    example_fr: source.example_fr ?? '',
    example_es: source.example_es ?? '',
    notes: source.notes ?? '',
  };
}

function validate(values: CardEditorValues): FieldErrors {
  const errors: FieldErrors = {};
  if (values.front_fr.trim() === '') {
    errors.front_fr = s.editor.requiredFront;
  } else if (values.front_fr.length > MAX_SHORT) {
    errors.front_fr = s.editor.maxFront;
  }
  if (values.back_es.trim() === '') {
    errors.back_es = s.editor.requiredBack;
  } else if (values.back_es.length > MAX_SHORT) {
    errors.back_es = s.editor.maxBack;
  }
  if (values.example_fr.length > MAX_LONG) {
    errors.example_fr = s.editor.maxExampleFr;
  }
  if (values.example_es.length > MAX_LONG) {
    errors.example_es = s.editor.maxExampleEs;
  }
  if (values.notes.length > MAX_LONG) {
    errors.notes = s.editor.maxNotes;
  }
  return errors;
}

/** Convierte un campo opcional vacío en `null` antes de mandarlo a la API. */
export function blankToNull(value: string): string | null {
  const clean = value.trim();
  return clean === '' ? null : clean;
}

/**
 * Formulario compartido por la copia personal, la edición del admin y la
 * tarjeta propia. Solo maneja los campos editables: nunca envía el id, el
 * propietario, la copia personal ni el estado FSRS de la tarjeta.
 */
export function CardEditor({
  mode,
  card,
  initial,
  onSave,
  onCancel,
}: {
  mode: CardEditorMode;
  card?: CardView;
  initial?: Partial<CardEditorValues>;
  onSave: (values: CardEditorValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<CardEditorValues>(() =>
    initialValues(mode, card, initial),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof CardEditorValues>(
    field: K,
    value: CardEditorValues[K],
  ): void {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setServerError(null);
  }

  async function persist(): Promise<void> {
    if (saving) return;
    const nextErrors = validate(values);
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      await onSave(values);
    } catch (cause) {
      setServerError(
        cause instanceof HttpError && cause.messageEs !== ''
          ? cause.messageEs
          : messageFor(toUiError(cause)),
      );
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void persist();
  }

  const isOwn = mode === 'own';
  const actionLabel = isOwn ? s.editor.create : s.editor.save;

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {isOwn ? (
        <div className="field">
          <span className="small">{s.editor.kind}</span>
          <Segmented<OwnCardKind>
            label={s.editor.kind}
            options={OWN_KINDS.map((kind) => ({
              value: kind,
              label: s.kinds[kind],
            }))}
            value={values.kind}
            onChange={(kind) => update('kind', kind)}
          />
        </div>
      ) : null}

      <Field label={s.editor.front} error={errors.front_fr}>
        <textarea
          className="textarea"
          value={values.front_fr}
          lang="fr"
          onChange={(event) => update('front_fr', event.target.value)}
        />
      </Field>
      <Field label={s.editor.back} error={errors.back_es}>
        <textarea
          className="textarea"
          value={values.back_es}
          onChange={(event) => update('back_es', event.target.value)}
        />
      </Field>
      <Field label={s.editor.exampleFr} error={errors.example_fr}>
        <textarea
          className="textarea"
          value={values.example_fr}
          lang="fr"
          onChange={(event) => update('example_fr', event.target.value)}
        />
      </Field>
      <Field label={s.editor.exampleEs} error={errors.example_es}>
        <textarea
          className="textarea"
          value={values.example_es}
          onChange={(event) => update('example_es', event.target.value)}
        />
      </Field>
      <Field label={s.editor.notes} error={errors.notes}>
        <textarea
          className="textarea"
          value={values.notes}
          onChange={(event) => update('notes', event.target.value)}
        />
      </Field>

      {serverError !== null ? (
        <div className="callout error" role="alert">
          <p className="small grow">{serverError}</p>
          <Button
            variant="secondary"
            busy={saving}
            onClick={() => void persist()}
          >
            {s.editor.retry}
          </Button>
        </div>
      ) : null}

      <div className="row wrap">
        <Button type="submit" variant="primary" busy={saving}>
          {actionLabel}
        </Button>
        <Button variant="ghost" disabled={saving} onClick={onCancel}>
          {s.editor.cancel}
        </Button>
      </div>
    </form>
  );
}

export type { OwnCardKind };
