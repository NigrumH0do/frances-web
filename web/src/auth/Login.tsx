import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { HttpError, OfflineError, toUiError } from '../api/client';
import { IS_DEMO } from '../api/transport';
import { Button, Field } from '../components';
import { messageFor } from '../l10n/errors';
import { useAuth } from './AuthContext';
import { safeNext } from './next';
import { authStrings } from './strings';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo-demo-demo';

function loginError(error: unknown): string {
  if (error instanceof OfflineError) return authStrings.login.offline;
  if (error instanceof HttpError) {
    if (error.status === 429) return authStrings.login.rateLimited;
    if (error.status === 401) {
      return error.messageEs || authStrings.login.badCredentials;
    }
    return error.messageEs || messageFor(toUiError(error));
  }
  return messageFor(toUiError(error));
}

// Pantalla `/entrar`. La contraseña solo vive en el estado del formulario:
// no se escribe en almacenamiento, URL ni logs.
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = safeNext(new URLSearchParams(location.search).get('next'));

  async function enter(loginEmail: string, loginPassword: string) {
    setBusy(true);
    setError(null);
    try {
      await login(loginEmail, loginPassword);
      setPassword('');
      navigate(next, { replace: true });
    } catch (e) {
      setError(loginError(e));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void enter(email, password);
  }

  return (
    <div className="stack-lg">
      <h1>{authStrings.login.title}</h1>

      <form className="stack" onSubmit={onSubmit}>
        {error !== null ? (
          <p className="callout error" role="alert">
            {error}
          </p>
        ) : null}

        <Field label={authStrings.login.email}>
          <input
            className="input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field label={authStrings.login.password}>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" block busy={busy}>
          {authStrings.login.submit}
        </Button>
      </form>

      {IS_DEMO ? (
        <div className="callout info">
          <p className="small grow">{authStrings.login.demoHint}</p>
          <Button
            variant="secondary"
            onClick={() => void enter(DEMO_EMAIL, DEMO_PASSWORD)}
          >
            {authStrings.login.demoButton}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
