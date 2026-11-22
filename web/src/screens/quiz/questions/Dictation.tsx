import { useMemo } from 'react';
import { useApi } from '../../../api/ApiContext';
import { Field } from '../../../components';
import { ClipPlayer, type PlayableClip } from '../../../ui/AudioPlayer';
import { quizStrings } from '../strings';
import type { QuestionProps } from './types';

export function Dictation({ q, value, onChange }: QuestionProps<string>) {
  const api = useApi();
  const audio = q.audio;
  const clips = useMemo<PlayableClip[]>(() => {
    if (audio === null) return [];
    return [
      {
        voice_id: audio.voice_id,
        load: (signal) => api.client.blob(audio.url, { signal }),
      },
    ];
  }, [api, audio]);

  return (
    <fieldset className="stack">
      <legend className="quiz-q">{q.prompt_es}</legend>
      <div className="quiz-answer" key={q.id}>
        {audio === null ? (
          <p className="small muted">{quizStrings.audioUnavailable}</p>
        ) : (
          <ClipPlayer
            clips={clips}
            pendingVoiceIds={[]}
            voices={[]}
            preferred={null}
          />
        )}
        <Field
          label={quizStrings.dictationLabel}
          hint={quizStrings.dictationHint}
        >
          <input
            className="input fr"
            lang="fr"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </div>
    </fieldset>
  );
}
