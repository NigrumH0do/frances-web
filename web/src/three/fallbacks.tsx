// Fallbacks editoriales, estáticos. Este archivo no importa three: entra en el
// bundle inicial a través de LazyScenes.

import { scoreBand } from '../ui/pron/score';

const MILESTONES = [
  { day: 3, r: 33 },
  { day: 7, r: 27 },
  { day: 30, r: 21 },
] as const;

export function NotebookFallback() {
  return (
    <div className="notebook-fallback" aria-hidden="true">
      <span className="scene-contact" />
      <div className="notebook-fallback-body">
        <span data-part="cover-left" />
        <span data-part="spine" />
        <span data-part="cover-right" />
      </div>
      <span data-part="ribbon">
        <span data-part="ribbon-tip" />
      </span>
    </div>
  );
}

export function CompassFallback({ streak }: { streak: number }) {
  const gold = streak >= 14;
  return (
    <div className="compass-fallback" aria-hidden="true">
      <span className="scene-contact" />
      <svg viewBox="0 0 96 96" width="100%" height="100%">
        <g
          data-part="cross"
          stroke="var(--c-text)"
          strokeOpacity="0.35"
          strokeWidth="1"
        >
          <line x1="48" y1="12" x2="48" y2="84" />
          <line x1="12" y1="48" x2="84" y2="48" />
        </g>
        <circle
          data-part="ring"
          className={gold ? 'compass-milestone-14' : undefined}
          cx="48"
          cy="48"
          r="40"
          fill="none"
          stroke={gold ? 'var(--c-gold-3d, #d3ac41)' : 'var(--c-border-strong)'}
          strokeWidth="2"
        />
        {MILESTONES.map(({ day, r }) => (
          <circle
            key={day}
            data-part="milestone"
            data-day={day}
            cx="48"
            cy="48"
            r={r}
            fill="none"
            stroke="var(--c-accent)"
            strokeWidth="1.25"
            strokeOpacity={streak >= day ? '1' : '0'}
          />
        ))}
        <path
          data-part="needle-north"
          d="M48 18 L53 48 L43 48 Z"
          fill="var(--c-accent)"
        />
        <path
          data-part="needle-south"
          d="M48 78 L53 48 L43 48 Z"
          fill="var(--c-text)"
        />
        <circle
          data-part="hub"
          cx="48"
          cy="48"
          r="3.5"
          fill="var(--c-card)"
          stroke="var(--c-text)"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}

export function OrbFallback({
  active = false,
  score,
}: {
  active?: boolean;
  score?: number;
}) {
  const band = score === undefined ? null : scoreBand(score);
  const className =
    band === null ? 'orb-fallback' : `orb-fallback orb-band-${band}`;
  return (
    <div className="orb-anchor" aria-hidden="true">
      <span className="scene-contact" />
      <div className={className} data-active={active ? 'true' : 'false'} />
    </div>
  );
}
