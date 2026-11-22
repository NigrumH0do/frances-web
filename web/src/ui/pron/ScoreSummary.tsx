// Resumen de puntajes de un intento (Task PRN-03): región «Puntaje global»
// con el número y la banda, más exactitud, fluidez y completitud.

import type { JSX } from 'react';
import type { PronScores } from '../../contracts/generated';
import { SCORE_LABEL, formatScore, scoreBand, type ScoreBand } from './score';

export const SCORE_SUMMARY_LABELS = {
  region: 'Puntaje global',
  blend: 'Junta las tres notas de abajo.',
  accuracy: 'Exactitud',
  accuracyHint: 'Qué tan parecidos fueron los sonidos a la frase.',
  fluency: 'Fluidez',
  fluencyHint: 'El ritmo: si salió seguido o con cortes.',
  completeness: 'Completitud',
  completenessHint: 'Cuánto de la frase se llegó a reconocer.',
} as const;

function BandIcon({ band }: { band: ScoreBand }): JSX.Element {
  const common = {
    className: 'score-band-icon',
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    'aria-hidden': true as const,
    focusable: 'false' as const,
    'data-band': band,
  };
  if (band === 'excelente') {
    return (
      <svg {...common}>
        <path
          fill="currentColor"
          d="M8 1.2 9.7 5.2 14 5.7 10.8 8.7 11.7 13.2 8 11 4.3 13.2 5.2 8.7 2 5.7 6.3 5.2 Z"
        />
      </svg>
    );
  }
  if (band === 'bien') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3.2" fill="currentColor" />
      </svg>
    );
  }
  if (band === 'mejorable') {
    return (
      <svg {...common}>
        <path
          d="M8 2.2 14 13.5 H2 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path
        d="M2.5 8 H12.2 M9 4.2 13.2 8 9 11.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ScoreSummary({ scores }: { scores: PronScores }): JSX.Element {
  const band = scoreBand(scores.pron);
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, scores.pron));
  const dashOffset = circumference * (1 - pct / 100);

  return (
    <section aria-label={SCORE_SUMMARY_LABELS.region} className="pron-score">
      <div className="score-ring-wrap">
        <svg viewBox="0 0 76 76" className="score-ring" aria-hidden="true">
          <circle className="score-ring-bg" cx="38" cy="38" r={radius} />
          <circle
            className="score-ring-fg"
            cx="38"
            cy="38"
            r={radius}
            stroke={`var(--c-score-${band})`}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <p>
          <strong className="pron-score-total">
            {formatScore(scores.pron)}
          </strong>{' '}
          <span className="pron-score-band">
            <BandIcon band={band} />
            {SCORE_LABEL[band]}
          </span>
        </p>
      </div>
      <p className="pron-score-hint">{SCORE_SUMMARY_LABELS.blend}</p>
      <ul className="pron-score-parts">
        <li>
          <span>{`${SCORE_SUMMARY_LABELS.accuracy} ${formatScore(scores.accuracy)}`}</span>
          <span className="pron-score-hint">
            {SCORE_SUMMARY_LABELS.accuracyHint}
          </span>
        </li>
        <li>
          <span>{`${SCORE_SUMMARY_LABELS.fluency} ${formatScore(scores.fluency)}`}</span>
          <span className="pron-score-hint">
            {SCORE_SUMMARY_LABELS.fluencyHint}
          </span>
        </li>
        <li>
          <span>{`${SCORE_SUMMARY_LABELS.completeness} ${formatScore(scores.completeness)}`}</span>
          <span className="pron-score-hint">
            {SCORE_SUMMARY_LABELS.completenessHint}
          </span>
        </li>
      </ul>
    </section>
  );
}

export default ScoreSummary;
