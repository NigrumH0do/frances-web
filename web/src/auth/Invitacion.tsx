import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../api/ApiContext';
import {
  HttpError,
  OfflineError,
  toUiError,
  type UiError,
} from '../api/client';
import { Button, Field } from '../components';
import { messageFor } from '../l10n/errors';
import { common } from '../l10n/es';
import { useAuth } from './AuthContext';
import { passwordProblems, type PasswordProblem } from './password';
import { authStrings } from './strings';
import './auth.css';

type CheckState =
  | { status: 'checking' }
  | { status: 'valid' }
  | { status: 'invalid' }
  | { status: 'error'; error: UiError };

function tokenFromHash(): string {
  const hash = window.location.hash;
  return hash.startsWith('#') ? hash.slice(1) : '';
}

function inviteError(error: unknown): string {
  if (error instanceof OfflineError) return authStrings.invite.offline;
  if (error instanceof HttpError) {
    // Invitación inválida y email ya existente responden igual (400, mismo
    // texto): nunca se revela qué correos tienen cuenta.
    if (error.status === 400 || error.status === 409) {
      return authStrings.invite.invalid;
    }
    if (error.status === 429) return authStrings.invite.rateLimited;
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

// Pantalla `/invitacion`. El token se lee del fragmento de la URL una sola
// vez, se guarda en memoria y se borra del historial antes de llamar a la API.
export default function Invitacion() {
  const api = useApi();
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [token] = useState(tokenFromHash);
  const [check, setCheck] = useState<CheckState>(
    token === '' ? { status: 'invalid' } : { status: 'checking' },
  );
  const [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problems, setProblems] = useState<PasswordProblem[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (token === '') return;
    const url = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, '', url);
  }, [token]);

  useEffect(() => {
    if (token === '') return;
    let cancelled = false;
    setCheck({ status: 'checking' });
    api.inviteCheck({ token }).then(
      (result) => {
        if (cancelled) return;
        setCheck(result.valid ? { status: 'valid' } : { status: 'invalid' });
      },
      (error: unknown) => {
        if (cancelled) return;
        if (
          error instanceof HttpError &&
          (error.status === 400 || error.status === 409)
        ) {
          setCheck({ status: 'invalid' });
          return;
        }
        setCheck({ status: 'error', error: toUiError(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, attempt, token]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextProblems = passwordProblems(password, confirm);
    setProblems(nextProblems);
    if (nextProblems.length > 0) return;

    setBusy(true);
    setSubmitError(null);
    try {
      await acceptInvite({
        token,
        email,
        display_name: displayName,
        password,
      });
      setPassword('');
      setConfirm('');
      navigate('/', { replace: true });
    } catch (error) {
      setSubmitError(inviteError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap stack-lg">
      <h1>{authStrings.invite.title}</h1>

      {check.status === 'checking' ? (
        <p role="status">{authStrings.invite.checking}</p>
      ) : null}

      {check.status === 'invalid' ? (
        <p className="callout error" role="alert">
          {authStrings.invite.invalid}
        </p>
      ) : null}

      {check.status === 'error' ? (
        <div className="stack" role="alert">
          <p className="small muted">{messageFor(check.error)}</p>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {common.retry}
          </Button>
        </div>
      ) : null}

      {check.status === 'valid' ? (
        <form className="stack" onSubmit={onSubmit}>
          {submitError !== null ? (
            <p className="callout error" role="alert">
              {submitError}
            </p>
          ) : null}

          <Field label={authStrings.invite.email}>
            <input
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field label={authStrings.invite.displayName}>
            <input
              className="input"
              type="text"
              autoComplete="name"
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>

          <Field
            label={authStrings.invite.password}
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
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Field
            label={authStrings.invite.confirm}
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

          <Button type="submit" variant="primary" size="lg" block busy={busy}>
            {authStrings.invite.submit}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
