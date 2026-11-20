import { useState, type FormEvent } from 'react';
import { useApi } from '../../api/ApiContext';
import { HttpError, toUiError } from '../../api/client';
import { useResource } from '../../api/useResource';
import {
  AppBar,
  Button,
  Card,
  Chip,
  Dialog,
  Field,
  Segmented,
  StateView,
} from '../../components';
import type { ChipTone, SegmentedOption } from '../../components';
import type { InviteOut } from '../../contracts/generated';
import { formatShort } from '../../i18n/dates';
import { messageFor } from '../../l10n/errors';
import {
  inviteState,
  inviteStateLabel,
  roleLabel,
  usersStrings,
  type InviteState,
  type Role,
} from '../usersStrings';

type TtlChoice = '24' | '72' | '168';

const TTL_HOURS: Record<TtlChoice, number> = {
  '24': 24,
  '72': 72,
  '168': 168,
};

const TTL_OPTIONS: SegmentedOption<TtlChoice>[] = [
  { value: '24', label: usersStrings.invites.ttl24 },
  { value: '72', label: usersStrings.invites.ttl72 },
  { value: '168', label: usersStrings.invites.ttl168 },
];

const ROLE_OPTIONS: SegmentedOption<Role>[] = [
  { value: 'user', label: roleLabel('user') },
  { value: 'admin', label: roleLabel('admin') },
];

function statusTone(state: InviteState): ChipTone {
  if (state === 'revoked') return 'danger';
  if (state === 'expired') return 'warning';
  if (state === 'active') return 'success';
  return 'neutral';
}

function actionMessage(cause: unknown): string {
  if (cause instanceof HttpError && cause.messageEs !== '') {
    return cause.messageEs;
  }
  return messageFor(toUiError(cause));
}

export function AdminInvites() {
  const api = useApi();
  const strings = usersStrings.invites;
  const state = useResource('admin-invites', (signal) =>
    api.adminInvites({ signal }),
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [role, setRole] = useState<Role>('user');
  const [note, setNote] = useState('');
  const [ttl, setTtl] = useState<TtlChoice>('24');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<InviteOut | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function openCreate(): void {
    setNotice(null);
    setCreateError(null);
    setRole('user');
    setNote('');
    setTtl('24');
    setCreateOpen(true);
  }

  function closeCreate(): void {
    if (creating) return;
    setCreateOpen(false);
    setCreateError(null);
  }

  async function submitCreate(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    setNotice(null);
    try {
      const created = await api.createInvite({
        role,
        note: note.trim() === '' ? null : note.trim(),
        ttl_hours: TTL_HOURS[ttl],
      });
      setCreateOpen(false);
      setRole('user');
      setNote('');
      setTtl('24');
      setCopyNotice(null);
      // El enlace vive solo en este estado y en el input de solo lectura.
      setCreatedUrl(created.url);
      state.reload();
    } catch (cause) {
      setCreateError(actionMessage(cause));
    } finally {
      setCreating(false);
    }
  }

  function closeLink(): void {
    // Al cerrar se borra el enlace: no se puede volver a mostrar.
    setCreatedUrl(null);
    setCopyNotice(null);
  }

  async function copyLink(): Promise<void> {
    if (createdUrl === null) return;
    if (typeof navigator.clipboard?.writeText !== 'function') {
      setCopyNotice(strings.copyError);
      return;
    }
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopyNotice(strings.copied);
    } catch {
      setCopyNotice(strings.copyError);
    }
  }

  function openRevoke(invite: InviteOut): void {
    setNotice(null);
    setRevokeError(null);
    setPendingRevoke(invite);
  }

  function closeRevoke(): void {
    if (revoking) return;
    setPendingRevoke(null);
    setRevokeError(null);
  }

  async function confirmRevoke(): Promise<void> {
    if (pendingRevoke === null) return;
    const invite = pendingRevoke;
    setRevoking(true);
    setRevokeError(null);
    setNotice(null);
    try {
      await api.revokeInvite(invite.id);
      setPendingRevoke(null);
      setNotice(strings.revokedNotice);
      state.reload();
    } catch (cause) {
      setRevokeError(actionMessage(cause));
    } finally {
      setRevoking(false);
    }
  }

  function Invites({ invites }: { invites: InviteOut[] }) {
    return (
      <ul className="list">
        {invites.map((invite) => {
          const status = inviteState(invite);
          return (
            <li key={invite.id}>
              <div className="list-item">
                <span className="grow">
                  <span className="title">{invite.note ?? strings.noNote}</span>
                  <br />
                  <span className="meta">
                    {`${roleLabel(invite.role)} · ${strings.expires(
                      formatShort(invite.expires_at),
                    )}`}
                  </span>
                </span>
                <span className="row wrap">
                  <Chip tone={statusTone(status)}>
                    {inviteStateLabel(status)}
                  </Chip>
                  {status === 'active' ? (
                    <Button variant="danger" onClick={() => openRevoke(invite)}>
                      {strings.revoke}
                    </Button>
                  ) : null}
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

      {notice !== null ? (
        <p className="callout info" role="status">
          {notice}
        </p>
      ) : null}

      <Card>
        <div className="row">
          <Button variant="primary" onClick={openCreate}>
            {strings.create}
          </Button>
        </div>
      </Card>

      <StateView
        state={state}
        empty={(invites) => invites.length === 0}
        emptyText={strings.empty}
        onRetry={state.reload}
      >
        {(invites) => <Invites invites={invites} />}
      </StateView>

      <Dialog
        open={createOpen}
        title={strings.createTitle}
        onClose={closeCreate}
      >
        {createOpen ? (
          <form
            className="stack"
            onSubmit={(event) => void submitCreate(event)}
          >
            <p className="small muted">{strings.role}</p>
            <Segmented
              label={strings.role}
              options={ROLE_OPTIONS}
              value={role}
              onChange={setRole}
            />

            <Field label={strings.note} hint={strings.noteHint}>
              <textarea
                className="textarea"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>

            <p className="small muted">{strings.ttl}</p>
            <Segmented
              label={strings.ttl}
              options={TTL_OPTIONS}
              value={ttl}
              onChange={setTtl}
            />

            {createError !== null ? (
              <p className="callout error" role="alert">
                {createError}
              </p>
            ) : null}

            <div className="row">
              <Button variant="ghost" onClick={closeCreate}>
                {usersStrings.cancel}
              </Button>
              <Button type="submit" variant="primary" busy={creating}>
                {strings.createSubmit}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={createdUrl !== null}
        title={strings.linkTitle}
        onClose={closeLink}
        actions={
          <Button variant="primary" onClick={closeLink}>
            {strings.close}
          </Button>
        }
      >
        {createdUrl !== null ? (
          <div className="stack">
            <p className="callout info" role="status">
              {strings.linkOnce}
            </p>
            <Field label={strings.linkLabel}>
              <input
                className="input"
                type="text"
                readOnly
                value={createdUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
            </Field>
            <div className="row">
              <Button variant="secondary" onClick={() => void copyLink()}>
                {strings.copy}
              </Button>
            </div>
            {copyNotice !== null ? (
              <p className="small" role="status">
                {copyNotice}
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={pendingRevoke !== null}
        title={strings.revokeTitle}
        onClose={closeRevoke}
        actions={
          pendingRevoke === null ? undefined : (
            <>
              <Button variant="ghost" onClick={closeRevoke}>
                {usersStrings.cancel}
              </Button>
              <Button
                variant="danger"
                busy={revoking}
                onClick={() => void confirmRevoke()}
              >
                {usersStrings.confirm}
              </Button>
            </>
          )
        }
      >
        {pendingRevoke !== null ? (
          <div className="stack">
            <p>{strings.revokeConfirm}</p>
            {revokeError !== null ? (
              <p className="callout error" role="alert">
                {revokeError}
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

export default AdminInvites;
