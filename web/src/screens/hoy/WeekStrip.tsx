import type { DayCount } from '../../contracts/generated';
import { bogotaDay } from '../../i18n/dates';
import { tr } from '../../l10n/es';
import { hoyStrings } from './strings';

const DAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;
const DAY_NAMES = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
] as const;

function countLabel(n: number, one: string, many: string): string {
  return tr(n === 1 ? one : many, { n });
}

// Barras de actividad de la semana (lunes a domingo). El día actual se marca
// con texto en negrita y con una frase para lectores de pantalla; el color no
// es el único indicador. Las alturas son valores calculados (CSSOM).
export function WeekStrip({ week }: { week: readonly DayCount[] }) {
  const today = bogotaDay(new Date());
  const todayIndex = week.findIndex((day) => day.day === today);
  const max = Math.max(
    1,
    ...week.map((day) => day.reviews + day.quiz_attempts),
  );
  const days = week
    .map((day, index) =>
      tr(hoyStrings.daySummary, {
        day: DAY_NAMES[index] ?? '',
        reviews: countLabel(
          day.reviews,
          hoyStrings.reviewOne,
          hoyStrings.reviewMany,
        ),
        quizzes: countLabel(
          day.quiz_attempts,
          hoyStrings.quizOne,
          hoyStrings.quizMany,
        ),
      }),
    )
    .join('; ');
  const summary = tr(hoyStrings.weekSummary, { days });
  const todayText =
    todayIndex >= 0
      ? ` ${tr(hoyStrings.todayIs, { day: DAY_NAMES[todayIndex] ?? '' })}`
      : '';

  return (
    <>
      <div className="section-title">
        <h2>{hoyStrings.weekTitle}</h2>
      </div>
      <div className="card">
        <div className="week-counts" aria-hidden="true">
          {week.map((day) => {
            const total = day.reviews + day.quiz_attempts;
            return (
              <span key={day.day} className={total === 0 ? 'off' : undefined}>
                {total}
              </span>
            );
          })}
        </div>
        <div className="bars" aria-hidden="true">
          {week.map((day) => {
            const total = day.reviews + day.quiz_attempts;
            return (
              <span
                key={day.day}
                className={total === 0 ? 'off' : undefined}
                style={{
                  height: `${Math.max(4, Math.round((total / max) * 100))}%`,
                }}
              />
            );
          })}
        </div>
        <div className="bars-labels" aria-hidden="true">
          {DAY_LABELS.map((label, index) =>
            index === todayIndex ? (
              <strong key={label}>{label}</strong>
            ) : (
              <span key={label}>{label}</span>
            ),
          )}
        </div>
        <p className="sr-only">
          {summary}
          {todayText}
        </p>
        {week.every((day) => day.reviews + day.quiz_attempts === 0) ? (
          <p className="week-empty">{hoyStrings.weekEmpty}</p>
        ) : null}
      </div>
    </>
  );
}
