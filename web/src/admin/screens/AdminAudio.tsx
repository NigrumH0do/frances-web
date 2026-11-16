import { useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { toUiError } from '../../api/client';
import { useResource } from '../../api/useResource';
import { Button, Card, Chip, StateView, Switch } from '../../components';
import type { ChipTone } from '../../components';
import type { JobOut, VoiceOut } from '../../contracts/generated';
import { messageFor } from '../../l10n/errors';
import { audioStateLabel, audioStrings } from '../audioStrings';

type JobState = JobOut['state'];

function stateTone(state: JobState): ChipTone {
  if (state === 'failed') return 'danger';
  if (state === 'running') return 'warning';
  if (state === 'done') return 'success';
  return 'neutral';
}

export function AdminAudio() {
  const api = useApi();
  const strings = audioStrings;
  const voicesState = useResource('admin-audio-voices', (signal) =>
    api.voices({ signal }),
  );
  const queueState = useResource('admin-audio-queue', (signal) =>
    api.audioQueue({ signal }),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(voiceId: string, next: boolean): void {
    setNotice(null);
    setError(null);
    setSelected((previous) =>
      next
        ? [...previous.filter((id) => id !== voiceId), voiceId]
        : previous.filter((id) => id !== voiceId),
    );
  }

  async function save(): Promise<void> {
    if (selected.length === 0) {
      setNotice(null);
      setError(strings.needOne);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // `selected.length > 0` ya se comprobó arriba; el contrato exige una
      // tupla con al menos una voz.
      const voices = await api.setDefaultVoices({
        voice_ids: selected as [string, ...string[]],
      });
      setSelected(voices.map((voice) => voice.id));
      setNotice(strings.saved);
      queueState.reload();
    } catch (cause) {
      setError(messageFor(toUiError(cause)));
    } finally {
      setSaving(false);
    }
  }

  function Voices({ voices }: { voices: VoiceOut[] }) {
    return (
      <div className="stack">
        <p className="small muted">{strings.hint}</p>
        <ul className="list">
          {voices.map((voice) => (
            <li key={voice.id}>
              <div className="list-item">
                <span className="grow">
                  <span className="title">{voice.label}</span>
                  <br />
                  <span className="meta">{voice.accent}</span>
                </span>
                <Switch
                  label={voice.label}
                  checked={selected.includes(voice.id)}
                  onChange={(next) => toggle(voice.id, next)}
                />
              </div>
            </li>
          ))}
        </ul>
        <Button variant="primary" busy={saving} onClick={() => void save()}>
          {strings.save}
        </Button>
      </div>
    );
  }

  function Queue({ jobs }: { jobs: JobOut[] }) {
    return (
      <ul className="list">
        {jobs.map((job) => (
          <li key={job.id}>
            <div className="list-item">
              <span className="grow">
                <span className="title">{strings.jobKind}</span>
                <br />
                <span className="meta">
                  {strings.jobMeta(job.id, job.attempts, job.max_attempts)}
                </span>
              </span>
              <Chip tone={stateTone(job.state)}>
                {audioStateLabel(job.state)}
              </Chip>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="stack-lg">
      <h1>{strings.title}</h1>

      {notice !== null ? (
        <p className="callout info" role="status">
          {notice}
        </p>
      ) : null}
      {error !== null ? (
        <p className="callout error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="stack" aria-labelledby="admin-audio-voices">
        <div className="section-title">
          <h2 id="admin-audio-voices">{strings.voicesTitle}</h2>
        </div>
        <Card>
          <StateView
            state={voicesState}
            empty={(voices) => voices.length === 0}
            emptyText={strings.emptyVoices}
            onRetry={voicesState.reload}
          >
            {(voices) => <Voices voices={voices} />}
          </StateView>
        </Card>
      </section>

      <section className="stack" aria-labelledby="admin-audio-queue">
        <div className="section-title">
          <h2 id="admin-audio-queue">{strings.queueTitle}</h2>
        </div>
        <StateView
          state={queueState}
          empty={(jobs) => jobs.length === 0}
          emptyText={strings.emptyQueue}
          onRetry={queueState.reload}
        >
          {(jobs) => <Queue jobs={jobs} />}
        </StateView>
      </section>
    </div>
  );
}

export default AdminAudio;
