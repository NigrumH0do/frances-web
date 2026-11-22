import type { JSX } from 'react';
import { Link, useParams } from 'react-router';
import { useApi } from '../../api/ApiContext';
import { useResource } from '../../api/useResource';
import { AppBar, Icon, StateView, Tabs } from '../../components';
import type { StudyTopic } from '../../contracts/generated';
import { common, tr } from '../../l10n/es';
import { useOffline } from '../../offline/OfflineContext';
import { temaStrings as s } from './strings';
import { TopicCards } from './TopicCards';
import { TopicItems } from './TopicItems';
import { TopicQuizzes } from './TopicQuizzes';
import { TopicSummary } from './TopicSummary';
import './temas.css';

function subtitleFor(topic: StudyTopic): string {
  const publications =
    topic.item_ids.length === 1
      ? s.publicationsOne
      : tr(s.publications, { n: topic.item_ids.length });
  const cards =
    topic.card_count === 1
      ? s.cardsCountOne
      : tr(s.cardsCount, {
          n: topic.card_count,
        });
  const counts = `${publications} · ${cards}`;
  return topic.cefr === null ? counts : `${topic.cefr} · ${counts}`;
}

// Detalle del tema: Resumen, Clases, Tarjetas y Quiz. Cada pestaña se monta
// solo al abrirse, así «Clases» no pide sus publicaciones hasta que hace falta.
export function TemaDetalle(): JSX.Element {
  const { topicId = '' } = useParams();
  const api = useApi();
  const { online } = useOffline();
  const state = useResource(
    topicId === '' ? null : `topic:${topicId}`,
    (signal) => api.topic(topicId, { signal }),
  );

  const notFound =
    state.status === 'error' &&
    state.error.kind === 'http' &&
    state.error.status === 404;
  const title = state.status === 'ready' ? state.data.title : s.title;
  const subtitle =
    state.status === 'ready' ? subtitleFor(state.data) : undefined;

  return (
    <div className="stack-lg">
      <AppBar
        title={title}
        subtitle={subtitle}
        back={{ to: '/temas', label: common.back }}
      />

      {!online && state.status === 'ready' && !state.stale ? (
        <div className="callout" role="status">
          <Icon name="offline" size="sm" />
          <p className="small grow">{common.offlineStale}</p>
        </div>
      ) : null}

      {notFound ? (
        <div className="state">
          <div className="art">
            <Icon name="alert" />
          </div>
          <h2>{s.notFoundTitle}</h2>
          <p className="small muted">{s.notFoundBody}</p>
          <Link className="btn btn-secondary" to="/temas">
            {s.back}
          </Link>
        </div>
      ) : (
        <StateView
          state={state}
          empty={(topic) =>
            topic.item_ids.length === 0 && topic.description_es.trim() === ''
          }
          emptyText={s.empty}
          emptyAction={
            <Link className="btn btn-secondary" to="/temas">
              {s.back}
            </Link>
          }
          onRetry={state.reload}
        >
          {(topic) => (
            <Tabs
              label={s.tabsLabel}
              tabs={[
                {
                  id: 'resumen',
                  label: s.summary,
                  panel: <TopicSummary topic={topic} />,
                },
                {
                  id: 'clases',
                  label: s.classes,
                  panel: <TopicItems itemIds={topic.item_ids} />,
                },
                {
                  id: 'tarjetas',
                  label: s.cards,
                  panel: <TopicCards topicId={topic.id} />,
                },
                {
                  id: 'quiz',
                  label: s.quiz,
                  panel: <TopicQuizzes topicId={topic.id} />,
                },
              ]}
            />
          )}
        </StateView>
      )}
    </div>
  );
}

export default TemaDetalle;
