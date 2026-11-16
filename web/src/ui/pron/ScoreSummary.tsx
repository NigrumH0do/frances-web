// Resumen de puntajes de un intento (Task PRN-03): región «Puntaje global»
// con el número y la banda, más exactitud, fluidez y completitud.

import type { JSX } from 'react';
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
  return (
    <section
      aria-label={SCORE_SUMMARY_LABELS.region}
      className={`pron-score pron-band-${band}`}
    >
      <p>
        <strong className="pron-score-total">{formatScore(scores.pron)}</strong>{' '}
        <span className="pron-score-band">{SCORE_LABEL[band]}</span>
      </p>
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
