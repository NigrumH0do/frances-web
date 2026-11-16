import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { toUiError } from '../../api/client';
import { useResource } from '../../api/useResource';
import { Button, Card, StateView } from '../../components';
import { messageFor } from '../../l10n/errors';
import { CardAudio } from '../../media/CardAudio';
import { useVoices } from '../../media/useVoices';
import { voiceParts } from '../../ui/AudioPlayer';
import { masStrings } from './strings';

// Voces disponibles con una muestra de la cola y la elección de preferidas.
// El orden de preferencia lo guarda `useVoices().setPreferred` completo: el
// servidor reemplaza el objeto `UserPrefs`, no una clave suelta.
export function VoicesSection() {
  const api = useApi();
  const strings = masStrings.voices;
  const voicesState = useResource('mas-voices', (signal) =>
    api.voices({ signal }),
  );
  const sampleState = useResource('mas-voice-sample', (signal) =>
    api.reviewQueue(20, { signal }),
  );
  const { preferred, setPreferred } = useVoices();
  const [order, setOrder] = useState<string[]>(preferred);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // `useVoices` devuelve un arreglo nuevo mientras las preferencias cargan;
  // la clave evita un bucle de renders sin perder los cambios del usuario.
  const preferredKey = preferred.join('\u0000');

  useEffect(() => {
    if (!dirty) setOrder(preferred);
  }, [dirty, preferredKey]);

  function clearMessages(): void {
    setError(null);
    setSaved(false);
  }

  function toggleVoice(id: string, checked: boolean): void {
    setDirty(true);
    clearMessages();
    setOrder((previous) =>
      checked
        ? [...previous.filter((voiceId) => voiceId !== id), id]
        : previous.filter((voiceId) => voiceId !== id),
    );
  }

  function moveVoice(id: string, delta: -1 | 1): void {
    setDirty(true);
    clearMessages();
    setOrder((previous) => {
      const index = previous.indexOf(id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= previous.length) {
        return previous;
      }
      const next = [...previous];
      const current = next[index];
      const other = next[target];
      if (current === undefined || other === undefined) return previous;
      next[index] = other;
      next[target] = current;
      return next;
    });
  }

  async function save(): Promise<void> {
    setSaving(true);
    clearMessages();
    try {
      await setPreferred(order);
      setDirty(false);
      setSaved(true);
    } catch (cause) {
      setError(messageFor(toUiError(cause)));
    } finally {
      setSaving(false);
    }
  }

  const sample =
    sampleState.status === 'ready'
      ? sampleState.data.find((card) =>
          card.audio.some((clip) => clip.field === 'front'),
        )
      : undefined;

  return (
    <section className="stack" aria-labelledby="mas-voices-title">
      <div className="section-title">
        <h2 id="mas-voices-title">{strings.title}</h2>
      </div>

      <StateView
        state={voicesState}
        empty={(voices) => voices.length === 0}
        emptyText={strings.empty}
        onRetry={voicesState.reload}
      >
        {(voices) => {
          const byId = new Map(voices.map((voice) => [voice.id, voice]));
          return (
            <div className="stack">
              {sample !== undefined ? (
                <Card tight>
                  <p className="small muted">{strings.sample}</p>
                  <CardAudio card={sample} field="front" />
                </Card>
              ) : null}

              <p className="small muted">{strings.hint}</p>

              <ul className="list">
                {voices.map((voice) => (
                  <li key={voice.id}>
                    <label className="list-item">
                      <input
                        type="checkbox"
                        aria-label={strings.preferred(voiceParts(voice).name)}
                        checked={order.includes(voice.id)}
                        onChange={(event) =>
                          toggleVoice(voice.id, event.target.checked)
                        }
                      />
                      <span className="grow">
                        <span className="title">{voiceParts(voice).name}</span>
                        <br />
                        <span className="meta">
                          {voiceParts(voice).details}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              <h3>{strings.order}</h3>
              {order.length === 0 ? (
                <p className="small muted">{strings.noPreferred}</p>
              ) : (
                <ol className="list">
                  {order.map((id, index) => {
                    const voice = byId.get(id);
                    const label =
                      voice === undefined ? id : voiceParts(voice).name;
                    return (
                      <li key={id}>
                        <div className="list-item">
                          <span className="grow">{label}</span>
                          <Button
                            variant="secondary"
                            aria-label={strings.up(label)}
                            disabled={index === 0}
                            onClick={() => moveVoice(id, -1)}
                          >
                            Subir
                          </Button>
                          <Button
                            variant="secondary"
                            aria-label={strings.down(label)}
                            disabled={index === order.length - 1}
                            onClick={() => moveVoice(id, 1)}
                          >
                            Bajar
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              {error !== null ? (
                <p className="callout error" role="alert">
                  {error}
                </p>
              ) : null}
              {saved ? (
                <p className="callout info" role="status">
                  {strings.saved}
                </p>
              ) : null}

              <Button
                variant="primary"
                busy={saving}
                onClick={() => void save()}
              >
                {strings.save}
              </Button>
            </div>
          );
        }}
      </StateView>
    </section>
  );
}

export default VoicesSection;
