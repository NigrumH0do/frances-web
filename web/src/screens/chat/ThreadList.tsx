import { useState, type JSX } from 'react';
import { Link } from 'react-router';
import { Button, Dialog, Icon, IconButton } from '../../components';
import type { ChatThreadOut } from '../../contracts/generated';
import { formatShort } from '../../i18n/dates';
import { common, tr } from '../../l10n/es';
import { chatStrings } from './strings';

/**
 * Hilos del usuario, del más reciente al más antiguo. «Nueva conversación»
 * crea uno y borrar exige confirmación antes del DELETE.
 */
export function ThreadList({
  threads,
  activeId,
  busy = false,
  onNew,
  onDelete,
}: {
  threads: ChatThreadOut[];
  activeId?: string;
  busy?: boolean;
  onNew: () => void;
  onDelete: (threadId: string) => Promise<void> | void;
}): JSX.Element {
  const [pendingDelete, setPendingDelete] = useState<ChatThreadOut | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const sorted = [...threads].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  );

  async function confirmDelete(): Promise<void> {
    if (pendingDelete === null) return;
    setDeleting(true);
    try {
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
    } catch {
      // El chat muestra el aviso de error y deja el diálogo abierto.
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="stack" aria-label={chatStrings.conversations}>
      <div className="section-title">
        <h2>{chatStrings.conversations}</h2>
        <Button variant="secondary" icon="chat" onClick={onNew} disabled={busy}>
          {chatStrings.newThread}
        </Button>
      </div>

      {sorted.length > 0 ? (
        <ul className="list">
          {sorted.map((thread) => (
            <li key={thread.id} className="row">
              <Link
                to={`/chat/${encodeURIComponent(thread.id)}`}
                className="list-item grow"
                aria-current={thread.id === activeId ? 'page' : undefined}
              >
                <span className="lead-icon">
                  <Icon name="chat" />
                </span>
                <span className="grow">
                  <span className="title">{thread.title}</span>
                  <br />
                  <span className="meta">{formatShort(thread.updated_at)}</span>
                </span>
              </Link>
              <IconButton
                label={tr(chatStrings.deleteThreadLabel, {
                  title: thread.title,
                })}
                icon="x"
                variant="ghost"
                onClick={() => setPendingDelete(thread)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog
        open={pendingDelete !== null}
        title={chatStrings.deleteThreadTitle}
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              {common.cancel}
            </Button>
            <Button
              variant="danger"
              busy={deleting}
              onClick={() => void confirmDelete()}
            >
              {chatStrings.deleteThread}
            </Button>
          </>
        }
      >
        <p className="small">{chatStrings.deleteThreadBody}</p>
      </Dialog>
    </section>
  );
}
