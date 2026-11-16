import { useState, type FormEvent } from 'react';
import { useApi } from '../api/ApiContext';
import { HttpError, OfflineError, toUiError } from '../api/client';
import { Button, Field } from '../components';
import { messageFor } from '../l10n/errors';
import { passwordProblems, type PasswordProblem } from './password';
import { authStrings } from './strings';

function changeError(error: unknown): string {
  if (error instanceof OfflineError) return authStrings.password.offline;
  if (error instanceof HttpError) {
    if (error.status === 429) return authStrings.password.rateLimited;
    if (error.status === 400) {
      return error.messageEs || authStrings.password.currentWrong;
    }
    return error.messageEs || messageFor(toUiError(error));
  }
  return messageFor(toUiError(error));
}

function passwordMessage(
  problems: PasswordProblem[],
  problem: PasswordProblem,
): string | undefined {
  if (!problems.includes(problem)) return undefined;
  if (problem === 'short') return authStrings.password.short;
  if (problem === 'long') return authStrings.password.long;
  return authStrings.password.mismatch;
}

// Formulario de cambio de contraseña. Las tres contraseñas viven solo en el
// estado del formulario y se limpian al terminar; nunca se persisten.
export function ChangePassword() {
  const api = useApi();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problems, setProblems] = useState<PasswordProblem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChanged(false);
    const nextProblems = passwordProblems(next, confirm);
    setProblems(nextProblems);
    if (nextProblems.length > 0) return;

    setBusy(true);
    setError(null);
    try {
      await api.changePassword({
        current_password: current,
        new_password: next,
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      setProblems([]);
      setChanged(true);
    } catch (e) {
      setError(changeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <h2>{authStrings.password.title}</h2>

      {error !== null ? (
        <p className="callout error" role="alert">
          {error}
        </p>
      ) : null}
      {changed ? (
        <p className="callout info" role="status">
          {authStrings.password.success}
        </p>
      ) : null}

      <Field label={authStrings.password.current}>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </Field>

      <Field
        label={authStrings.password.next}
        error={
          passwordMessage(problems, 'short') ??
          passwordMessage(problems, 'long')
        }
      >
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          required
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
      </Field>

      <Field
        label={authStrings.password.confirm}
        error={passwordMessage(problems, 'mismatch')}
      >
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" busy={busy}>
        {authStrings.password.submit}
      </Button>
    </form>
  );
}
