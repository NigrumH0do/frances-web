import { useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { HttpError, toUiError } from '../../api/client';
import { useResource } from '../../api/useResource';
import {
  AppBar,
  Button,
  Chip,
  Dialog,
  Segmented,
  StateView,
} from '../../components';
import type { ChipTone, SegmentedOption } from '../../components';
import type { UserOut } from '../../contracts/generated';
import { formatShort } from '../../i18n/dates';
import { messageFor } from '../../l10n/errors';
import {
  authProviderLabel,
  roleLabel,
  usersStrings,
  type UserStatus,
} from '../usersStrings';

type UserFilter = 'all' | UserStatus;

type PendingUserAction = {
  kind: 'approve' | 'disable' | 'enable';
  user: UserOut;
};

const FILTER_OPTIONS: SegmentedOption<UserFilter>[] = [
  { value: 'all', label: usersStrings.users.filters.all },
  { value: 'pending', label: usersStrings.users.filters.pending },
  { value: 'active', label: usersStrings.users.filters.active },
  { value: 'disabled', label: usersStrings.users.filters.disabled },
];

function roleTone(role: UserOut['role']): ChipTone {
  return role === 'admin' ? 'level' : 'neutral';
}

function effectiveUserStatus(user: UserOut): UserStatus {
  if (user.status !== undefined) return user.status;
  return user.disabled ? 'disabled' : 'active';
}

function statusChip(status: UserStatus): { tone: ChipTone; label: string } {
  if (status === 'pending') {
    return { tone: 'warning', label: usersStrings.users.pending };
  }
  if (status === 'disabled') {
    return { tone: 'danger', label: usersStrings.users.disabled };
  }
  return { tone: 'success', label: usersStrings.users.active };
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
  const [filter, setFilter] = useState<UserFilter>('all');
  const state = useResource(
    filter === 'all' ? 'admin-users' : `admin-users:${filter}`,
    (signal) =>
      filter === 'all'
        ? api.adminUsers({ signal })
        : api.adminUsersByStatus(filter, { signal }),
  );
  const [pendingAction, setPendingAction] = useState<PendingUserAction | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function open(next: PendingUserAction): void {
    setNotice(null);
    setActionError(null);
    setPendingAction(next);
  }

  function close(): void {
    if (busy) return;
    setPendingAction(null);
    setActionError(null);
  }

  async function confirm(): Promise<void> {
    if (pendingAction === null) return;
    const { kind, user } = pendingAction;
    setBusy(true);
    setNotice(null);
    setActionError(null);
    try {
      if (kind === 'approve') {
        await api.approveUser(user.id);
        setNotice(strings.approvedNotice(user.display_name));
      } else if (kind === 'enable') {
        await api.enableUser(user.id);
        setNotice(strings.enabledNotice(user.display_name));
      } else {
        await api.disableUser(user.id);
        setNotice(strings.disabledNotice(user.display_name));
      }
      setPendingAction(null);
      state.reload();
    } catch (cause) {
      // Un 409 («último admin activo») se muestra tal cual y la lista sigue.
      setActionError(actionMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function dialogTitle(action: PendingUserAction | null): string {
    if (action === null) return '';
    if (action.kind === 'approve') return strings.approveTitle;
    if (action.kind === 'enable') return strings.enableTitle;
    return strings.disableTitle;
  }

  function dialogBody(action: PendingUserAction): string {
    if (action.kind === 'approve') {
      return strings.approveConfirm(action.user.display_name);
    }
    if (action.kind === 'enable') {
      return strings.enableConfirm(action.user.display_name);
    }
    return strings.disableConfirm(action.user.display_name);
  }

  function Users({ users }: { users: UserOut[] }) {
    return (
      <ul className="list">
        {users.map((user) => {
          const status = effectiveUserStatus(user);
          const chip = statusChip(status);
          return (
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
                  {user.auth_provider !== undefined ? (
                    <Chip tone="neutral">
                      {authProviderLabel(user.auth_provider)}
                    </Chip>
                  ) : null}
                  <Chip tone={chip.tone}>{chip.label}</Chip>
                  {status === 'pending' ? (
                    <>
                      <Button
                        variant="primary"
                        onClick={() => open({ kind: 'approve', user })}
                      >
                        {strings.approve(user.display_name)}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => open({ kind: 'disable', user })}
                      >
                        {strings.disable(user.display_name)}
                      </Button>
                    </>
                  ) : status === 'disabled' ? (
                    <Button
                      variant="secondary"
                      onClick={() => open({ kind: 'enable', user })}
                    >
                      {strings.enable(user.display_name)}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => open({ kind: 'disable', user })}
                    >
                      {strings.disable(user.display_name)}
                    </Button>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="stack-lg">
      <AppBar title={strings.title} back={{ to: '/mas', label: 'Más' }} />

      <Segmented
        label={strings.filterLabel}
        options={FILTER_OPTIONS}
        value={filter}
        onChange={setFilter}
      />

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
        open={pendingAction !== null}
        title={dialogTitle(pendingAction)}
        onClose={close}
        actions={
          pendingAction === null ? undefined : (
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
        {pendingAction !== null ? (
          <div className="stack">
            <p>{dialogBody(pendingAction)}</p>
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
