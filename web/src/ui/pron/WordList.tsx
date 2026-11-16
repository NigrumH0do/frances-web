// Palabras de un intento con sus fonemas (Task PRN-03).
//
// Cada palabra es un `<button lang="fr">` cuyo nombre accesible es solo la
// palabra; al pulsarlo despliega `<ul aria-label="Fonemas de <palabra>">`
// con un chip por fonema («<fonema> <puntaje>»). El tipo de error de la
// palabra (si lo hay) va fuera del botón.

import { useId, useState } from 'react';
import type { JSX } from 'react';
import type { WordScore } from '../../contracts/generated';
import { ERROR_LABEL, formatScore, scoreBand } from './score';

export const WORD_LIST_LABELS = {
  list: 'Palabras',
  phonemesOf: (word: string): string => `Fonemas de ${word}`,
} as const;

export function WordList({ words }: { words: WordScore[] }): JSX.Element {
  const [open, setOpen] = useState<number | null>(null);
  const baseId = useId();
  return (
    <ul aria-label={WORD_LIST_LABELS.list} className="pron-words">
      {words.map((word, i) => {
        const expanded = open === i;
        const listId = `${baseId}-${i}`;
        const error = ERROR_LABEL[word.error_type];
        return (
          <li
            key={i}
            className={`pron-word pron-band-${scoreBand(word.accuracy)}`}
          >
            <button
              type="button"
              lang="fr"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setOpen(expanded ? null : i)}
            >
              {word.word}
            </button>{' '}
            <span className="pron-word-score">
              {formatScore(word.accuracy)}
            </span>
            {error !== null && (
              <>
                {' '}
                <span className="pron-word-error">{error}</span>
              </>
            )}
            {expanded &&
              word.phonemes.some((phoneme) => phoneme.phoneme !== '') && (
                <ul
                  id={listId}
                  aria-label={WORD_LIST_LABELS.phonemesOf(word.word)}
                  className="pron-phonemes"
                >
                  {word.phonemes
                    .filter((phoneme) => phoneme.phoneme !== '')
                    .map((phoneme, j) => (
                      <li
                        key={j}
                        className={`pron-phoneme pron-band-${scoreBand(phoneme.accuracy)}`}
                      >
                        {`${phoneme.phoneme} ${formatScore(phoneme.accuracy)}`}
                      </li>
                    ))}
                </ul>
              )}
          </li>
        );
      })}
    </ul>
  );
}

export default WordList;
