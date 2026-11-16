import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../api/ApiContext';
import { useResource } from '../../api/useResource';
import { Button, Card, Chip, StateView } from '../../components';
import type { CardView } from '../../contracts/generated';
import { common } from '../../l10n/es';
import { CardActions } from '../../manage/CardActions';
import { NewCardDialog } from '../../manage/NewCardDialog';
import { manageStrings } from '../../manage/strings';
import { CardAudio } from '../../media/CardAudio';
import { temaStrings as s } from './strings';

type MoreState = 'idle' | 'loading' | 'error';

function hasAudio(card: CardView, field: 'front' | 'example'): boolean {
  return (
    card.audio.some((clip) => clip.field === field) ||
    card.audio_pending.some((pending) => pending.field === field)
  );
}

function CardRow({
  card,
  onChanged,
}: {
  card: CardView;
  onChanged: () => void;
}): JSX.Element {
  const front = card.mine?.front_fr ?? card.front_fr;
  const back = card.mine?.back_es ?? card.back_es;
  const exampleFr = card.mine?.example_fr ?? card.example_fr;
  const exampleEs = card.mine?.example_es ?? card.example_es;
  const chips: ReactNode[] = [];

  if (card.state?.flagged_hard === true) {
    chips.push(
      <Chip tone="danger" key="hard">
        {s.hard}
      </Chip>,
    );
  }
  if (card.state?.suspended === true) {
    chips.push(<Chip key="suspended">{s.suspended}</Chip>);
  }
  if (card.source_changed) {
    chips.push(
      <Chip tone="warning" key="changed">
        {s.changed}
      </Chip>,
    );
  }

  return (
    <Card>
      <div className="stack">
        <div className="row-between wrap">
          <div className="grow">
            <p className="xs muted">{s.cardKinds[card.kind]}</p>
            <h3 className="fr" lang="fr">
              {front}
            </h3>
            <p className="meta">{back}</p>
          </div>
          {chips.length > 0 ? <div className="row wrap">{chips}</div> : null}
        </div>
        {exampleFr !== null ? (
          <p className="small">
            <span className="fr" lang="fr">
              {exampleFr}
            </span>
            {exampleEs !== null ? <> — {exampleEs}</> : null}
          </p>
        ) : null}
        {hasAudio(card, 'front') ? (
          <CardAudio card={card} field="front" />
        ) : null}
        <CardActions card={card} onChanged={onChanged} showListen={false} />
      </div>
    </Card>
  );
}

// Tarjetas del tema con paginación por cursor. «Cargar más» pide la página
// siguiente y la agrega; «Repasar» lleva a la sesión de repaso.
export function TopicCards({ topicId }: { topicId: string }): JSX.Element {
  const api = useApi();
  const first = useResource(`topic-cards:${topicId}`, (signal) =>
    api.topicCards(topicId, undefined, { signal }),
  );
  const [extra, setExtra] = useState<CardView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [moreState, setMoreState] = useState<MoreState>('idle');
  const [newCardOpen, setNewCardOpen] = useState(false);
  const moreController = useRef<AbortController | null>(null);

  const nextCursor = first.status === 'ready' ? first.data.next_cursor : null;

  useEffect(() => {
    if (first.status === 'ready') setCursor(first.data.next_cursor);
  }, [first.status, nextCursor]);

  useEffect(() => {
    return () => {
      moreController.current?.abort();
    };
  }, []);

  const cards = first.status === 'ready' ? [...first.data.cards, ...extra] : [];

  function reload(): void {
    setExtra([]);
    setCursor(null);
    setMoreState('idle');
    first.reload();
  }

  async function loadMore(): Promise<void> {
    if (cursor === null || moreState === 'loading') return;
    const controller = new AbortController();
    moreController.current?.abort();
    moreController.current = controller;
    setMoreState('loading');
    try {
      const page = await api.topicCards(
        topicId,
        { cursor },
        {
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      setExtra((current) => [...current, ...page.cards]);
      setCursor(page.next_cursor);
      setMoreState('idle');
    } catch {
      if (!controller.signal.aborted) setMoreState('error');
    }
  }

  return (
    <StateView
      state={first}
      empty={(page) => page.cards.length === 0 && page.next_cursor === null}
      emptyText={s.cardsEmpty}
      onRetry={reload}
    >
      {() => (
        <div className="stack">
          <div className="row wrap">
            <Button variant="secondary" onClick={() => setNewCardOpen(true)}>
              {manageStrings.editor.titleOwn}
            </Button>
          </div>

          <ul className="list" aria-label={s.cards}>
            {cards.map((card) => (
              <li key={card.id}>
                <CardRow card={card} onChanged={reload} />
              </li>
            ))}
          </ul>

          <div className="row wrap">
            <Link className="btn btn-secondary" to="/repasar">
              {s.review}
            </Link>
            {cursor !== null ? (
              <Button
                variant="ghost"
                busy={moreState === 'loading'}
                onClick={() => void loadMore()}
              >
                {moreState === 'loading' ? s.loadingMore : s.loadMore}
              </Button>
            ) : null}
          </div>

          {moreState === 'error' ? (
            <div className="callout error" role="alert">
              <p className="small grow">{s.moreError}</p>
              <Button variant="secondary" onClick={() => void loadMore()}>
                {common.retry}
              </Button>
            </div>
          ) : null}

          <NewCardDialog
            open={newCardOpen}
            onClose={() => setNewCardOpen(false)}
            onCreated={reload}
          />
        </div>
      )}
    </StateView>
  );
}

export default TopicCards;
