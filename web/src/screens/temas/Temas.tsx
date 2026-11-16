import { useId, useMemo, useState, type JSX } from 'react';
import { useSearchParams } from 'react-router';
import { useApi } from '../../api/ApiContext';
import { useResource } from '../../api/useResource';
import {
  AppBar,
  Chip,
  FilterChip,
  Icon,
  ListItem,
  Progress,
  Segmented,
  StateView,
} from '../../components';
import type { StudyTopic, TopicProgress } from '../../contracts/generated';
import { common, tr } from '../../l10n/es';
import { useOffline } from '../../offline/OfflineContext';
import { temasStrings as s } from './strings';
import { useCourse } from './useCourse';

type Level = NonNullable<StudyTopic['cefr']>;
type TopicFilter = 'all' | 'pending' | Level;

const LEVEL_ORDER: readonly Level[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

interface TopicsData {
  topics: StudyTopic[];
  progress: TopicProgress[];
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .trim();
}

function progressFor(
  topic: StudyTopic,
  byTopic: Map<string, TopicProgress>,
): TopicProgress {
  return (
    byTopic.get(topic.id) ?? {
      topic_id: topic.id,
      cards_total: topic.card_count,
      cards_learned: 0,
      last_quiz_score: null,
    }
  );
}

function topicsLabel(topic: StudyTopic): string {
  const publications =
    topic.item_ids.length === 1
      ? s.publicationsOne
      : tr(s.publications, { n: topic.item_ids.length });
  const cards =
    topic.card_count === 1 ? s.cardsOne : tr(s.cards, { n: topic.card_count });
  return `${publications} · ${cards}`;
}

function TopicsList({
  topics,
  progress,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  activeTopicId,
}: {
  topics: StudyTopic[];
  progress: TopicProgress[];
  query: string;
  onQueryChange: (value: string) => void;
  filter: TopicFilter;
  onFilterChange: (value: TopicFilter) => void;
  activeTopicId: string | null;
}): JSX.Element {
  const searchId = useId();
  const byTopic = useMemo(
    () => new Map(progress.map((entry) => [entry.topic_id, entry])),
    [progress],
  );

  const levels = useMemo(() => {
    const present = new Set<Level>();
    for (const topic of topics) {
      if (topic.cefr !== null) present.add(topic.cefr);
    }
    return LEVEL_ORDER.filter((level) => present.has(level));
  }, [topics]);

  const normalizedQuery = normalize(query);
  const visible = useMemo(() => {
    return topics.filter((topic) => {
      if (
        normalizedQuery !== '' &&
        !normalize(topic.title).includes(normalizedQuery)
      ) {
        return false;
      }
      if (filter === 'pending') {
        const entry = progressFor(topic, byTopic);
        return (
          entry.cards_learned < entry.cards_total ||
          entry.last_quiz_score === null
        );
      }
      if (filter !== 'all') return topic.cefr === filter;
      return true;
    });
  }, [byTopic, filter, normalizedQuery, topics]);

  const filtersActive = normalizedQuery !== '' || filter !== 'all';
  const hidden = filtersActive ? topics.length - visible.length : 0;
  const activeTopic = topics.find((topic) => topic.id === activeTopicId);
  const hiddenActive =
    activeTopic !== undefined &&
    !visible.some((topic) => topic.id === activeTopic.id)
      ? activeTopic
      : null;

  return (
    <div className="stack-lg">
      <div className="search">
        <Icon name="search" />
        <label className="sr-only" htmlFor={searchId}>
          {s.searchLabel}
        </label>
        <input
          id={searchId}
          className="input"
          type="search"
          placeholder={s.searchPlaceholder}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>

      <div className="chips-scroll" role="group" aria-label={s.filtersLabel}>
        <FilterChip
          pressed={filter === 'all'}
          onPressedChange={() => onFilterChange('all')}
        >
          {s.all}
        </FilterChip>
        <FilterChip
          pressed={filter === 'pending'}
          onPressedChange={(next) => onFilterChange(next ? 'pending' : 'all')}
        >
          {s.pending}
        </FilterChip>
        {levels.map((level) => (
          <FilterChip
            key={level}
            pressed={filter === level}
            onPressedChange={(next) => onFilterChange(next ? level : 'all')}
          >
            {level}
          </FilterChip>
        ))}
      </div>

      {hidden > 0 ? (
        <div className="callout info" role="status" aria-live="polite">
          <Icon name="alert" size="sm" />
          <div className="grow">
            <p className="small">{tr(s.hidden, { n: hidden })}</p>
            {hiddenActive !== null ? (
              <p className="small">
                {tr(s.hiddenActive, { title: hiddenActive.title })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <ul className="list" aria-label={s.title}>
        {visible.map((topic) => {
          const entry = progressFor(topic, byTopic);
          const percent =
            entry.cards_total > 0
              ? Math.round((entry.cards_learned / entry.cards_total) * 100)
              : 0;
          return (
            <li key={topic.id}>
              <ListItem
                to={`/temas/${topic.id}`}
                title={
                  <span className="row-between">
                    <span className="fr" lang="fr">
                      {topic.title}
                    </span>
                    <span className="row wrap">
                      {topic.id === activeTopicId ? (
                        <Chip>{s.active}</Chip>
                      ) : null}
                      {topic.cefr !== null ? (
                        <Chip tone="level">{topic.cefr}</Chip>
                      ) : null}
                    </span>
                  </span>
                }
                meta={
                  <span className="stack">
                    <span>{topicsLabel(topic)}</span>
                    {topic.source_changed ? (
                      <Chip tone="warning">{s.sourceChanged}</Chip>
                    ) : null}
                    <span className="row">
                      <span className="grow">
                        <Progress
                          value={entry.cards_learned}
                          max={entry.cards_total}
                          label={tr(s.progressLabel, {
                            title: topic.title,
                            percent,
                          })}
                        />
                      </span>
                      <span className="xs muted">{percent} %</span>
                    </span>
                  </span>
                }
              />
            </li>
          );
        })}
      </ul>

      <p className="xs muted">{s.regroupNote}</p>
    </div>
  );
}

export function Temas(): JSX.Element {
  const api = useApi();
  const { online } = useOffline();
  const course = useCourse();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TopicFilter>('all');
  const [params] = useSearchParams();
  const activeTopicId = params.get('tema');

  const data = useResource<TopicsData>(
    course.courseId === null ? null : `temas:${course.courseId}`,
    async (signal) => {
      const courseId = course.courseId;
      if (courseId === null) throw new Error('No hay curso seleccionado');
      const [topics, progress] = await Promise.all([
        api.topics(courseId, { signal }),
        api.topicProgress(courseId, { signal }),
      ]);
      return { topics, progress };
    },
  );

  const selectedCourse =
    course.courses.find((entry) => entry.id === course.courseId) ?? null;
  const subtitle = selectedCourse?.name;

  return (
    <div className="stack-lg">
      <AppBar title={s.title} subtitle={subtitle} />

      {!online && data.status === 'ready' && !data.stale ? (
        <div className="callout" role="status">
          <Icon name="offline" size="sm" />
          <p className="small grow">{common.offlineStale}</p>
        </div>
      ) : null}

      <StateView
        state={course.state}
        empty={(courses) => courses.length === 0}
        emptyText={s.coursesEmpty}
        onRetry={course.reload}
      >
        {(courses) => (
          <div className="stack-lg">
            {courses.length > 1 ? (
              <Segmented
                label={s.courseLabel}
                options={courses.map((entry) => ({
                  value: entry.id,
                  label: entry.name,
                }))}
                value={course.courseId ?? courses[0]?.id ?? ''}
                onChange={course.setCourseId}
              />
            ) : null}

            <StateView
              state={data}
              empty={(value) => value.topics.length === 0}
              emptyText={s.empty}
              onRetry={data.reload}
            >
              {(value) => (
                <TopicsList
                  topics={value.topics}
                  progress={value.progress}
                  query={query}
                  onQueryChange={setQuery}
                  filter={filter}
                  onFilterChange={setFilter}
                  activeTopicId={activeTopicId}
                />
              )}
            </StateView>
          </div>
        )}
      </StateView>
    </div>
  );
}

export default Temas;
