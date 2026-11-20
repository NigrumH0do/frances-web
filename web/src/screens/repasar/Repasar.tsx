import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../api/ApiContext';
import { OfflineError } from '../../api/client';
import { useResource } from '../../api/useResource';
import { AppBar, Button, Icon, Progress, StateView } from '../../components';
import { cx } from '../../components/cx';
import type { CardFlagsIn, CardView } from '../../contracts/generated';
import { common, tr } from '../../l10n/es';
import { messageFor } from '../../l10n/errors';
import { CardActions } from '../../manage/CardActions';
import { useOffline } from '../../offline/OfflineContext';
import { previewIntervals } from '../../review/intervals';
import { currentCard } from '../../review/session';
import { useReviewSession } from '../../review/useReviewSession';
import type { Rating } from '../../srs/types';
import { SafeCardBurstScene } from '../../three/LazyScenes';
import { FlipCard } from './FlipCard';
import { RatingBar } from './RatingBar';
import { ReviewTabs } from './ReviewTabs';
import { remainingLabel, repasarStrings } from './strings';

type Notice =
  | { kind: 'suspend' | 'hard'; cardId: string; text: string }
  | { kind: 'queued'; text: string };

function Summary({
  reviewed,
  again,
  pending,
}: {
  reviewed: number;
  again: number;
  pending: number;
}) {
  return (
    <div className="stack">
      <h2>{repasarStrings.summaryTitle}</h2>
      <div className="stack" role="status">
        <p>{tr(repasarStrings.reviewed, { n: reviewed })}</p>
        <p>{tr(repasarStrings.again, { n: again })}</p>
        {pending > 0 ? (
          <p>{tr(repasarStrings.pending, { n: pending })}</p>
        ) : null}
      </div>
      <Link className="btn btn-secondary" to="/temas">
        {repasarStrings.emptyAction}
      </Link>
    </div>
  );
}

export function Repasar() {
  const api = useApi();
  const session = useReviewSession();
  const { online, pending, enqueue } = useOffline();
  const plan = useResource('plan-today', (signal) => api.planToday({ signal }));

  const [notice, setNotice] = useState<Notice | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [burstCount, setBurstCount] = useState(0);
  const [editedCard, setEditedCard] = useState<CardView | null>(null);
  const [initialIds, setInitialIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [reviewedIds, setReviewedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const planMarked = useRef(false);
  const finishedBurstRef = useRef(false);

  const queue = session.state.queue;
  const total = queue.length;
  const index = session.state.index;
  const current = currentCard(session.state);
  const currentId = current?.id ?? null;
  // Copia recién guardada de la tarjeta actual: se muestra encima de la del
  // mazo sin tocar la sesión (no se recarga la cola ni se reinicia el índice).
  const visibleCard =
    editedCard !== null && editedCard.id === currentId ? editedCard : current;
  const finished = loaded && index >= total;
  const remaining = Math.max(total - index, 0);
  const planData = plan.status === 'ready' ? plan.data : null;
  const resourceData =
    session.resource.status === 'ready' ? session.resource.data : null;
  const queueStale =
    session.resource.status === 'ready' && session.resource.stale;
  const allInitialReviewed =
    initialIds.size > 0 && [...initialIds].every((id) => reviewedIds.has(id));
  const progress = tr(repasarStrings.progress, {
    i: Math.min(index + 1, total),
    total,
  });

  useEffect(() => {
    if (resourceData === null) return;
    setLoaded(resourceData.length > 0);
    if (resourceData.length === 0) return;
    // Los ids iniciales y los ya calificados son de toda la sesión: una
    // recarga online puede devolver una cola más corta (las suspendidas ya no
    // están) y no debe borrar el conjunto con el que empezó el repaso.
    setInitialIds((current) =>
      current.size > 0 ? current : new Set(resourceData.map((card) => card.id)),
    );
  }, [resourceData]);

  const intervals = useMemo(
    () => (current === null ? null : previewIntervals(current, new Date())),
    [current],
  );

  useEffect(() => {
    setEditedCard(null);
  }, [currentId, index]);

  const markPlanDone = useCallback(
    async (day: string, position: number) => {
      try {
        await api.planDone(day, position);
      } catch (error) {
        if (error instanceof OfflineError) {
          await enqueue({ kind: 'plan_done', day, position });
        }
      }
    },
    [api, enqueue],
  );

  // Al terminar la sesión, marca hecha la entrada de repaso del plan una sola
  // vez y solo si se calificó al menos una vez cada tarjeta inicial. «Otra
  // vez» reinserta la tarjeta, así que contar calificaciones no basta.
  useEffect(() => {
    if (
      !finished ||
      !allInitialReviewed ||
      planMarked.current ||
      planData === null
    ) {
      return;
    }
    const entry = planData.entries.find(
      (candidate) => candidate.kind === 'review' && !candidate.done,
    );
    if (entry === undefined) return;
    planMarked.current = true;
    void markPlanDone(planData.day, entry.position);
  }, [allInitialReviewed, finished, markPlanDone, planData]);

  // Refresca solo la tarjeta visible tras editar la copia. No llama a
  // `session.reload()`: eso recargaría la cola y reiniciaría la sesión.
  async function refreshCurrentCard(): Promise<void> {
    if (current === null) return;
    try {
      const fresh = await api.card(current.id);
      setEditedCard(fresh);
    } catch {
      // La mutación ya se guardó; si la recarga falla, la tarjeta visible se
      // conserva y la próxima carga traerá el estado del servidor.
    }
  }

  async function undoNotice() {
    const target = notice;
    if (target === null || target.kind === 'queued') return;
    setNotice(null);
    const body: CardFlagsIn =
      target.kind === 'suspend'
        ? { suspended: false }
        : { flagged_hard: false };
    try {
      await api.cardFlags(target.cardId, body);
    } catch (error) {
      if (error instanceof OfflineError) {
        await enqueue({ kind: 'flags', cardId: target.cardId, body });
        setNotice({
          kind: 'queued',
          text: repasarStrings.undoQueuedOffline,
        });
        return;
      }
    }
    if (!online) {
      setNotice({
        kind: 'queued',
        text: repasarStrings.undoQueuedOffline,
      });
      return;
    }
    if (queueStale) {
      setNotice({
        kind: 'queued',
        text: repasarStrings.undoQueuedStale,
      });
      return;
    }
    session.reload();
  }

  async function suspendCurrent() {
    const selected = currentCard(session.state);
    if (selected === null) return;
    setNotice({
      kind: 'suspend',
      cardId: selected.id,
      text: repasarStrings.suspendedNotice,
    });
    await session.suspend();
  }

  async function markHardCurrent() {
    const selected = currentCard(session.state);
    if (selected === null) return;
    setNotice({
      kind: 'hard',
      cardId: selected.id,
      text: repasarStrings.hardNotice,
    });
    await session.markHard();
  }

  function rateCurrent(rating: Rating) {
    const selected = currentCard(session.state);
    if (selected === null) return;
    setReviewedIds((previous) => {
      const next = new Set(previous);
      next.add(selected.id);
      return next;
    });
    setNotice(null);
    if (rating === 3 || rating === 4) {
      setBurstCount((n) => n + 1);
    }
    void session.grade(rating);
  }

  useEffect(() => {
    if (finished && session.state.done > 0) {
      if (!finishedBurstRef.current) {
        finishedBurstRef.current = true;
        setBurstCount((n) => n + 1);
      }
    } else if (!finished) {
      finishedBurstRef.current = false;
    }
  }, [finished, session.state.done]);

  useEffect(() => {
    if (finished || current === null) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('[contenteditable="true"]') !== null)
      ) {
        return;
      }
      if (document.querySelector('dialog[open], [role="dialog"]') !== null) {
        return;
      }
      if (event.key === 'a' || event.key === 'A') {
        const audioBtn = document.querySelector<HTMLButtonElement>(
          '[data-review] .flip-face:not([aria-hidden="true"]) button',
        );
        if (audioBtn !== null) {
          event.preventDefault();
          audioBtn.click();
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current, finished]);

  return (
    <div className="stack-lg repasar-stage">
      <div className="burst-overlay" aria-hidden="true">
        <SafeCardBurstScene trigger={burstCount} />
      </div>
      <AppBar
        title={repasarStrings.title}
        subtitle={remainingLabel(remaining)}
      />
      <ReviewTabs active="tarjetas" />

      {!online ? (
        <div className="callout" role="status">
          <Icon name="offline" size="sm" />
          <p className="small grow">{repasarStrings.offlineNotice}</p>
        </div>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite">
        {session.announcement ?? ''}
      </p>

      {notice !== null ? (
        <div className="callout" role="status">
          <p className="small grow">{notice.text}</p>
          {notice.kind !== 'queued' ? (
            <Button variant="ghost" onClick={() => void undoNotice()}>
              {repasarStrings.undo}
            </Button>
          ) : null}
        </div>
      ) : null}

      {session.state.error !== null ? (
        <div className="callout error" role="alert">
          <Icon name="alert" size="sm" />
          <p className="small grow">{messageFor(session.state.error)}</p>
          <Button variant="secondary" onClick={session.reload}>
            {common.retry}
          </Button>
        </div>
      ) : null}

      <StateView
        state={session.resource}
        empty={(cards) => cards.length === 0}
        emptyText={repasarStrings.empty}
        emptyAction={
          <Link className="btn btn-secondary" to="/temas">
            {repasarStrings.emptyAction}
          </Link>
        }
        onRetry={session.reload}
      >
        {() =>
          finished ? (
            <Summary
              reviewed={session.state.done}
              again={session.state.again.length}
              pending={pending}
            />
          ) : current !== null && intervals !== null ? (
            <div className="stack">
              <div className="row">
                <Progress value={index + 1} max={total} label={progress} />
                <span className="xs muted">{progress}</span>
              </div>

              <div
                data-review
                className={cx('stack', session.state.flipped && 'answered')}
              >
                <FlipCard
                  card={visibleCard ?? current}
                  flipped={session.state.flipped}
                  onFlip={session.flip}
                />
                {session.state.flipped ? (
                  <RatingBar intervals={intervals} onRate={rateCurrent} />
                ) : null}
              </div>

              {visibleCard !== null ? (
                <CardActions
                  card={visibleCard}
                  onChanged={() => void refreshCurrentCard()}
                  showAdmin={false}
                  showListen={false}
                />
              ) : null}

              <div className="row wrap">
                <Button variant="ghost" onClick={() => void suspendCurrent()}>
                  {repasarStrings.suspend}
                </Button>
                <Button variant="ghost" onClick={() => void markHardCurrent()}>
                  {repasarStrings.markHard}
                </Button>
              </div>
              <p className="kbd-hint">{repasarStrings.kbdHint}</p>
            </div>
          ) : null
        }
      </StateView>
    </div>
  );
}

export default Repasar;
