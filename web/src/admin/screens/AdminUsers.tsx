import { useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { HttpError, toUiError } from '../../api/client';
import { useResource } from '../../api/useResource';
import { Button, Chip, Dialog, StateView } from '../../components';
import type { ChipTone } from '../../components';
import type { UserOut } from '../../contracts/generated';
import { formatShort } from '../../i18n/dates';
import { messageFor } from '../../l10n/errors';
import { roleLabel, userStatusLabel, usersStrings } from '../usersStrings';

function roleTone(role: UserOut['role']): ChipTone {
  return role === 'admin' ? 'level' : 'neutral';
}

function statusTone(disabled: boolean): ChipTone {
  return disabled ? 'danger' : 'success';
}

function actionMessage(cause: unknown): string {
  if (cause instanceof HttpError && cause.messageEs !== '') {
    return cause.messageEs;
  }
  return messageFor(toUiError(cause));
}

export function AdminUsers() {
  const api = useApi();
  const strings = usersStrings.users;
  const state = useResource('admin-users', (signal) =>
    api.adminUsers({ signal }),
  );
  const [pending, setPending] = useState<UserOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function open(user: UserOut): void {
    setNotice(null);
    setActionError(null);
    setPending(user);
  }

  function close(): void {
    if (busy) return;
    setPending(null);
    setActionError(null);
  }

  async function confirm(): Promise<void> {
    if (pending === null) return;
    const user = pending;
    setBusy(true);
    setNotice(null);
    setActionError(null);
    try {
      if (user.disabled) {
        await api.enableUser(user.id);
        setNotice(strings.enabledNotice(user.display_name));
      } else {
        await api.disableUser(user.id);
        setNotice(strings.disabledNotice(user.display_name));
      }
      setPending(null);
      state.reload();
    } catch (cause) {
      // Un 409 («último admin activo») se muestra tal cual y la lista sigue.
      setActionError(actionMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function Users({ users }: { users: UserOut[] }) {
    return (
      <ul className="list">
        {users.map((user) => (
          <li key={user.id}>
            <div className="list-item">
              <span className="grow">
                <span className="title">{user.display_name}</span>
                <br />
                <span className="meta">{user.email}</span>
                <br />
                <span className="meta">
                  {user.last_login_at === null
                    ? strings.neverLoggedIn
                    : strings.lastLogin(formatShort(user.last_login_at))}
                </span>
              </span>
              <span className="row wrap">
                <Chip tone={roleTone(user.role)}>{roleLabel(user.role)}</Chip>
                <Chip tone={statusTone(user.disabled)}>
                  {userStatusLabel(user.disabled)}
                </Chip>
                <Button variant="secondary" onClick={() => open(user)}>
                  {user.disabled
                    ? strings.enable(user.display_name)
                    : strings.disable(user.display_name)}
                </Button>
              </span>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="stack-lg">
      <h1>{strings.title}</h1>

      {notice !== null ? (
        <p className="callout info" role="status">
          {notice}
        </p>
      ) : null}

      <StateView
        state={state}
        empty={(users) => users.length === 0}
        emptyText={strings.empty}
        onRetry={state.reload}
      >
        {(users) => <Users users={users} />}
      </StateView>

      <Dialog
        open={pending !== null}
        title={
          pending?.disabled === true
            ? strings.enableTitle
            : strings.disableTitle
        }
        onClose={close}
        actions={
          pending === null ? undefined : (
            <>
              <Button variant="ghost" onClick={close}>
                {usersStrings.cancel}
              </Button>
              <Button
                variant="primary"
                busy={busy}
                onClick={() => void confirm()}
              >
                {usersStrings.confirm}
              </Button>
            </>
          )
        }
      >
        {pending !== null ? (
          <div className="stack">
            <p>
              {pending.disabled
                ? strings.enableConfirm(pending.display_name)
                : strings.disableConfirm(pending.display_name)}
            </p>
            {actionError !== null ? (
              <p className="callout error" role="alert">
                {actionError}
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

export default AdminUsers;
