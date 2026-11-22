import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
} from 'react';
import { useApi } from '../../api/ApiContext';
import { Button, Icon } from '../../components';
import { cx } from '../../components/cx';
import type { PracticeTtsOut, PronResult } from '../../contracts/generated';
import { tr } from '../../l10n/es';
import { useBlobPlayer } from '../../media/useBlobPlayer';
import type { Recognizer } from '../../pron/recognizer';
import { createRecorder, type RecorderState } from '../../pron/recorder';
import { startTake, type Take } from '../../pron/take';
import { persistPracticeResult } from '../../ui/pron/PracticeSession';
import { ScoreSummary } from '../../ui/pron/ScoreSummary';
import { WordList } from '../../ui/pron/WordList';
import { textoStrings as s } from './strings';
import '../../ui/pron/pron.css';

// Palabra por debajo de este puntaje: se ofrece para oírla sola.
const REPEAT_BELOW = 70;
// Tope de una grabación sin evaluación.
const RECORD_ONLY_MAX_MS = 30_000;

type SoloState =
  | { status: 'idle' }
  | { status: 'recording' }
  | { status: 'error'; message: string };

// Panel «Pronúncialo». Con evaluación (Azure Speech) graba, puntúa y guarda el
// intento; además conserva la toma en memoria para oírse. Sin evaluación (sin
// recognizer o tras un fallo del servicio) igual deja grabarse y compararse
// con el modelo. La voz grabada nunca sale del navegador.
export function SpeakPanel({
  text,
  ready,
  recognizer,
  assessUnavailable,
  modelClip,
  clipFor,
  onPracticed,
}: {
  text: string;
  ready: boolean;
  recognizer: Recognizer | null;
  assessUnavailable: boolean;
  modelClip: PracticeTtsOut | null;
  clipFor: (text: string, signal: AbortSignal) => Promise<PracticeTtsOut>;
  onPracticed: () => void;
}): JSX.Element {
  const api = useApi();
  const headingId = useId();
  const statusId = useId();
  const player = useBlobPlayer();
  const [recState, setRecState] = useState<RecorderState>({ status: 'idle' });
  const [result, setResult] = useState<PronResult | null>(null);
  const [take, setTake] = useState<Blob | null>(null);
  const [solo, setSolo] = useState<SoloState>({ status: 'idle' });
  const soloRef = useRef<{
    take: Take | null;
    stream: MediaStream;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const recorderRef = useRef<ReturnType<typeof createRecorder> | null>(null);
  const onPracticedRef = useRef(onPracticed);
  onPracticedRef.current = onPracticed;

  const recordOnly = recognizer === null || assessUnavailable;

  useEffect(() => {
    if (recognizer === null) {
      recorderRef.current = null;
      return undefined;
    }
    let active = true;
    const recorder = createRecorder(recognizer, undefined, undefined, {
      captureTake: true,
    });
    recorderRef.current = recorder;
    const unsubscribe = recorder.subscribe((state) => {
      if (!active) return;
      setRecState(state);
      if (state.status !== 'done') return;
      const finished = state.result;
      setTake(state.take ?? null);
      persistPracticeResult(finished)
        .catch(() => undefined)
        .finally(() => {
          if (!active) return;
          setResult(finished);
          onPracticedRef.current();
        });
    });
    return () => {
      active = false;
      unsubscribe();
      recorder.abort();
      if (recorderRef.current === recorder) recorderRef.current = null;
    };
  }, [recognizer]);

  // Un texto nuevo deja atrás el resultado anterior.
  useEffect(() => {
    setResult(null);
    setTake(null);
    player.stop();
    recorderRef.current?.abort();
  }, [text, player.stop]);

  const stopSolo = useCallback(async () => {
    const current = soloRef.current;
    soloRef.current = null;
    if (current === null) return;
    clearTimeout(current.timer);
    const blob = current.take === null ? null : await current.take.stop();
    for (const track of current.stream.getTracks()) track.stop();
    setTake(blob);
    setSolo({ status: 'idle' });
  }, []);

  useEffect(
    () => () => {
      const current = soloRef.current;
      soloRef.current = null;
      if (current !== null) {
        clearTimeout(current.timer);
        current.take?.cancel();
        for (const track of current.stream.getTracks()) track.stop();
      }
    },
    [],
  );

  async function startSolo(): Promise<void> {
    setResult(null);
    setTake(null);
    player.stop();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setSolo({ status: 'error', message: s.micError });
      return;
    }
    const recording = startTake(stream);
    if (recording === null) {
      for (const track of stream.getTracks()) track.stop();
      setSolo({ status: 'error', message: s.micError });
      return;
    }
    soloRef.current = {
      take: recording,
      stream,
      timer: setTimeout(() => void stopSolo(), RECORD_ONLY_MAX_MS),
    };
    setSolo({ status: 'recording' });
  }

  function startAssess(): void {
    setResult(null);
    setTake(null);
    player.stop();
    void recorderRef.current?.start(text, null);
  }

  const busy =
    recState.status === 'requesting_mic' || recState.status === 'recording';
  const scoring =
    recState.status === 'scoring' ||
    (recState.status === 'done' && result === null);
  const soloRecording = solo.status === 'recording';
  const recording = recordOnly ? soloRecording : busy;

  function onMic(): void {
    if (recordOnly) {
      if (soloRecording) void stopSolo();
      else void startSolo();
      return;
    }
    if (busy) recorderRef.current?.abort();
    else startAssess();
  }

  const toRepeat =
    result === null
      ? []
      : result.words
          .map((word, index) => ({ word, index }))
          .filter(
            ({ word }) =>
              word.accuracy < REPEAT_BELOW && word.error_type !== 'Insertion',
          );

  function hearWord(word: string, id: string): void {
    void player.play(id, async (signal) => {
      const clip = await clipFor(word, signal);
      return api.client.blob(clip.url, { signal });
    });
  }

  let status = '';
  if (recState.status === 'requesting_mic') status = s.recording;
  else if (recording) status = s.recording;
  else if (scoring) status = '…';

  const micLabel = recording ? s.stop : recordOnly ? s.recordOnly : s.record;

  return (
    <section className="lab-panel lab-speak" aria-labelledby={headingId}>
      <div className="lab-panel-head">
        <h2 id={headingId}>{s.speakTitle}</h2>
      </div>
      <p className="small muted">{s.speakHint}</p>
      {recordOnly ? (
        <p className="callout info small">
          <Icon name="mic" size="sm" />
          <span className="grow">{s.recordOnlyNotice}</span>
        </p>
      ) : null}

      <div className="lab-record">
        <button
          type="button"
          className={cx('lab-mic', recording && 'is-recording')}
          aria-label={micLabel}
          aria-describedby={statusId}
          disabled={!ready || scoring}
          onClick={onMic}
        >
          <Icon name={recording ? 'stop' : 'mic'} />
        </button>
        <div className="lab-record-text">
          <strong aria-hidden="true">{micLabel}</strong>
          <span
            id={statusId}
            className="small muted"
            role="status"
            aria-live="polite"
          >
            {scoring ? (
              <span className="row">
                <span className="spinner" aria-hidden="true" />
                <span>Analizando audio…</span>
              </span>
            ) : (
              status
            )}
          </span>
        </div>
      </div>

      {recState.status === 'error' && result === null && !recordOnly ? (
        <p className="callout error small" role="alert">
          <Icon name="alert" size="sm" />
          <span className="grow">{recState.message}</span>
        </p>
      ) : null}
      {solo.status === 'error' ? (
        <p className="callout error small" role="alert">
          <Icon name="alert" size="sm" />
          <span className="grow">{solo.message}</span>
        </p>
      ) : null}

      {take !== null || result !== null ? (
        <div className="lab-compare">
          {take !== null ? (
            <Button
              variant="secondary"
              icon={player.playingId === 'mine' ? 'stop' : 'play'}
              aria-pressed={player.playingId === 'mine'}
              onClick={() =>
                player.playingId === 'mine'
                  ? player.stop()
                  : void player.play('mine', take)
              }
            >
              {player.playingId === 'mine' ? s.stopMine : s.listenMine}
            </Button>
          ) : null}
          {modelClip !== null ? (
            <Button
              variant="tonal"
              icon={player.playingId === 'model' ? 'stop' : 'play'}
              aria-pressed={player.playingId === 'model'}
              onClick={() =>
                player.playingId === 'model'
                  ? player.stop()
                  : void player.play('model', (signal) =>
                      api.client.blob(modelClip.url, { signal }),
                    )
              }
            >
              {s.listenModel}
            </Button>
          ) : null}
        </div>
      ) : null}

      {result !== null ? (
        <div className="stack-lg lab-result">
          <ScoreSummary scores={result.scores} />
          <div className="stack">
            <WordList words={result.words} />
          </div>
          <div className="stack">
            <h3>{s.wordsToRepeat}</h3>
            {toRepeat.length === 0 ? (
              <p className="small muted">{s.allGood}</p>
            ) : (
              <>
                <p className="small muted">{s.wordHint}</p>
                <div className="row wrap">
                  {toRepeat.map(({ word, index }) => {
                    const id = `word:${index}`;
                    return (
                      <button
                        key={id}
                        type="button"
                        className="chip chip-filter lab-word"
                        lang="fr"
                        aria-label={tr(s.hearWord, { word: word.word })}
                        aria-pressed={player.playingId === id}
                        onClick={() => hearWord(word.word, id)}
                      >
                        <Icon
                          name={player.playingId === id ? 'stop' : 'play'}
                          size="sm"
                        />
                        {word.word}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <Button variant="ghost" icon="repasar" onClick={startAssess}>
            {s.tryAgain}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
