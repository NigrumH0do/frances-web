import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AppBar, Button, FilterChip, Icon, StateView } from '../../components';
import { tr } from '../../l10n/es';
import { CardAudio } from '../../media/CardAudio';
import { useOffline } from '../../offline/OfflineContext';
import { normalizePhoneme } from '../../pron/phonemeLabels';
import {
  useDeviceQuota,
  usePracticeRecognizer,
} from '../../pron/practiceHooks';
import { formatSpeechQuota, QUOTA_MESSAGES } from '../../pron/quota';
import type { Recognizer } from '../../pron/recognizer';
import { loadStats, SEED_WEAK, weakPhonemes } from '../../pron/stats';
import { PracticeSession } from '../../ui/pron/PracticeSession';
import { ReviewTabs } from '../repasar/ReviewTabs';
import { usePracticeDeck, type PracticeMode } from './usePracticeDeck';
import { practiceProgress, pronunciacionStrings as s } from './strings';

export { speechErrorMessage } from '../../pron/practiceHooks';

// Fonemas débiles guardados en IndexedDB por PRN-04 (R-42). El selector se
// completa con la semilla cuando todavía no hay intentos suficientes.
function useWeakPhonemes(): { weak: string[]; refresh: () => void } {
  const [weak, setWeak] = useState<string[]>(() => [...SEED_WEAK]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadStats()
      .then((stats) => {
        if (!cancelled) {
          setWeak(weakPhonemes(stats, [...SEED_WEAK], 5));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  return { weak, refresh };
}

function Deck({
  mode,
  phoneme,
  recognizer,
  onPracticed,
}: {
  mode: PracticeMode;
  phoneme: string;
  recognizer: Recognizer | null;
  onPracticed: () => void;
}) {
  const deck = usePracticeDeck(mode, mode === 'fonema' ? phoneme : undefined);
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    setIndex(0);
    setFinished(false);
  }, [mode, phoneme]);

  const cards = deck.status === 'ready' ? deck.data : [];
  const total = cards.length;
  const current = index < total ? cards[index] : undefined;
  const view = current === undefined ? undefined : deck.views.get(current.id);

  useEffect(() => {
    if (total > 0 && index >= total) {
      setIndex(0);
    }
  }, [index, total]);

  const next = useCallback(() => {
    if (index + 1 >= total) {
      setFinished(true);
    } else {
      setIndex(index + 1);
    }
  }, [index, total]);

  const emptyText =
    mode === 'fonema' && phoneme === ''
      ? s.choosePhoneme
      : mode === 'fonema'
        ? s.emptyPhoneme
        : s.emptyPhrases;

  if (finished) {
    return (
      <div className="card stack" role="status">
        <h2>{s.finishedTitle}</h2>
        <p className="small muted">{s.finishedBody}</p>
        <div className="row wrap">
          <Button
            variant="primary"
            onClick={() => {
              setIndex(0);
              setFinished(false);
            }}
          >
            {s.practiceAgain}
          </Button>
          <Link className="btn btn-secondary" to="/repasar">
            {s.backToReview}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <StateView
      state={deck}
      empty={() => total === 0}
      emptyText={emptyText}
      emptyAction={
        mode === 'frases' ? (
          <Link className="btn btn-secondary" to="/temas">
            {s.emptyAction}
          </Link>
        ) : undefined
      }
      onRetry={deck.reload}
    >
      {() =>
        current !== undefined && view !== undefined ? (
          <div className="stack">
            <p className="small muted">
              {practiceProgress(mode, phoneme, index, total)}
            </p>
            <PracticeSession
              key={current.id}
              card={current}
              recognizer={recognizer}
              onFinished={onPracticed}
              onNext={next}
              audio={<CardAudio card={view} field="front" />}
            />
          </div>
        ) : null
      }
    </StateView>
  );
}

/**
 * Pantalla de práctica de pronunciación (UI-16). Reusa la sesión de v1
 * (`PracticeSession`, CHG-13), las pestañas de Repasar (UI-15), el audio v2
 * (UI-11) y el recognizer con token de `POST /api/speech/token`.
 */
export default function Pronunciacion() {
  const { online } = useOffline();
  const [params, setParams] = useSearchParams();
  const mode: PracticeMode =
    params.get('modo') === 'fonema' ? 'fonema' : 'frases';
  const phoneme = normalizePhoneme(params.get('fonema') ?? '');
  const { weak, refresh: refreshWeak } = useWeakPhonemes();
  const { seconds, quota, refresh: refreshQuota } = useDeviceQuota();
  const { recognizer, speechError, clearSpeechError } = usePracticeRecognizer();

  const chooseFrases = useCallback(() => {
    clearSpeechError();
    const next = new URLSearchParams(params);
    next.set('modo', 'frases');
    next.delete('fonema');
    setParams(next);
  }, [clearSpeechError, params, setParams]);

  const choosePhoneme = useCallback(
    (label: string) => {
      clearSpeechError();
      const next = new URLSearchParams(params);
      next.set('modo', 'fonema');
      next.set('fonema', label);
      setParams(next);
    },
    [clearSpeechError, params, setParams],
  );

  const practiced = useCallback(() => {
    refreshWeak();
    refreshQuota();
  }, [refreshQuota, refreshWeak]);

  return (
    <div className="stack-lg">
      <AppBar title={s.title} />
      <ReviewTabs active="pronunciacion" />

      <div className="chips-scroll" role="group" aria-label={s.modeLabel}>
        <FilterChip pressed={mode === 'frases'} onPressedChange={chooseFrases}>
          {s.phrases}
        </FilterChip>
        {weak.map((label) => (
          <FilterChip
            key={label}
            pressed={mode === 'fonema' && phoneme === label}
            onPressedChange={() => choosePhoneme(label)}
          >
            <span aria-hidden="true">{`/${label}/`}</span>
            <span className="sr-only">
              {tr(s.phonemeChip, { phoneme: label })}
            </span>
          </FilterChip>
        ))}
      </div>

      <p className="small" role="status">
        {formatSpeechQuota(seconds)}
      </p>

      {quota !== 'ok' ? (
        <div className="callout" role="status">
          <Icon name="alert" size="sm" />
          <p className="small grow">{QUOTA_MESSAGES[quota]}</p>
        </div>
      ) : null}

      {!online ? (
        <div className="callout" role="status">
          <Icon name="offline" size="sm" />
          <p className="small grow">{s.offline}</p>
        </div>
      ) : null}

      {speechError !== null ? (
        <div className="callout error" role="alert">
          <Icon name="alert" size="sm" />
          <p className="small grow">{speechError}</p>
        </div>
      ) : null}

      {online ? (
        <Deck
          mode={mode}
          phoneme={phoneme}
          recognizer={recognizer}
          onPracticed={practiced}
        />
      ) : null}
    </div>
  );
}
