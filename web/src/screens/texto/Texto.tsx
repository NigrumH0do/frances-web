import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { AppBar, Icon } from '../../components';
import { tr } from '../../l10n/es';
import { useVoices } from '../../media/useVoices';
import { useOffline } from '../../offline/OfflineContext';
import {
  useDeviceQuota,
  usePracticeRecognizer,
} from '../../pron/practiceHooks';
import { formatSpeechQuota } from '../../pron/quota';
import { pickVoice } from '../../ui/AudioPlayer';
import { ReviewTabs } from '../repasar/ReviewTabs';
import { forgetText, loadHistory, rememberText } from './history';
import { ModelPanel } from './ModelPanel';
import { SpeakPanel } from './SpeakPanel';
import { STARTER_PHRASES, textoStrings as s } from './strings';
import { TextEditor } from './TextEditor';
import {
  cleanPracticeText,
  hasLetters,
  PRACTICE_TEXT_MAX,
  useModelAudio,
} from './useModelAudio';
import './texto.css';

/**
 * Texto libre (PRACTICE-01): el usuario escribe en francés, la app genera el
 * audio modelo sola cuando deja de escribir y el usuario se graba para ver qué
 * tan bien lo pronunció. `?texto=` precarga el editor.
 */
export default function Texto(): JSX.Element {
  const { user } = useAuth();
  const userId = user?.id ?? 'anon';
  const { online } = useOffline();
  const [params] = useSearchParams();
  const [text, setText] = useState(() =>
    (params.get('texto') ?? '').slice(0, PRACTICE_TEXT_MAX),
  );
  const { voices, preferred } = useVoices();
  const [chosenVoice, setChosenVoice] = useState<string | null>(null);
  const voiceId =
    chosenVoice ??
    pickVoice(
      voices.map((voice) => voice.id),
      preferred,
      undefined,
    );

  const model = useModelAudio(text, voiceId, { online });
  const clean = cleanPracticeText(text);
  const ready = clean !== '' && hasLetters(clean);

  const [history, setHistory] = useState(() => loadHistory(userId));
  const readyText =
    model.state.status === 'ready' ? model.state.clip.text : null;
  useEffect(() => {
    if (readyText !== null) setHistory(rememberText(userId, readyText));
  }, [readyText, userId]);

  const { recognizer, speechError, clearSpeechError } = usePracticeRecognizer();
  const { seconds, refresh: refreshQuota } = useDeviceQuota();
  const practiced = useCallback(() => refreshQuota(), [refreshQuota]);

  const changeText = useCallback(
    (next: string) => {
      clearSpeechError();
      setText(next);
    },
    [clearSpeechError],
  );

  const recent = useMemo(
    () => history.filter((entry) => entry.text !== clean),
    [clean, history],
  );

  return (
    <div className="stack-lg lab">
      <AppBar title={s.title} subtitle={s.subtitle} />
      <ReviewTabs active="texto" />

      <div className="lab-grid">
        <div className="stack-lg">
          <TextEditor
            value={text}
            max={PRACTICE_TEXT_MAX}
            onChange={changeText}
          />

          {text.trim() === '' ? (
            <section className="stack">
              <h2 className="lab-subtitle">{s.starters}</h2>
              <div className="lab-starters">
                {STARTER_PHRASES.map((phrase) => (
                  <button
                    key={phrase}
                    type="button"
                    className="lab-starter"
                    lang="fr"
                    onClick={() => changeText(phrase)}
                  >
                    {phrase}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <ModelPanel
            state={model.state}
            text={clean}
            hasText={clean !== ''}
            voices={voices}
            voiceId={voiceId}
            onVoice={setChosenVoice}
            onRetry={model.generate}
          />
        </div>

        <div className="stack-lg">
          <SpeakPanel
            text={clean}
            ready={ready && online}
            recognizer={recognizer}
            assessUnavailable={speechError !== null || !online}
            modelClip={model.state.status === 'ready' ? model.state.clip : null}
            clipFor={model.clipFor}
            onPracticed={practiced}
          />
          {speechError !== null ? (
            <p className="small muted" role="status">
              {speechError}
            </p>
          ) : (
            <p className="xs muted">{formatSpeechQuota(seconds)}</p>
          )}

          {recent.length > 0 ? (
            <section className="stack">
              <h2 className="lab-subtitle">{s.history}</h2>
              <ul className="list lab-history">
                {recent.map((entry) => (
                  <li key={entry.text}>
                    <div className="list-item">
                      <button
                        type="button"
                        className="lab-history-text grow"
                        lang="fr"
                        aria-label={tr(s.useText, { text: entry.text })}
                        onClick={() => changeText(entry.text)}
                      >
                        {entry.text}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        aria-label={tr(s.removeText, { text: entry.text })}
                        onClick={() =>
                          setHistory(forgetText(userId, entry.text))
                        }
                      >
                        <Icon name="x" size="sm" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
