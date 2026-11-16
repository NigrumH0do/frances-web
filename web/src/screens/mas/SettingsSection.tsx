import { useEffect, useState, type KeyboardEvent } from 'react';
import { useApi } from '../../api/ApiContext';
import { OfflineError, toUiError } from '../../api/client';
import { useResource } from '../../api/useResource';
import {
  Card,
  Field,
  Segmented,
  StateView,
  Switch,
  type SegmentedOption,
} from '../../components';
import type { Theme, UserPrefs } from '../../contracts/generated';
import { applyTheme } from '../../design/theme';
import { messageFor } from '../../l10n/errors';
import { prefetchForOffline } from '../../offline/prefetch';
import { getOfflineAudio, setOfflineAudio } from '../../offline/settings';
import { masStrings } from './strings';

type DailyChoice = '5' | '10' | '20' | '30' | 'custom';

const DAILY_VALUES = [5, 10, 20, 30] as const;

function normalize(prefs: UserPrefs): UserPrefs {
  return {
    preferred_voice_ids: prefs.preferred_voice_ids ?? [],
    daily_new_cards: prefs.daily_new_cards ?? 10,
    theme: prefs.theme ?? 'system',
  };
}

function SettingsForm({ initial }: { initial: UserPrefs }) {
  const api = useApi();
  const strings = masStrings.settings;
  const [current, setCurrent] = useState(initial);
  const [dailyDraft, setDailyDraft] = useState(
    String(initial.daily_new_cards ?? 10),
  );
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offlineAudio, setOfflineAudioState] = useState(false);
  const [prefetch, setPrefetch] = useState<
    'idle' | 'working' | 'done' | 'error'
  >('idle');

  useEffect(() => {
    let alive = true;
    getOfflineAudio().then(
      (enabled) => {
        if (alive) setOfflineAudioState(enabled);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  async function persist(next: UserPrefs): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      const saved = normalize(await api.savePrefs(next));
      setCurrent(saved);
      setDailyDraft(String(saved.daily_new_cards ?? 10));
      setNotice(strings.saved);
    } catch (cause) {
      if (cause instanceof OfflineError) {
        setNotice(strings.offlineSaved);
      } else {
        setError(messageFor(toUiError(cause)));
      }
    }
  }

  function changeTheme(theme: Theme): void {
    const next = { ...current, theme };
    setCurrent(next);
    applyTheme(theme);
    void persist(next);
  }

  function changeDailyChoice(choice: DailyChoice): void {
    if (choice === 'custom') return;
    const value = Number(choice);
    setDailyDraft(String(value));
    setDailyError(null);
    const next = { ...current, daily_new_cards: value };
    setCurrent(next);
    void persist(next);
  }

  function commitDaily(): void {
    if (dailyDraft.trim() === '') {
      setDailyError(strings.dailyInvalid);
      return;
    }
    const value = Number(dailyDraft);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      setDailyError(strings.dailyInvalid);
      return;
    }
    setDailyError(null);
    if (value === current.daily_new_cards) return;
    const next = { ...current, daily_new_cards: value };
    setCurrent(next);
    void persist(next);
  }

  function dailyKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDaily();
    }
  }

  async function toggleOfflineAudio(enabled: boolean): Promise<void> {
    setOfflineAudioState(enabled);
    setError(null);
    setNotice(null);
    try {
      await setOfflineAudio(enabled);
    } catch {
      setOfflineAudioState(!enabled);
      setError(strings.offlineAudioError);
      return;
    }
    if (!enabled) {
      setPrefetch('idle');
      return;
    }

    setPrefetch('working');
    try {
      await prefetchForOffline(api, { audio: true });
      setPrefetch('done');
    } catch {
      setPrefetch('error');
    }
  }

  const dailyNewCards = current.daily_new_cards ?? 10;
  const dailyChoice: DailyChoice = (DAILY_VALUES as readonly number[]).includes(
    dailyNewCards,
  )
    ? (String(dailyNewCards) as DailyChoice)
    : 'custom';

  const dailyOptions: SegmentedOption<DailyChoice>[] = [
    { value: '5', label: '5' },
    { value: '10', label: '10' },
    { value: '20', label: '20' },
    { value: '30', label: '30' },
    { value: 'custom', label: strings.dailyOther },
  ];

  return (
    <Card>
      <div className="stack">
        {error !== null ? (
          <p className="callout error" role="alert">
            {error}
          </p>
        ) : null}
        {notice !== null ? (
          <p className="callout info" role="status">
            {notice}
          </p>
        ) : null}

        <h3>{strings.theme}</h3>
        <Segmented
          label={strings.theme}
          options={[
            { value: 'system', label: strings.themeSystem },
            { value: 'light', label: strings.themeLight },
            { value: 'dark', label: strings.themeDark },
          ]}
          value={current.theme ?? 'system'}
          onChange={changeTheme}
        />

        <h3>{strings.daily}</h3>
        <Segmented
          label={strings.daily}
          options={dailyOptions}
          value={dailyChoice}
          onChange={changeDailyChoice}
        />
        <Field
          label={strings.dailyExact}
          hint={strings.dailyHint}
          error={dailyError ?? undefined}
        >
          <input
            className="input"
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            value={dailyDraft}
            onChange={(event) => {
              setDailyDraft(event.target.value);
              setDailyError(null);
            }}
            onBlur={commitDaily}
            onKeyDown={dailyKeyDown}
          />
        </Field>

        <div className="row-between wrap">
          <div className="grow">
            <p>{strings.offlineAudio}</p>
            <p className="small muted">{strings.offlineAudioHint}</p>
          </div>
          <Switch
            label={strings.offlineAudio}
            checked={offlineAudio}
            onChange={(next) => void toggleOfflineAudio(next)}
          />
        </div>
        {prefetch === 'working' ? (
          <p className="row small" role="status">
            <span className="spinner" aria-hidden="true" />
            {strings.prefetching}
          </p>
        ) : null}
        {prefetch === 'done' ? (
          <p className="callout info" role="status">
            {strings.prefetched}
          </p>
        ) : null}
        {prefetch === 'error' ? (
          <p className="callout error" role="alert">
            {strings.prefetchError}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

// Ajustes del usuario: el tema se aplica al instante y se guarda en el
// servidor; sin conexión el cambio queda solo en este dispositivo (no pasa
// por la cola de escrituras). El interruptor de audios es del dispositivo.
export function SettingsSection() {
  const api = useApi();
  const strings = masStrings.settings;
  const prefs = useResource('mas-prefs', (signal) => api.prefs({ signal }));

  return (
    <section className="stack" aria-labelledby="mas-settings-title">
      <div className="section-title">
        <h2 id="mas-settings-title">{strings.title}</h2>
      </div>
      <StateView state={prefs} emptyText={strings.empty} onRetry={prefs.reload}>
        {(data) => <SettingsForm initial={normalize(data)} />}
      </StateView>
    </section>
  );
}

export default SettingsSection;
