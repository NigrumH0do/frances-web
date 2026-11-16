import { useId, useMemo, useState, type JSX } from 'react';
import { useApi } from '../../api/ApiContext';
import { Button, Icon } from '../../components';
import type { VoiceOut } from '../../contracts/generated';
import {
  cancelBrowserSpeech,
  speakWithBrowser,
  useBrowserFrenchVoice,
} from '../../media/browserTts';
import { ClipPlayer, voiceLabel } from '../../ui/AudioPlayer';
import { textoStrings as s } from './strings';
import type { ModelAudioState } from './useModelAudio';

// Panel «Escúchalo»: voz del modelo, estado del audio y reproductor. Si el
// servidor no puede dar el audio, ofrece la voz francesa del navegador.
export function ModelPanel({
  state,
  text,
  hasText,
  voices,
  voiceId,
  onVoice,
  onRetry,
}: {
  state: ModelAudioState;
  text: string;
  hasText: boolean;
  voices: VoiceOut[];
  voiceId: string | null;
  onVoice: (id: string) => void;
  onRetry: () => void;
}): JSX.Element {
  const api = useApi();
  const headingId = useId();
  const selectId = useId();
  const [speaking, setSpeaking] = useState(false);
  const canUseBrowser = useBrowserFrenchVoice();

  const clips = useMemo(
    () =>
      state.status === 'ready'
        ? [
            {
              voice_id: state.clip.voice_id,
              load: (signal: AbortSignal) =>
                api.client.blob(state.clip.url, { signal }),
            },
          ]
        : [],
    [api, state],
  );

  function speakInBrowser(): void {
    if (speaking) {
      cancelBrowserSpeech();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speakWithBrowser(text).then(
      () => setSpeaking(false),
      () => setSpeaking(false),
    );
  }

  let body: JSX.Element;
  if (state.status === 'ready') {
    body = (
      <div className="stack">
        <ClipPlayer
          key={state.clip.cache_key}
          clips={clips}
          pendingVoiceIds={[]}
          voices={voices}
          preferred={null}
        />
        <p className="xs muted">{s.autoHint}</p>
      </div>
    );
  } else if (state.status === 'waiting' || state.status === 'loading') {
    body = (
      <p className="row lab-status" role="status">
        <span className="spinner" aria-hidden="true" />
        <span>{s.generating}</span>
      </p>
    );
  } else if (state.status === 'error') {
    // Solo se promete la voz del navegador si hay una voz francesa instalada.
    const message =
      state.error === 'offline'
        ? canUseBrowser
          ? s.offline
          : s.offlineNoBrowser
        : state.error === 'rate_limited'
          ? s.rateLimited
          : canUseBrowser
            ? s.browserNotice
            : s.unavailable;
    body = (
      <div className="stack">
        <div className="callout" role="status">
          <Icon
            name={state.error === 'offline' ? 'offline' : 'alert'}
            size="sm"
          />
          <p className="small grow">{message}</p>
        </div>
        <div className="row wrap">
          {canUseBrowser ? (
            <Button
              variant="secondary"
              icon={speaking ? 'stop' : 'play'}
              aria-pressed={speaking}
              onClick={speakInBrowser}
            >
              {s.browserVoice}
            </Button>
          ) : null}
          {state.error !== 'offline' ? (
            <Button variant="ghost" onClick={onRetry}>
              {s.retry}
            </Button>
          ) : null}
        </div>
      </div>
    );
  } else {
    body = (
      <p className="small muted lab-status">
        {hasText ? s.needsLetters : s.emptyHint}
      </p>
    );
  }

  return (
    <section className="lab-panel" aria-labelledby={headingId}>
      <div className="lab-panel-head">
        <h2 id={headingId}>{s.listenTitle}</h2>
        {voices.length > 0 ? (
          <span className="lab-voice">
            <label htmlFor={selectId} className="sr-only">
              {s.voiceLabel}
            </label>
            <select
              id={selectId}
              className="select select-pill"
              value={voiceId ?? ''}
              onChange={(event) => onVoice(event.target.value)}
            >
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voiceLabel(voice)}
                </option>
              ))}
            </select>
          </span>
        ) : null}
      </div>
      {body}
    </section>
  );
}
