import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/ApiContext';
import { toUiError } from '../../api/client';
import { useResource } from '../../api/useResource';
import {
  AppBar,
  Button,
  Card,
  Chip,
  Dialog,
  Field,
  StateView,
} from '../../components';
import type { UiError } from '../../components';
import type {
  ItemPage,
  StudyTopic,
  TopicItemsIn,
  TopicSplitIn,
  TopicsMergeIn,
} from '../../contracts/generated';
import { messageFor } from '../../l10n/errors';
import { topicsStrings as s } from '../topicsStrings';

type Api = ReturnType<typeof useApi>;
type ItemTitles = Map<string, string>;
type DestructiveStep = 'form' | 'confirm';

// Límite del contrato `TopicsMergeIn.topic_ids` (mínimo 2, máximo 20).
const MAX_MERGE_TOPICS = 20;

type TopicDialog =
  | { kind: 'rename'; topic: StudyTopic; title: string; description: string }
  | {
      kind: 'merge';
      topics: StudyTopic[];
      title: string;
      step: DestructiveStep;
    }
  | {
      kind: 'split';
      topic: StudyTopic;
      title: string;
      selected: string[];
      step: DestructiveStep;
    }
  | {
      kind: 'move';
      topic: StudyTopic;
      selected: string[];
      destination: string;
      step: DestructiveStep;
    };

type DestructiveDialog = Extract<TopicDialog, { kind: 'split' | 'move' }>;
type ConfirmDialog = Extract<TopicDialog, { kind: 'merge' | 'split' | 'move' }>;

// El `message_es` del servidor manda; solo si no viene se usa el texto genérico.
function displayError(error: UiError): string {
  if (error.kind === 'http' && error.message !== '') return error.message;
  return messageFor(error);
}

function displayCause(cause: unknown): string {
  return displayError(toUiError(cause));
}

async function loadItemTitles(
  api: Api,
  courseId: string,
  signal: AbortSignal,
): Promise<ItemTitles> {
  const titles: ItemTitles = new Map();
  let cursor: string | undefined;
  do {
    const page: ItemPage = await api.items(
      { course_id: courseId, cursor, limit: 200 },
      { signal },
    );
    for (const entry of page.items) {
      titles.set(entry.id, entry.title ?? s.untitled);
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return titles;
}

export function AdminTopics() {
  const api = useApi();
  const [chosenCourseId, setChosenCourseId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dialog, setDialog] = useState<TopicDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const coursesState = useResource('admin-topics-courses', (signal) =>
    api.courses({ signal }),
  );
  const courses = coursesState.status === 'ready' ? coursesState.data : [];
  const courseId =
    chosenCourseId !== null && courses.some((c) => c.id === chosenCourseId)
      ? chosenCourseId
      : (courses[0]?.id ?? null);

  const topicsState = useResource(
    courseId === null ? null : `admin-topics:${courseId}`,
    async (signal) => {
      if (courseId === null) throw new Error('No hay curso seleccionado');
      return api.topics(courseId, { signal });
    },
  );

  const itemsState = useResource(
    courseId === null ? null : `admin-topics-items:${courseId}`,
    async (signal) => {
      if (courseId === null) throw new Error('No hay curso seleccionado');
      return loadItemTitles(api, courseId, signal);
    },
  );

  const editingId =
    dialog !== null && (dialog.kind === 'split' || dialog.kind === 'move')
      ? dialog.topic.id
      : null;
  const detailState = useResource(
    editingId === null ? null : `admin-topic:${editingId}`,
    async (signal) => {
      if (editingId === null) throw new Error('No hay tema seleccionado');
      return api.topic(editingId, { signal });
    },
  );

  function updateDialog(change: (current: TopicDialog) => TopicDialog): void {
    setActionError(null);
    setDialog((current) => (current === null ? null : change(current)));
  }

  function close(): void {
    if (busy) return;
    setDialog(null);
    setActionError(null);
  }

  function toggleSelected(topicId: string, checked: boolean): void {
    setNotice(null);
    setActionError(null);
    if (
      checked &&
      !selectedIds.includes(topicId) &&
      selectedIds.length >= MAX_MERGE_TOPICS
    ) {
      setActionError(s.mergeTooMany);
      return;
    }
    setSelectedIds((current) =>
      checked
        ? [...current.filter((id) => id !== topicId), topicId]
        : current.filter((id) => id !== topicId),
    );
  }

  function toggleItem(itemId: string, checked: boolean): void {
    setActionError(null);
    updateDialog((current) => {
      if (current.kind !== 'split' && current.kind !== 'move') return current;
      return {
        ...current,
        selected: checked
          ? [...current.selected.filter((id) => id !== itemId), itemId]
          : current.selected.filter((id) => id !== itemId),
      };
    });
  }

  function openRename(topic: StudyTopic): void {
    setNotice(null);
    setActionError(null);
    setDialog({
      kind: 'rename',
      topic,
      title: topic.title,
      description: topic.description_es,
    });
  }

  function openMerge(): void {
    setNotice(null);
    setActionError(null);
    if (topicsState.status !== 'ready') return;
    const chosen = topicsState.data.filter((topic) =>
      selectedIds.includes(topic.id),
    );
    if (chosen.length < 2) {
      setActionError(s.mergeNeedTwo);
      return;
    }
    setDialog({ kind: 'merge', topics: chosen, title: '', step: 'form' });
  }

  function openSplit(topic: StudyTopic): void {
    setNotice(null);
    setActionError(null);
    setDialog({ kind: 'split', topic, title: '', selected: [], step: 'form' });
  }

  function openMove(topic: StudyTopic): void {
    setNotice(null);
    setActionError(null);
    setDialog({
      kind: 'move',
      topic,
      selected: [],
      destination: '',
      step: 'form',
    });
  }

  function nextStep(): void {
    if (dialog === null || dialog.kind === 'rename') return;
    setActionError(null);
    if (dialog.kind === 'merge') {
      if (dialog.title.trim() === '') {
        setActionError(s.needTitle);
        return;
      }
      setDialog({ ...dialog, step: 'confirm' });
      return;
    }
    if (dialog.kind === 'split') {
      if (dialog.title.trim() === '') {
        setActionError(s.needTitle);
        return;
      }
      if (dialog.selected.length === 0) {
        setActionError(s.splitNeedItem);
        return;
      }
      const total =
        detailState.status === 'ready' ? detailState.data.item_ids.length : 0;
      if (dialog.selected.length >= total) {
        setActionError(s.splitNeedRemainder);
        return;
      }
      setDialog({ ...dialog, step: 'confirm' });
      return;
    }
    if (dialog.selected.length === 0) {
      setActionError(s.moveNeedItem);
      return;
    }
    if (dialog.destination === '') {
      setActionError(s.moveNeedDestination);
      return;
    }
    setDialog({ ...dialog, step: 'confirm' });
  }

  async function saveRename(
    current: Extract<TopicDialog, { kind: 'rename' }>,
  ): Promise<void> {
    if (current.title.trim() === '') {
      setActionError(s.needTitle);
      return;
    }
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await api.updateTopic(current.topic.id, {
        title: current.title,
        description_es: current.description,
      });
      setDialog(null);
      setNotice(s.renamed);
      topicsState.reload();
    } catch (cause) {
      setActionError(displayCause(cause));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDestructive(): Promise<void> {
    if (
      dialog === null ||
      dialog.kind === 'rename' ||
      dialog.step !== 'confirm'
    ) {
      return;
    }
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      if (dialog.kind === 'merge') {
        await api.mergeTopics({
          topic_ids: dialog.topics.map(
            (topic) => topic.id,
          ) as TopicsMergeIn['topic_ids'],
          title: dialog.title,
        });
        setSelectedIds([]);
        setNotice(s.merged);
      } else if (dialog.kind === 'split') {
        await api.splitTopic(dialog.topic.id, {
          item_ids: dialog.selected as TopicSplitIn['item_ids'],
          title: dialog.title,
        });
        setNotice(s.splitDone);
      } else {
        await api.moveTopicItems(dialog.destination, {
          item_ids: dialog.selected as TopicItemsIn['item_ids'],
        });
        setNotice(s.moved);
      }
      setDialog(null);
      topicsState.reload();
    } catch (cause) {
      setActionError(displayCause(cause));
    } finally {
      setBusy(false);
    }
  }

  function confirmText(current: ConfirmDialog): string {
    if (current.kind === 'merge') {
      return s.mergeConfirm(current.topics.length, current.title);
    }
    if (current.kind === 'split') {
      return s.splitConfirm(current.topic.title, current.title);
    }
    const target =
      topicsState.status === 'ready'
        ? (topicsState.data.find((topic) => topic.id === current.destination)
            ?.title ?? s.destinationPlaceholder)
        : s.destinationPlaceholder;
    return s.moveConfirm(current.selected.length, target);
  }

  function renderItemPicker(current: DestructiveDialog): ReactNode {
    if (detailState.status === 'loading' || itemsState.status === 'loading') {
      return (
        <p className="small muted" role="status">
          {s.detailLoading}
        </p>
      );
    }
    if (detailState.status === 'error') {
      return (
        <div className="callout error" role="alert">
          <p className="small grow">{displayError(detailState.error)}</p>
          <Button
            variant="secondary"
            onClick={() => {
              detailState.reload();
              itemsState.reload();
            }}
          >
            {s.retry}
          </Button>
        </div>
      );
    }
    if (itemsState.status === 'error') {
      return (
        <div className="callout error" role="alert">
          <p className="small grow">{displayError(itemsState.error)}</p>
          <Button
            variant="secondary"
            onClick={() => {
              detailState.reload();
              itemsState.reload();
            }}
          >
            {s.retry}
          </Button>
        </div>
      );
    }
    if (detailState.status !== 'ready' || itemsState.status !== 'ready') {
      return null;
    }

    const itemIds = detailState.data.item_ids;
    if (itemIds.length === 0) {
      return <p className="small muted">{s.noItems}</p>;
    }

    return (
      <fieldset className="stack">
        <legend>
          {current.kind === 'split' ? s.splitItemsLabel : s.moveItemsLabel}
        </legend>
        <ul className="list">
          {itemIds.map((itemId) => {
            const title = itemsState.data.get(itemId) ?? s.untitled;
            return (
              <li key={itemId}>
                <label className="list-item">
                  <input
                    type="checkbox"
                    aria-label={s.includeItem(title)}
                    checked={current.selected.includes(itemId)}
                    onChange={(event) =>
                      toggleItem(itemId, event.target.checked)
                    }
                  />
                  <span className="grow">{title}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    );
  }

  function renderDialogBody(): ReactNode {
    if (dialog === null) return null;
    if (dialog.kind === 'rename') {
      return (
        <div className="stack">
          <Field label={s.titleField}>
            <input
              className="input"
              value={dialog.title}
              onChange={(event) =>
                updateDialog((current) =>
                  current.kind === 'rename'
                    ? { ...current, title: event.target.value }
                    : current,
                )
              }
            />
          </Field>
          <Field label={s.descriptionField}>
            <textarea
              className="textarea"
              value={dialog.description}
              onChange={(event) =>
                updateDialog((current) =>
                  current.kind === 'rename'
                    ? { ...current, description: event.target.value }
                    : current,
                )
              }
            />
          </Field>
          <p className="small muted">{s.editNote}</p>
        </div>
      );
    }

    if (dialog.step === 'confirm') {
      return (
        <div className="stack">
          <p>{confirmText(dialog)}</p>
          <p className="small muted">{s.destructiveNote}</p>
        </div>
      );
    }

    if (dialog.kind === 'merge') {
      return (
        <div className="stack">
          <Field label={s.titleField} hint={s.mergeHint}>
            <input
              className="input"
              value={dialog.title}
              onChange={(event) =>
                updateDialog((current) =>
                  current.kind === 'merge'
                    ? { ...current, title: event.target.value }
                    : current,
                )
              }
            />
          </Field>
          <p className="small muted">{s.editNote}</p>
        </div>
      );
    }

    return (
      <div className="stack">
        {dialog.kind === 'split' ? (
          <Field label={s.splitTitleField}>
            <input
              className="input"
              value={dialog.title}
              onChange={(event) =>
                updateDialog((current) =>
                  current.kind === 'split'
                    ? { ...current, title: event.target.value }
                    : current,
                )
              }
            />
          </Field>
        ) : (
          <Field label={s.destinationField}>
            <select
              className="input"
              value={dialog.destination}
              onChange={(event) =>
                updateDialog((current) =>
                  current.kind === 'move'
                    ? { ...current, destination: event.target.value }
                    : current,
                )
              }
            >
              <option value="">{s.destinationPlaceholder}</option>
              {(topicsState.status === 'ready' ? topicsState.data : [])
                .filter((topic) => topic.id !== dialog.topic.id)
                .map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.title}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {renderItemPicker(dialog)}
        <p className="small muted">{s.editNote}</p>
      </div>
    );
  }

  function renderDialogActions(): ReactNode {
    if (dialog === null) return undefined;
    if (dialog.kind === 'rename') {
      return (
        <>
          <Button variant="ghost" onClick={close}>
            {s.cancel}
          </Button>
          <Button
            variant="primary"
            busy={busy}
            onClick={() => void saveRename(dialog)}
          >
            {s.save}
          </Button>
        </>
      );
    }
    if (dialog.step === 'confirm') {
      return (
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setActionError(null);
              updateDialog((current) =>
                current.kind === 'rename'
                  ? current
                  : { ...current, step: 'form' },
              );
            }}
          >
            {s.back}
          </Button>
          <Button
            variant="primary"
            busy={busy}
            onClick={() => void confirmDestructive()}
          >
            {s.confirm}
          </Button>
        </>
      );
    }
    const waiting =
      dialog.kind !== 'merge' &&
      (detailState.status !== 'ready' || itemsState.status !== 'ready');
    return (
      <>
        <Button variant="ghost" onClick={close}>
          {s.cancel}
        </Button>
        <Button variant="primary" disabled={waiting} onClick={nextStep}>
          {s.continue}
        </Button>
      </>
    );
  }

  const dialogTitle =
    dialog === null
      ? ''
      : dialog.kind === 'rename'
        ? s.renameTitle
        : dialog.kind === 'merge'
          ? s.mergeTitle
          : dialog.kind === 'split'
            ? s.splitTitle
            : s.moveTitle;

  return (
    <div className="stack-lg">
      <div className="stack">
        <AppBar title={s.title} back={{ to: '/mas', label: 'Más' }} />
        <p className="small muted">{s.intro}</p>
      </div>

      {notice !== null ? (
        <p className="callout info" role="status">
          {notice}
        </p>
      ) : null}
      {actionError !== null ? (
        <p className="callout error" role="alert">
          {actionError}
        </p>
      ) : null}

      <StateView
        state={coursesState}
        empty={(list) => list.length === 0}
        emptyText={s.coursesEmpty}
        onRetry={coursesState.reload}
      >
        {() => (
          <div className="stack-lg">
            <Field label={s.courseLabel}>
              <select
                className="input"
                value={courseId ?? ''}
                onChange={(event) => {
                  setChosenCourseId(event.target.value);
                  setSelectedIds([]);
                  setNotice(null);
                  setActionError(null);
                }}
              >
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </Field>

            <Card>
              <div className="row-between">
                <p className="small muted grow">{s.mergeHint}</p>
                <Button variant="primary" onClick={openMerge}>
                  {s.mergeButton}
                </Button>
              </div>
            </Card>

            <StateView
              state={topicsState}
              empty={(topics) => topics.length === 0}
              emptyText={s.empty}
              onRetry={topicsState.reload}
            >
              {(topics) => (
                <ul className="list" aria-label={s.listLabel}>
                  {topics.map((topic) => (
                    <li key={topic.id}>
                      <div className="list-item">
                        <label
                          className="btn btn-ghost btn-icon"
                          title={s.selectTopic(topic.title)}
                        >
                          <input
                            type="checkbox"
                            className={
                              selectedIds.includes(topic.id)
                                ? 'check done'
                                : 'check'
                            }
                            aria-label={s.selectTopic(topic.title)}
                            checked={selectedIds.includes(topic.id)}
                            onChange={(event) =>
                              toggleSelected(topic.id, event.target.checked)
                            }
                          />
                        </label>
                        <div className="grow stack">
                          <div>
                            <span className="title fr" lang="fr">
                              {topic.title}
                            </span>
                            <br />
                            <span className="meta">
                              {s.publications(topic.item_ids.length)} ·{' '}
                              {s.cards(topic.card_count)}
                            </span>
                          </div>
                          <div className="row wrap">
                            {topic.cefr !== null ? (
                              <Chip tone="level">{topic.cefr}</Chip>
                            ) : null}
                            {topic.edited_by_human ? (
                              <Chip tone="success">{s.edited}</Chip>
                            ) : null}
                            {topic.source_changed ? (
                              <Chip tone="warning">{s.sourceChanged}</Chip>
                            ) : null}
                          </div>
                          <div className="row wrap">
                            <Button
                              variant="secondary"
                              onClick={() => openRename(topic)}
                            >
                              {s.renameTopic(topic.title)}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => openSplit(topic)}
                            >
                              {s.splitTopic(topic.title)}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => openMove(topic)}
                            >
                              {s.moveTopic(topic.title)}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </StateView>
          </div>
        )}
      </StateView>

      <Dialog
        open={dialog !== null}
        title={dialogTitle}
        onClose={close}
        actions={renderDialogActions()}
      >
        {renderDialogBody()}
      </Dialog>
    </div>
  );
}

export default AdminTopics;
