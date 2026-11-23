// Sesión de práctica de una tarjeta (Task PRN-03), reutilizada por el
// taladro (PRN-05).
//
// Muestra la frase en francés con su audio modelo, graba con un `Recorder`
// (uno por montaje y tarjeta) y, al terminar, guarda el intento, actualiza
// la estadística EMA por fonema y suma los segundos a la cuota del mes antes
// de mostrar los puntajes. «Grabar» (o la barra espaciadora) inicia; mientras
// graba el botón es «Detener» (`abort`). Tras un resultado, «Repetir» vuelve
// a llamar a `start()` en el mismo `Recorder` y «Siguiente» llama a `onNext`.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type {
  AudioPending,
  AudioRef,
  PronResult,
} from '../../contracts/generated';
import { saveAttempt } from '../../pron/attempts';
import { addSeconds, monthOf, secondsOf } from '../../pron/quota';
import type { Recognizer } from '../../pron/recognizer';
import { useBlobPlayer } from '../../media/useBlobPlayer';
import { usePracticeLevelMeter } from '../../pron/practiceHooks';
import { createRecorder } from '../../pron/recorder';
import type { Recorder, RecorderState } from '../../pron/recorder';
import { isCanonicalPhoneme } from '../../pron/phonemeLabels';
import { loadStats, saveStats, updateStats } from '../../pron/stats';
import { AcousticCabin } from './AcousticCabin';
import { ScoreSummary } from './ScoreSummary';
import { WordList } from './WordList';
import './pron.css';

// Cadenas propias de P06 (R-18): no van a `es.ts`.
export const PRACTICE_MESSAGES = {
  record: 'Grabar',
  stop: 'Detener',
  repeat: 'Repetir',
  listenMine: 'Escucharme',
  next: 'Siguiente',
  unavailable:
    'La evaluación de pronunciación no está disponible en este bundle',
  requesting_mic: 'Pidiendo permiso del micrófono…',
  recording: 'Grabando… Analizando audio…',
  scoring: 'Evaluando tu pronunciación…',
  analyzing: 'Analizando audio…',
  done: 'Listo',
  saveFailed: 'No se pudo guardar el intento en este dispositivo',
} as const;

// Azure deja `Phoneme` vacío con audio sintético (ADR-004): esos fonemas no
// tienen etiqueta canónica y no deben entrar en la estadística por fonema.
function labeledPhonemesOnly(result: PronResult): PronResult {
  return {
    ...result,
    words: result.words.map((word) => ({
      ...word,
      phonemes: word.phonemes.filter((p) => isCanonicalPhoneme(p.phoneme)),
    })),
  };
}

// Guarda el intento, la estadística por fonema y la cuota del mes. La usan la
// sesión de tarjetas y el texto libre.
export async function persistPracticeResult(result: PronResult): Promise<void> {
  await saveAttempt(result);
  const stats = await loadStats();
  await saveStats(updateStats(stats, labeledPhonemesOnly(result)));
  await addSeconds(monthOf(new Date()), secondsOf(result.duration_ms));
}

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target.closest('button, a, input, select, textarea, [role="button"]') !==
      null
  );
}

// Lo mínimo que la sesión necesita de una tarjeta. `CardOut` y `CardView` lo
// cumplen. Los campos de audio son opcionales y los pinta el llamador en el
// slot `audio` (v2, UI-11).
export type PracticeCard = {
  id: string;
  front_fr: string;
  back_es: string | null;
  audio?: AudioRef[];
  audio_pending?: AudioPending;
};

export function PracticeSession({
  card,
  recognizer,
  onFinished,
  onNext,
  audio,
}: {
  card: PracticeCard;
  recognizer: Recognizer | null;
  onFinished?: (r: PronResult) => void;
  onNext?: () => void;
  // Reproductor del campo «front» (v2: `CardAudio` de UI-11).
  audio?: ReactNode;
}): JSX.Element {
  const [recState, setRecState] = useState<RecorderState>({
    status: 'idle',
  });
  const [result, setResult] = useState<PronResult | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [take, setTake] = useState<Blob | null>(null);
  const player = useBlobPlayer();
  const { meterRef } = usePracticeLevelMeter();
  const recorderRef = useRef<Recorder | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    if (recognizer === null) {
      recorderRef.current = null;
      return undefined;
    }
    let active = true;
    const recorder = createRecorder(recognizer, undefined, undefined, {
      captureTake: true,
      meterRef,
    });
    recorderRef.current = recorder;
    setRecState(recorder.getState());
    setResult(null);
    setSaveFailed(false);
    const unsubscribe = recorder.subscribe((state) => {
      if (!active) {
        return;
      }
      setRecState(state);
      if (state.status !== 'done') {
        return;
      }
      const finished = state.result;
      setTake(state.take ?? null);
      persistPracticeResult(finished)
        .then(
          () => false,
          () => true,
        )
        .then((failed) => {
          if (!active) {
            return;
          }
          setSaveFailed(failed);
          setResult(finished);
          onFinishedRef.current?.(finished);
        });
    });
    return () => {
      active = false;
      unsubscribe();
      recorder.abort();
      if (recorderRef.current === recorder) {
        recorderRef.current = null;
      }
    };
  }, [recognizer, card.id]);

  const busy =
    recState.status === 'requesting_mic' || recState.status === 'recording';
  const scoring =
    recState.status === 'scoring' ||
    (recState.status === 'done' && result === null);

  const record = useCallback((): void => {
    const recorder = recorderRef.current;
    if (recorder === null) {
      return;
    }
    setResult(null);
    setSaveFailed(false);
    setTake(null);
    player.stop();
    void recorder.start(card.front_fr, card.id);
  }, [card.front_fr, card.id, player]);

  const stop = useCallback((): void => {
    recorderRef.current?.abort();
  }, []);

  useEffect(() => {
    if (recognizer === null || result !== null || scoring) {
      return undefined;
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== ' ' && event.key !== 'Spacebar') {
        return;
      }
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isInteractive(event.target)
      ) {
        return;
      }
      event.preventDefault();
      if (busy) {
        stop();
      } else {
        record();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [recognizer, result, scoring, busy, record, stop]);

  let statusText = '';
  if (result !== null) {
    statusText = PRACTICE_MESSAGES.done;
  } else if (scoring) {
    statusText = PRACTICE_MESSAGES.scoring;
  } else if (recState.status === 'requesting_mic') {
    statusText = PRACTICE_MESSAGES.requesting_mic;
  } else if (recState.status === 'recording') {
    statusText = PRACTICE_MESSAGES.recording;
  }

  const analyzing =
    recState.status === 'recording' ||
    scoring ||
    recState.status === 'requesting_mic';

  return (
    <div className="practice-session">
      <AcousticCabin
        active={busy}
        score={result?.scores.pron}
        meterRef={meterRef}
        onToggle={busy ? stop : record}
        showButton={recognizer !== null && result === null && !scoring}
      />
      <p lang="fr" className="practice-front paper">
        {card.front_fr}
      </p>
      {card.back_es !== null && <p>{card.back_es}</p>}
      {audio}
      {recognizer === null ? (
        <p>{PRACTICE_MESSAGES.unavailable}</p>
      ) : (
        <>
          {analyzing ? (
            <p
              className="callout info practice-analyzing"
              role="status"
              aria-live="polite"
            >
              <span className="practice-analyzing-dot" aria-hidden="true" />
              <span>{statusText}</span>
            </p>
          ) : (
            <p aria-live="polite" className="practice-status">
              {statusText}
            </p>
          )}
          {recState.status === 'error' && result === null && (
            <p role="alert">{recState.message}</p>
          )}
          {saveFailed && <p role="alert">{PRACTICE_MESSAGES.saveFailed}</p>}
          {result !== null && (
            <>
              <ScoreSummary scores={result.scores} />
              <WordList words={result.words} />
              <div className="practice-actions">
                {take !== null ? (
                  <button
                    type="button"
                    aria-pressed={player.playingId === 'take'}
                    onClick={() =>
                      player.playingId === 'take'
                        ? player.stop()
                        : void player.play('take', take)
                    }
                  >
                    {PRACTICE_MESSAGES.listenMine}
                  </button>
                ) : null}
                <button type="button" onClick={record}>
                  {PRACTICE_MESSAGES.repeat}
                </button>
                <button type="button" onClick={() => onNext?.()}>
                  {PRACTICE_MESSAGES.next}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default PracticeSession;
