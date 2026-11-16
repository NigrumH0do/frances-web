import { Link } from 'react-router';
import type { PlanEntry } from '../../contracts/generated';
import { Chip, Icon, Progress } from '../../components';
import { tr } from '../../l10n/es';
import { hoyStrings } from './strings';

export interface PlanListProps {
  day: string;
  entries: readonly PlanEntry[];
  onToggle: (entry: PlanEntry) => void;
}

function hrefFor(entry: PlanEntry): string {
  switch (entry.kind) {
    case 'review':
      return '/repasar';
    case 'quiz':
      return entry.ref_id === null
        ? '/temas'
        : `/quiz/${encodeURIComponent(entry.ref_id)}`;
    case 'read':
      return entry.ref_id === null
        ? '/temas'
        : `/publicaciones/${encodeURIComponent(entry.ref_id)}`;
    case 'drill':
      return '/repasar/pronunciacion';
  }
}

// Plan del día. La casilla «Hecho» es un objetivo propio (un <label> de 44 px)
// y el enlace de la entrada es otro: nunca se anida uno dentro del otro.
export function PlanList({ day, entries, onToggle }: PlanListProps) {
  const total = entries.length;
  const done = entries.filter((entry) => entry.done).length;
  const progressText = tr(hoyStrings.planProgress, { done, total });

  return (
    <section
      className="card card-accent"
      data-day={day}
      aria-labelledby="plan-hoy"
    >
      <div className="stack">
        <div className="row-between">
          <h2 id="plan-hoy">{hoyStrings.planTitle}</h2>
          <span className="small">{progressText}</span>
        </div>
        <Progress value={done} max={Math.max(total, 1)} label={progressText} />

        {total === 0 ? (
          <p className="small muted">{hoyStrings.planEmpty}</p>
        ) : (
          <ul className="list" aria-label={hoyStrings.planTitle}>
            {entries.map((entry) => (
              <li key={entry.position}>
                <div className="row">
                  <label
                    className="btn btn-ghost btn-icon"
                    title={hoyStrings.done}
                  >
                    <input
                      type="checkbox"
                      className={entry.done ? 'check done' : 'check'}
                      aria-label={hoyStrings.done}
                      checked={entry.done}
                      onChange={() => onToggle(entry)}
                    />
                  </label>

                  <Link to={hrefFor(entry)} className="list-item grow">
                    <span className="grow">
                      <span className="title">
                        {entry.title_es}
                        {entry.done ? (
                          <>
                            {' '}
                            <Chip tone="success">{hoyStrings.done}</Chip>
                          </>
                        ) : null}
                      </span>
                      <br />
                      <span className="meta">{entry.reason_es}</span>
                      {entry.why_llm_es !== null ? (
                        <>
                          <br />
                          <span className="small muted">
                            <Chip tone="level">{hoyStrings.ai}</Chip>{' '}
                            {entry.why_llm_es}
                          </span>
                        </>
                      ) : null}
                    </span>
                    <Icon name="chevron" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
