import { useState, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../../api/ApiContext';
import { useResource } from '../../api/useResource';
import { AppBar, Button, Card, Chip, Field, StateView } from '../../components';
import type { CardView } from '../../contracts/generated';
import { CardActions } from '../../manage/CardActions';
import { cardsStrings as s } from '../cardsStrings';

function CardItem({
  card,
  onChanged,
}: {
  card: CardView;
  onChanged: () => void;
}) {
  const personal = card.mine;
  const front = personal?.front_fr ?? card.front_fr;
  const back = personal?.back_es ?? card.back_es;
  const exampleFr = personal?.example_fr ?? card.example_fr;
  const exampleEs = personal?.example_es ?? card.example_es;
  const chips: ReactNode[] = [];

  if (card.owner === 'mine') {
    chips.push(
      <Chip tone="level" key="own">
        {s.own}
      </Chip>,
    );
  }
  if (personal !== null) {
    chips.push(<Chip key="copy">{s.copy}</Chip>);
  }
  if (card.edited_by_human) {
    chips.push(
      <Chip tone="success" key="edited">
        {s.edited}
      </Chip>,
    );
  }
  if (card.source_changed) {
    chips.push(
      <Chip tone="warning" key="changed">
        {s.changed}
      </Chip>,
    );
  }
  if (card.stale) {
    chips.push(
      <Chip tone="warning" key="stale">
        {s.stale}
      </Chip>,
    );
  }
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

  return (
    <Card>
      <div className="stack">
        <div className="row-between wrap">
          <div className="grow">
            <p className="xs muted">{s.kinds[card.kind]}</p>
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

        {card.source_item_ids.length > 0 ? (
          <p className="xs muted">
            {s.source(card.source_item_ids.join(', '))}
          </p>
        ) : null}

        <CardActions card={card} onChanged={onChanged} />
      </div>
    </Card>
  );
}

/** Pantalla de admin para buscar, filtrar y gestionar tarjetas. */
export function AdminCards() {
  const api = useApi();
  const [draftQuery, setDraftQuery] = useState('');
  const [draftItem, setDraftItem] = useState('');
  const [query, setQuery] = useState('');
  const [itemId, setItemId] = useState('');

  const state = useResource(`admin-cards:${query}:${itemId}`, (signal) =>
    api.cards(
      {
        item_id: itemId === '' ? undefined : itemId,
        q: query === '' ? undefined : query,
        limit: 50,
      },
      { signal },
    ),
  );

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextQuery = draftQuery.trim();
    const nextItem = draftItem.trim();
    if (nextQuery === query && nextItem === itemId) {
      state.reload();
      return;
    }
    setQuery(nextQuery);
    setItemId(nextItem);
  }

  function clear(): void {
    const hadFilters = query !== '' || itemId !== '';
    setDraftQuery('');
    setDraftItem('');
    setQuery('');
    setItemId('');
    if (!hadFilters) state.reload();
  }

  return (
    <div className="stack-lg">
      <AppBar title={s.title} back={{ to: '/mas', label: 'Más' }} />
      <p className="small muted">{s.intro}</p>

      <Card>
        <form className="stack" onSubmit={submit}>
          <Field label={s.search}>
            <input
              className="input"
              type="search"
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
            />
          </Field>
          <Field label={s.item}>
            <input
              className="input"
              value={draftItem}
              onChange={(event) => setDraftItem(event.target.value)}
            />
          </Field>
          <div className="row wrap">
            <Button type="submit" variant="secondary" icon="search">
              {s.searchAction}
            </Button>
            <Button variant="ghost" onClick={clear}>
              {s.clear}
            </Button>
          </div>
        </form>
      </Card>

      <StateView
        state={state}
        empty={(page) => page.cards.length === 0}
        emptyText={query !== '' || itemId !== '' ? s.emptyFiltered : s.empty}
        onRetry={state.reload}
      >
        {(page) => (
          <ul className="list" aria-label={s.title}>
            {page.cards.map((card) => (
              <li key={card.id}>
                <CardItem card={card} onChanged={state.reload} />
              </li>
            ))}
          </ul>
        )}
      </StateView>
    </div>
  );
}

export default AdminCards;
