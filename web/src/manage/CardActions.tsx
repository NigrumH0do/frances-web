import { useState } from 'react';
import { useApi } from '../api/ApiContext';
import { toUiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, Dialog } from '../components';
import type { CardView } from '../contracts/generated';
import { messageFor } from '../l10n/errors';
import { CardAudio } from '../media/CardAudio';
import { blankToNull, CardEditor, type CardEditorValues } from './CardEditor';
import { manageStrings as s } from './strings';

type EditMode = 'override' | 'admin';
type DeleteMode = 'own' | 'shared';

function cacheKeyFromUrl(url: string): string | null {
  const key = url.split('/').filter(Boolean).at(-1);
  return key === undefined || key === '' ? null : key;
}

function hasFrontAudio(card: CardView): boolean {
  return (
    card.audio.some((clip) => clip.field === 'front') ||
    card.audio_pending.some((pending) => pending.field === 'front')
  );
}

/**
 * Acciones de una tarjeta. Las de admin dependen del rol que devuelve la API
 * (`Me.user.role`), nunca de un dato local. Un usuario normal solo puede
 * editar su copia de una compartida y borrar sus propias tarjetas.
 *
 * `showAdmin` permite ocultar las acciones de admin en pantallas donde no
 * deben mezclarse con la tarea principal (Repasar, CHG-20).
 */
export function CardActions({
  card,
  onChanged,
  showAdmin = true,
  showListen = true,
}: {
  card: CardView;
  onChanged?: () => void;
  showAdmin?: boolean;
  // `false` donde la pantalla ya pinta el audio de la tarjeta (repaso y
  // listas de tarjetas): así no hay dos reproductores para el mismo clip.
  showListen?: boolean;
}) {
  const api = useApi();
  const { user } = useAuth();
  const isAdmin = showAdmin && user?.role === 'admin';
  const [editMode, setEditMode] = useState<EditMode | null>(null);
  const [deleteMode, setDeleteMode] = useState<DeleteMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    message: string;
    retry: () => void;
  } | null>(null);
  const [showAudio, setShowAudio] = useState(false);

  async function run(
    action: () => Promise<unknown>,
    close?: () => void,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      close?.();
      onChanged?.();
    } catch (cause) {
      setError({
        message: messageFor(toUiError(cause)),
        retry: () => {
          void run(action, close);
        },
      });
    } finally {
      setBusy(false);
    }
  }

  async function save(values: CardEditorValues): Promise<void> {
    const body = {
      front_fr: values.front_fr,
      back_es: values.back_es,
      example_fr: blankToNull(values.example_fr),
      example_es: blankToNull(values.example_es),
      notes: blankToNull(values.notes),
    };
    if (editMode === 'admin') {
      await api.adminUpdateCard(card.id, body);
    } else {
      await api.saveMyCard(card.id, body);
    }
    setEditMode(null);
    setError(null);
    onChanged?.();
  }

  function confirmDelete(): void {
    if (deleteMode === 'shared') {
      void run(
        () => api.adminDeleteCard(card.id),
        () => setDeleteMode(null),
      );
    } else if (deleteMode === 'own') {
      void run(
        () => api.deleteCard(card.id),
        () => setDeleteMode(null),
      );
    }
  }

  function errorCallout() {
    if (error === null) return null;
    return (
      <div className="callout error" role="alert">
        <p className="small grow">{error.message}</p>
        <Button variant="secondary" onClick={error.retry}>
          {s.actions.retry}
        </Button>
      </div>
    );
  }

  const sourceItemId = card.source_item_ids[0];
  // `CardView` no expone la base compartida: si el admin tiene copia personal,
  // los campos de primer nivel ya traen la copia. Editar la compartida desde
  // ahí pisaría la base, así que la acción no se ofrece hasta restaurar la copia.
  const canEditShared =
    isAdmin && card.owner === 'shared' && card.mine === null;
  const audioClips = card.audio
    .map((clip) => ({ clip, cacheKey: cacheKeyFromUrl(clip.url) }))
    .filter(
      (
        item,
      ): item is {
        clip: CardView['audio'][number];
        cacheKey: string;
      } => item.cacheKey !== null,
    );

  return (
    <div className="stack">
      <div className="row wrap">
        {card.owner === 'shared' ? (
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              setEditMode('override');
            }}
          >
            {s.actions.editMine}
          </Button>
        ) : null}

        {card.mine !== null ? (
          <Button
            variant="ghost"
            onClick={() => void run(() => api.deleteMyCard(card.id))}
          >
            {s.actions.restore}
          </Button>
        ) : null}

        {card.owner === 'mine' ? (
          <Button
            variant="danger"
            onClick={() => {
              setError(null);
              setDeleteMode('own');
            }}
          >
            {s.actions.deleteOwn}
          </Button>
        ) : null}

        {canEditShared ? (
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              setEditMode('admin');
            }}
          >
            {s.actions.editShared}
          </Button>
        ) : null}

        {isAdmin && card.owner === 'shared' ? (
          <Button
            variant="danger"
            onClick={() => {
              setError(null);
              setDeleteMode('shared');
            }}
          >
            {s.actions.deleteShared}
          </Button>
        ) : null}

        {isAdmin && sourceItemId !== undefined ? (
          <Button
            variant="ghost"
            onClick={() => void run(() => api.regenerateItem(sourceItemId))}
          >
            {s.actions.regenerateItem}
          </Button>
        ) : null}
      </div>

      {isAdmin && card.owner === 'shared' && card.mine !== null ? (
        <p className="callout info" role="status">
          {s.actions.adminCopyNotice}
        </p>
      ) : null}

      {(showListen && hasFrontAudio(card)) ||
      (isAdmin && audioClips.length > 0) ? (
        <div className="row wrap">
          {!showListen ? null : showAudio && hasFrontAudio(card) ? (
            <div className="stack grow">
              <span className="xs muted">{s.actions.listen}</span>
              <CardAudio card={card} field="front" />
            </div>
          ) : (
            hasFrontAudio(card) && (
              <Button
                variant="secondary"
                icon="play"
                onClick={() => setShowAudio(true)}
              >
                {s.actions.listen}
              </Button>
            )
          )}
          {audioClips.map(({ clip, cacheKey }) =>
            isAdmin ? (
              <Button
                key={`${clip.field}:${clip.voice_id}:${cacheKey}`}
                variant="ghost"
                title={s.actions.audioFor(clip.field, clip.voice_id)}
                onClick={() => void run(() => api.regenerateAudio(cacheKey))}
              >
                {s.actions.regenerateAudio}
              </Button>
            ) : null,
          )}
        </div>
      ) : null}

      {deleteMode === null ? errorCallout() : null}

      <Dialog
        open={editMode !== null}
        title={
          editMode === 'admin' ? s.editor.titleAdmin : s.editor.titleOverride
        }
        onClose={() => setEditMode(null)}
      >
        {editMode !== null ? (
          <CardEditor
            key={editMode}
            mode={editMode}
            card={card}
            onSave={save}
            onCancel={() => setEditMode(null)}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={deleteMode !== null}
        title={
          deleteMode === 'shared'
            ? s.actions.deleteSharedTitle
            : s.actions.deleteOwnTitle
        }
        onClose={() => {
          if (!busy) setDeleteMode(null);
        }}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleteMode(null)}>
              {s.actions.cancel}
            </Button>
            <Button variant="danger" busy={busy} onClick={confirmDelete}>
              {s.actions.confirm}
            </Button>
          </>
        }
      >
        <p>
          {deleteMode === 'shared'
            ? s.actions.deleteSharedBody
            : s.actions.deleteOwnBody}
        </p>
        {deleteMode === null ? null : errorCallout()}
      </Dialog>
    </div>
  );
}

export default CardActions;
