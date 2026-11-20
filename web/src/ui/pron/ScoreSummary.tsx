// Resumen de puntajes de un intento (Task PRN-03): región «Puntaje global»
// con el número y la banda, más exactitud, fluidez y completitud.

import type { JSX } from 'react';
import { cx } from '../../components/cx';
import type { PronScores } from '../../contracts/generated';
import { SCORE_LABEL, formatScore, scoreBand } from './score';

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

export function ScoreSummary({ scores }: { scores: PronScores }): JSX.Element {
  const band = scoreBand(scores.pron);
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, scores.pron));
  const dashOffset = circumference * (1 - pct / 100);
  const ringTone =
    band === 'excelente' || band === 'bien'
      ? 'good'
      : band === 'repetir'
        ? 'warn'
        : undefined;

  return (
    <section
      aria-label={SCORE_SUMMARY_LABELS.region}
      className={`pron-score pron-band-${band}`}
    >
      <div className="score-ring-wrap">
        <svg viewBox="0 0 76 76" className="score-ring" aria-hidden="true">
          <circle className="score-ring-bg" cx="38" cy="38" r={radius} />
          <circle
            className={cx('score-ring-fg', ringTone)}
            cx="38"
            cy="38"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <p>
          <strong className="pron-score-total">
            {formatScore(scores.pron)}
          </strong>{' '}
          <span className="pron-score-band">{SCORE_LABEL[band]}</span>
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
