import { useState, type JSX, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useApi } from '../../api/ApiContext';
import { useResource } from '../../api/useResource';
import {
  AppBar,
  Button,
  Card,
  Chip,
  Icon,
  IconButton,
  StateView,
} from '../../components';
import type {
  AttachmentView,
  CardPage,
  CardView,
  ItemDetail,
  Quiz,
} from '../../contracts/generated';
import { formatLong } from '../../i18n/dates';
import { tr } from '../../l10n/es';
import { CardActions } from '../../manage/CardActions';
import { NewCardDialog } from '../../manage/NewCardDialog';
import { manageStrings } from '../../manage/strings';
import { AttachmentBlock } from '../../media/AttachmentView';
import { CardAudio } from '../../media/CardAudio';
import { SheetView } from './SheetView';
import { publicacionStrings as s } from './strings';

function pageFromParams(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function isPdf(att: AttachmentView): boolean {
  return (
    att.view_pdf !== null ||
    (att.file !== null && att.file.mime === 'application/pdf')
  );
}

// Un enlace externo solo es seguro si apunta al Classroom de Google por HTTPS.
// Cualquier otro esquema, host, puerto o credenciales se omite.
function classroomLink(raw: string | null): string | null {
  if (raw === null) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.origin !== 'https://classroom.google.com') return null;
  if (url.username !== '' || url.password !== '') return null;
  return raw;
}

function textLangProps(lang: ItemDetail['item']['text_lang']): {
  className?: string;
  lang?: string;
} {
  if (lang === 'fr') return { className: 'fr', lang: 'fr' };
  if (lang === 'es' || lang === 'en') return { lang };
  return {};
}

function hasAudio(card: CardView, field: 'front' | 'example'): boolean {
  return (
    card.audio.some((clip) => clip.field === field) ||
    card.audio_pending.some((pending) => pending.field === field)
  );
}

function CardItem({
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
  if (card.stale) {
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

function QuizItem({ quiz }: { quiz: Quiz }): JSX.Element {
  return (
    <Card>
      <div className="stack">
        <div className="row-between">
          <h3>{quiz.title_es}</h3>
          <Chip>
            {quiz.questions.length === 1
              ? s.quizQuestionsOne
              : tr(s.quizQuestions, { n: quiz.questions.length })}
          </Chip>
        </div>
        {quiz.stale ? <Chip tone="warning">{s.quizStale}</Chip> : null}
        <Link className="btn btn-primary btn-block" to={`/quiz/${quiz.id}`}>
          {s.startQuiz}
        </Link>
      </div>
    </Card>
  );
}

function ItemBody({
  detail,
  cardsState,
  quizzesState,
  onReload,
}: {
  detail: ItemDetail;
  cardsState: ReturnType<typeof useResource<CardPage>>;
  quizzesState: ReturnType<typeof useResource<Quiz[]>>;
  onReload: () => void;
}): JSX.Element {
  const [params] = useSearchParams();
  const [newCardOpen, setNewCardOpen] = useState(false);
  const page = pageFromParams(params.get('pagina'));
  const citedAttachment = params.get('adjunto');
  const firstPdf = detail.attachments.find(isPdf)?.id ?? null;

  function initialPageFor(att: AttachmentView): number | undefined {
    if (page === null) return undefined;
    if (citedAttachment !== null) {
      return att.id === citedAttachment ? page : undefined;
    }
    return att.id === firstPdf ? page : undefined;
  }

  const cards = cardsState.status === 'ready' ? cardsState.data.cards : [];
  const safeLink = classroomLink(detail.alternate_link);
  const langProps = textLangProps(detail.item.text_lang);
  const paragraphs = detail.text
    .split(/\n+/)
    .filter((line) => line.trim() !== '');

  return (
    <div className="stack-lg">
      <div className="stack">
        <div className="row wrap">
          <Chip>{s.kinds[detail.item.kind]}</Chip>
          <span className="small muted">
            {tr(s.published, {
              date: formatLong(detail.item.created_at),
            })}
          </span>
          <span className="small muted">
            {tr(s.updated, {
              date: formatLong(detail.item.updated_at),
            })}
          </span>
        </div>
        {detail.item.due_at !== null ? (
          <p className="small">
            <strong>
              {tr(s.due, { date: formatLong(detail.item.due_at) })}
            </strong>
          </p>
        ) : null}
        {safeLink !== null ? (
          <a
            className="btn btn-secondary"
            href={safeLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="external" size="sm" />
            {s.openClassroom}
          </a>
        ) : null}
      </div>

      {paragraphs.length > 0 ? (
        <section className="stack" aria-label={s.text}>
          <div className="section-title">
            <h2>{s.text}</h2>
          </div>
          <Card>
            <div className="stack">
              {paragraphs.map((paragraph, index) => (
                <p
                  className={langProps.className}
                  lang={langProps.lang}
                  key={`${index}-${paragraph}`}
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </Card>
        </section>
      ) : null}

      {detail.attachments.length > 0 ? (
        <section className="stack" aria-label={s.attachments}>
          <div className="section-title">
            <h2>{s.attachments}</h2>
          </div>
          <div className="stack">
            {detail.attachments.map((att) => (
              <AttachmentBlock
                key={att.id}
                att={att}
                initialPage={initialPageFor(att)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="stack" aria-label={s.sheet}>
        <div className="section-title">
          <h2>{s.sheet}</h2>
        </div>
        {detail.sheet !== null ? (
          <SheetView sheet={detail.sheet} cards={cards} />
        ) : (
          <div className="callout info" role="status">
            <Icon name="alert" size="sm" />
            <div className="grow">
              <p>
                <strong>{s.sheetPendingTitle}</strong>
              </p>
              <p className="small muted">{s.sheetPendingBody}</p>
            </div>
          </div>
        )}
      </section>

      <section className="stack" aria-label={s.cards}>
        <div className="section-title">
          <h2>{s.cards}</h2>
          <div className="row wrap">
            {cardsState.status === 'ready' && cards.length > 0 ? (
              <span className="small muted">
                {cards.length === 1
                  ? s.cardsCountOne
                  : tr(s.cardsCount, { n: cards.length })}
              </span>
            ) : null}
            <Button variant="secondary" onClick={() => setNewCardOpen(true)}>
              {manageStrings.editor.titleOwn}
            </Button>
          </div>
        </div>
        <StateView
          state={cardsState}
          empty={(data) => data.cards.length === 0}
          emptyText={s.cardsEmpty}
          onRetry={cardsState.reload}
        >
          {(data) => (
            <div className="stack">
              {data.cards.map((card) => (
                <CardItem card={card} key={card.id} onChanged={onReload} />
              ))}
            </div>
          )}
        </StateView>
        <NewCardDialog
          open={newCardOpen}
          onClose={() => setNewCardOpen(false)}
          onCreated={onReload}
        />
      </section>

      <section className="stack" aria-label={s.quizzes}>
        <div className="section-title">
          <h2>{s.quizzes}</h2>
        </div>
        <StateView
          state={quizzesState}
          empty={(quizzes) => quizzes.length === 0}
          emptyText={s.quizzesEmpty}
          onRetry={quizzesState.reload}
        >
          {(quizzes) => (
            <div className="stack">
              {quizzes.map((quiz) => (
                <QuizItem quiz={quiz} key={quiz.id} />
              ))}
            </div>
          )}
        </StateView>
      </section>
    </div>
  );
}

export default function Publicacion(): JSX.Element {
  const { itemId = '' } = useParams();
  const api = useApi();
  const itemState = useResource(
    itemId === '' ? null : `item:${itemId}`,
    (signal) => api.item(itemId, { signal }),
  );
  const cardsState = useResource(
    itemId === '' ? null : `cards:${itemId}`,
    (signal) => api.cards({ item_id: itemId }, { signal }),
  );
  const quizzesState = useResource(
    itemId === '' ? null : `quizzes:${itemId}`,
    (signal) => api.quizzes('item', itemId, { signal }),
  );

  const title =
    itemState.status === 'ready'
      ? (itemState.data.item.title ?? s.untitled)
      : s.title;
  const subtitle =
    itemState.status === 'ready'
      ? s.kinds[itemState.data.item.kind]
      : undefined;

  function reload(): void {
    itemState.reload();
    cardsState.reload();
    quizzesState.reload();
  }

  return (
    <div className="stack-lg">
      <AppBar
        title={title}
        subtitle={subtitle}
        back={{ to: '/temas', label: s.back }}
        actions={
          <IconButton
            label={s.refresh}
            icon="repasar"
            variant="ghost"
            onClick={reload}
          />
        }
      />
      <StateView
        state={itemState}
        empty={(detail) =>
          detail.item.title === null &&
          detail.text.trim() === '' &&
          detail.attachments.length === 0 &&
          detail.sheet === null &&
          detail.card_ids.length === 0
        }
        emptyText={s.empty}
        onRetry={itemState.reload}
      >
        {(detail) => (
          <ItemBody
            detail={detail}
            cardsState={cardsState}
            quizzesState={quizzesState}
            onReload={reload}
          />
        )}
      </StateView>
    </div>
  );
}
