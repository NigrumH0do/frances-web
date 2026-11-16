import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { OfflineError } from '../../api/client';
import { useApi } from '../../api/ApiContext';
import { useResource } from '../../api/useResource';
import { useAuth } from '../../auth/AuthContext';
import { Chip, Icon, StateView } from '../../components';
import type {
  ItemSummary,
  PlanEntry,
  StudyPlanDay,
  StudyStatus,
  UserStats,
} from '../../contracts/generated';
import { formatShort, TZ } from '../../i18n/dates';
import { tr } from '../../l10n/es';
import { useOffline } from '../../offline/OfflineContext';
import { PlanList } from './PlanList';
import { UpcomingCard } from './UpcomingCard';
import { WeekStrip } from './WeekStrip';
import { hoyStrings } from './strings';

interface HoyData {
  plan: StudyPlanDay;
  stats: UserStats;
  upcoming: ItemSummary[];
  status: StudyStatus;
}

function bogotaHour(date: Date): number {
  for (const part of new Intl.DateTimeFormat('es-CO', {
    timeZone: TZ,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)) {
    if (part.type === 'hour') return Number(part.value);
  }
  return 0;
}

function greeting(date: Date): { es: string; fr: string } {
  const hour = bogotaHour(date);
  if (hour < 12) return { es: hoyStrings.morning, fr: hoyStrings.frMorning };
  if (hour < 19) {
    return { es: hoyStrings.afternoon, fr: hoyStrings.frAfternoon };
  }
  return { es: hoyStrings.evening, fr: hoyStrings.frEvening };
}

function pendingTotal(status: StudyStatus): number {
  return Object.values(status.pending).reduce((sum, count) => sum + count, 0);
}

function isEmpty(data: HoyData): boolean {
  return (
    data.plan.entries.length === 0 &&
    data.upcoming.length === 0 &&
    pendingTotal(data.status) === 0 &&
    data.stats.week.every((day) => day.reviews + day.quiz_attempts === 0)
  );
}

// Acceso a Texto libre: una hoja pautada que invita a escribir y decir algo.
function SpeakShortcut() {
  return (
    <Link to="/repasar/texto" className="hoy-speak paper">
      <span>
        <strong>{hoyStrings.speakTitle}</strong>
        <span className="fr" lang="fr">
          {hoyStrings.speakBody}
        </span>
      </span>
      <span className="lead-icon" aria-hidden="true">
        <Icon name="mic" />
      </span>
    </Link>
  );
}

// Pantalla Hoy: plan del día, próxima entrega y actividad de la semana. Los
// cuatro recursos se cargan juntos para tener un solo estado de carga/error.
// Marcar «Hecho» es optimista; sin red la operación va a la cola de UI-07.
export function Hoy() {
  const api = useApi();
  const { user } = useAuth();
  const { online, enqueue } = useOffline();
  const [now] = useState(() => new Date());
  const [entries, setEntries] = useState<PlanEntry[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const resource = useResource<HoyData>('hoy', async (signal) => {
    const [plan, stats, upcoming, status] = await Promise.all([
      api.planToday({ signal }),
      api.stats({ signal }),
      api.upcoming(undefined, { signal }),
      api.studyStatus({ signal }),
    ]);
    return { plan, stats, upcoming, status };
  });

  const planEntries =
    resource.status === 'ready' ? resource.data.plan.entries : null;
  useEffect(() => {
    if (planEntries !== null) setEntries(planEntries);
  }, [planEntries]);

  const currentEntries = entries ?? planEntries ?? [];

  async function toggle(entry: PlanEntry) {
    if (resource.status !== 'ready') return;
    const plan = resource.data.plan;
    const kind = entry.done ? 'plan_undone' : 'plan_done';
    const optimistic = currentEntries.map((item) =>
      item.position === entry.position ? { ...item, done: !entry.done } : item,
    );

    setEntries(optimistic);
    setActionError(null);

    try {
      if (!online) {
        await enqueue({ kind, day: plan.day, position: entry.position });
        return;
      }
      const updated =
        kind === 'plan_done'
          ? await api.planDone(plan.day, entry.position)
          : await api.planUndone(plan.day, entry.position);
      setEntries((current) =>
        (current ?? []).map((item) =>
          item.position === updated.position ? updated : item,
        ),
      );
    } catch (error) {
      if (error instanceof OfflineError) {
        try {
          await enqueue({ kind, day: plan.day, position: entry.position });
          return;
        } catch {
          // La cola tampoco está disponible: se revierte abajo.
        }
      }
      setEntries(currentEntries);
      setActionError(hoyStrings.saveError);
    }
  }

  const name = user?.display_name.trim() ?? '';
  const hello = greeting(now);
  const title = name.length > 0 ? `${hello.es}, ${name}` : hello.es;
  const frTitle = name.length > 0 ? `${hello.fr}, ${name}.` : `${hello.fr}.`;

  return (
    <div className="stack-lg">
      <header className="hoy-hero">
        <div>
          <h1>{title}</h1>
          <p className="hoy-fr" lang="fr">
            {frTitle}
          </p>
          <p className="sub">{formatShort(now.toISOString())}</p>
        </div>
        {resource.status === 'ready' ? (
          <Chip tone="streak">
            {tr(hoyStrings.streak, {
              n: resource.data.stats.streak_days,
            })}
          </Chip>
        ) : null}
      </header>

      {!online && resource.status === 'ready' && !resource.stale ? (
        <div className="callout" role="status">
          <Icon name="offline" size="sm" />
          <p className="small grow">{hoyStrings.offlineSaved}</p>
        </div>
      ) : null}

      <StateView
        state={resource}
        onRetry={resource.reload}
        empty={isEmpty}
        emptyText={hoyStrings.planEmpty}
      >
        {(data) => (
          <div className="hoy-grid">
            <div className="stack-lg">
              {pendingTotal(data.status) > 0 &&
              data.plan.entries.length === 0 ? (
                <div className="callout info" role="status">
                  <Icon name="hoy" size="sm" />
                  <p className="small grow">{hoyStrings.generating}</p>
                </div>
              ) : null}

              <PlanList
                day={data.plan.day}
                entries={currentEntries}
                onToggle={toggle}
              />

              {actionError !== null ? (
                <p className="small" role="alert">
                  {actionError}
                </p>
              ) : null}
            </div>

            <div className="stack-lg">
              <SpeakShortcut />

              {data.upcoming[0] !== undefined ? (
                <UpcomingCard item={data.upcoming[0]} />
              ) : null}

              <WeekStrip week={data.stats.week} />
            </div>
          </div>
        )}
      </StateView>
    </div>
  );
}

export default Hoy;
