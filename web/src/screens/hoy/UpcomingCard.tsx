import { Link } from 'react-router';
import type { ItemSummary } from '../../contracts/generated';
import { Icon } from '../../components';
import { bogotaDay, formatLong } from '../../i18n/dates';
import { tr } from '../../l10n/es';
import { hoyStrings } from './strings';

function daysUntil(dueIso: string, now: Date): number {
  const from = Date.parse(`${bogotaDay(now)}T00:00:00Z`);
  const to = Date.parse(`${bogotaDay(new Date(dueIso))}T00:00:00Z`);
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function relativeDue(dueIso: string): string {
  const days = daysUntil(dueIso, new Date());
  if (days === 0) return hoyStrings.dueToday;
  if (days === 1) return hoyStrings.dueTomorrow;
  return tr(hoyStrings.dueInDays, { n: days });
}

// Primera entrega próxima (`/api/me/upcoming`). El título enlaza a la
// publicación; la fecha se muestra en hora de Bogotá.
export function UpcomingCard({ item }: { item: ItemSummary }) {
  const title = item.title ?? hoyStrings.untitled;
  const due = item.due_at;

  return (
    <>
      <div className="section-title">
        <h2>{hoyStrings.upcomingTitle}</h2>
      </div>
      <article className="card">
        <div className="row">
          <span className="lead-icon warn">
            <Icon name="hoy" />
          </span>
          <div className="grow">
            <h3>
              <Link to={`/publicaciones/${encodeURIComponent(item.id)}`}>
                {title}
              </Link>
            </h3>
            {due !== null ? (
              <p className="small muted">
                {tr(hoyStrings.due, {
                  date: formatLong(due),
                  relative: relativeDue(due),
                })}
              </p>
            ) : null}
          </div>
        </div>
      </article>
    </>
  );
}
