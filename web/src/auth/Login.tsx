import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useApi } from '../api/ApiContext';
import { HttpError, OfflineError, toUiError } from '../api/client';
import { IS_DEMO } from '../api/transport';
import { Button, Field } from '../components';
import { messageFor } from '../l10n/errors';
import { SafeAuthNotebookScene } from '../three/LazyScenes';
import { useAuth } from './AuthContext';
import { safeNext } from './next';
import { authStrings } from './strings';
import './auth.css';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo-demo-demo';

function oauthNotice(search: string): {
  kind: 'info' | 'error';
  text: string;
} | null {
  const params = new URLSearchParams(search);
  if (params.get('status') === 'pending') {
    return { kind: 'info', text: authStrings.login.pendingNotice };
  }
  const err = params.get('error');
  if (err === 'google_denied') {
    return { kind: 'error', text: authStrings.login.googleDenied };
  }
  if (err === 'google_disabled') {
    return { kind: 'error', text: authStrings.login.googleDisabled };
  }
  if (err === 'oauth_state') {
    return { kind: 'error', text: authStrings.login.oauthState };
  }
  if (err === 'google_unverified') {
    return { kind: 'error', text: authStrings.login.googleUnverified };
  }
  if (err === 'account_disabled') {
    return { kind: 'error', text: authStrings.login.accountDisabled };
  }
  if (err === 'max_users') {
    return { kind: 'error', text: authStrings.login.maxUsers };
  }
  if (err === 'google_failed') {
    return { kind: 'error', text: authStrings.login.googleFailed };
  }
  return null;
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-3l-3.9-3a7.2 7.2 0 0 1-10.7-3.8H1.4v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.4 14.2a7.2 7.2 0 0 1 0-4.4V6.7H1.4a12 12 0 0 0 0 10.6l4-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5A12 12 0 0 0 1.4 6.7l4 3.1A7.2 7.2 0 0 1 12 4.8z"
      />
    </svg>
  );
}

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
  const api = useApi();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const next = safeNext(new URLSearchParams(location.search).get('next'));
  const callbackNotice = oauthNotice(location.search);

  useEffect(() => {
    const controller = new AbortController();
    api
      .authProviders({ signal: controller.signal })
      .then((res) => setGoogleEnabled(res.google_enabled))
      .catch(() => undefined);
    return () => controller.abort();
  }, [api]);

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
    <div className="auth-wrap stack-lg">
      <div className="auth-cover">
        <div className="auth-cover-copy">
          <span className="auth-cover-eyebrow">
            {authStrings.login.eyebrow}
          </span>
          <h1>{authStrings.login.title}</h1>
          <p className="auth-cover-sub">{authStrings.login.subtitle}</p>
        </div>
        <div className="auth-cover-visual">
          <SafeAuthNotebookScene
            fallback={
              <div className="auth-fallback-badge" aria-hidden="true">
                Fr
              </div>
            }
          />
        </div>
      </div>

      {callbackNotice !== null ? (
        <p
          className={
            callbackNotice.kind === 'error' ? 'callout error' : 'callout info'
          }
          role={callbackNotice.kind === 'error' ? 'alert' : 'status'}
        >
          {callbackNotice.text}
        </p>
      ) : null}

      {googleEnabled ? (
        <>
          <a
            className="btn-google"
            href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}
          >
            <GoogleMark />
            <span>{authStrings.login.googleContinue}</span>
          </a>
          <div className="auth-divider">{authStrings.login.orEmail}</div>
        </>
      ) : null}

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
