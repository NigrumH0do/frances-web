import { useState } from 'react';
import { toUiError } from '../api/client';
import { Button, Dialog } from '../components';
import { messageFor } from '../l10n/errors';
import { useAuth } from './AuthContext';
import { authStrings } from './strings';

// Botón de cierre de sesión. Si la cola sin conexión tiene escrituras
// pendientes (P09-4), pregunta antes de cerrar; «Cerrar sesión igual» las
// descarta al purgar los datos del usuario.

export function LogoutButton() {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function close(discardPending = false) {
    setBusy(true);
    setError(null);
    try {
      const result = await logout({ discardPending });
      setBlocked(result.blocked > 0 ? result.blocked : null);
    } catch (e) {
      setError(messageFor(toUiError(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" busy={busy} onClick={() => void close()}>
        {authStrings.logout.button}
      </Button>
      {error !== null ? (
        <p className="small" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog
        open={blocked !== null}
        title={authStrings.logout.pendingTitle(blocked ?? 0)}
        onClose={() => setBlocked(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => void close()}>
              {authStrings.logout.retry}
            </Button>
            <Button variant="danger" onClick={() => void close(true)}>
              {authStrings.logout.discard}
            </Button>
          </>
        }
      >
        <p>{authStrings.logout.pendingBody}</p>
      </Dialog>
    </>
  );
}
