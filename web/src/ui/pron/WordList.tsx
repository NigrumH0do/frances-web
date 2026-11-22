// Palabras de un intento con sus fonemas (Task PRN-03).
//
// Cada palabra es un `<button lang="fr">` cuyo nombre accesible es solo la
// palabra; al pulsarlo despliega `<ul aria-label="Fonemas de <palabra>">`
// con un chip por fonema («<fonema> <puntaje>»). El tipo de error de la
// palabra (si lo hay) va fuera del botón.

import { useEffect, useId, useState } from 'react';
import type { JSX } from 'react';
import { Icon } from '../../components';
import type { WordScore } from '../../contracts/generated';
import {
  cancelBrowserSpeech,
  speakWithBrowser,
  useBrowserFrenchVoice,
} from '../../media/browserTts';
import { ERROR_LABEL, formatScore, scoreBand } from './score';

export const WORD_LIST_LABELS = {
  list: 'Palabras',
  phonemesOf: (word: string): string => `Fonemas de ${word}`,
  speakWord: (word: string): string => `Escuchar ${word}`,
} as const;

export function WordList({ words }: { words: WordScore[] }): JSX.Element {
  const [open, setOpen] = useState<number | null>(null);
  const baseId = useId();
  const canSpeak = useBrowserFrenchVoice();

  useEffect(() => () => cancelBrowserSpeech(), []);

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
            </button>
            {canSpeak ? (
              <>
                {' '}
                <button
                  type="button"
                  className="word-play-btn"
                  aria-label={WORD_LIST_LABELS.speakWord(word.word)}
                  onClick={() => void speakWithBrowser(word.word)}
                >
                  <Icon name="play" size="sm" />
                </button>
              </>
            ) : null}{' '}
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
                    .map((phoneme, j) => {
                      const band = scoreBand(phoneme.accuracy);
                      return (
                        <li
                          key={j}
                          className={`pron-phoneme pron-band-${band}`}
                        >
                          {`${phoneme.phoneme} ${formatScore(phoneme.accuracy)}`}
                          {band === 'repetir' ? (
                            <span className="pron-phoneme-repeat">
                              {' '}
                              repetir
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                </ul>
              )}
          </li>
        );
      })}
    </ul>
  );
}

export default WordList;
