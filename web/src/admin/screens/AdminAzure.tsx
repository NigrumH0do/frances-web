import { useState, type FormEvent } from 'react';
import { useApi } from '../../api/ApiContext';
import { HttpError, toUiError } from '../../api/client';
import { useResource } from '../../api/useResource';
import {
  AppBar,
  Button,
  Card,
  Chip,
  Dialog,
  Field,
  Segmented,
  StateView,
} from '../../components';
import type { ChipTone, SegmentedOption } from '../../components';
import { cx } from '../../components/cx';
import type {
  AzureAccountOut,
  AzurePoolSummary,
} from '../../contracts/generated';
import { messageFor } from '../../l10n/errors';
import {
  azureStrings as s,
  usagePercent,
  type AzureAccountKind,
  type AzurePoolStrategy,
} from '../azureStrings';

const STRATEGY_OPTIONS: SegmentedOption<AzurePoolStrategy>[] = [
  { value: 'priority', label: s.strategies.priority },
  { value: 'least_used', label: s.strategies.least_used },
];

const KIND_OPTIONS: SegmentedOption<AzureAccountKind>[] = [
  { value: 'speech', label: s.kinds.speech },
  { value: 'translator', label: s.kinds.translator },
];

function errText(cause: unknown): string {
  if (cause instanceof HttpError && cause.messageEs !== '') {
    return cause.messageEs;
  }
  return messageFor(toUiError(cause));
}

function accountStatusChip(acc: AzureAccountOut): {
  tone: ChipTone;
  label: string;
} {
  if (!acc.enabled) {
    return { tone: 'danger', label: s.statusDisabled };
  }
  if (
    acc.cooldown_until !== undefined &&
    acc.cooldown_until !== null &&
    Date.parse(acc.cooldown_until) > Date.now()
  ) {
    return { tone: 'warning', label: s.statusCooldown };
  }
  return { tone: 'success', label: s.statusActive };
}

function UsageBar({
  label,
  detail,
  used,
  cap,
}: {
  label: string;
  detail: string;
  used: number;
  cap: number;
}) {
  const pct = usagePercent(used, cap);
  return (
    <div className="stack">
      <div className="row-between">
        <span className="small">{label}</span>
        <span className="small muted nums">{detail}</span>
      </div>
      <div
        className="usage-meter"
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cx('usage-meter-fill', pct >= 80 && 'warn')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SummarySection({
  summary,
  strategyBusy,
  onStrategyChange,
}: {
  summary: AzurePoolSummary;
  strategyBusy: boolean;
  onStrategyChange: (strategy: AzurePoolStrategy) => void;
}) {
  return (
    <section className="stack" aria-labelledby="azure-summary-heading">
      <div className="section-title">
        <h2 id="azure-summary-heading">{s.summaryTitle}</h2>
        <span className="small muted">{summary.month}</span>
      </div>

      {!summary.encryption_ready ? (
        <div className="callout" role="status">
          <p className="small">{s.encryptionMissing}</p>
        </div>
      ) : null}

      <div className="azure-grid">
        <Card>
          <div className="stack">
            <UsageBar
              label={s.sttLabel}
              detail={s.secondsProgress(
                summary.stt_seconds_used,
                summary.stt_seconds_cap,
              )}
              used={summary.stt_seconds_used}
              cap={summary.stt_seconds_cap}
            />
            <span className="xs muted nums">
              {s.activePool(summary.speech_active, summary.speech_accounts)}
            </span>
          </div>
        </Card>

        <Card>
          <div className="stack">
            <UsageBar
              label={s.ttsLabel}
              detail={s.charsProgress(
                summary.tts_chars_used,
                summary.tts_chars_cap,
              )}
              used={summary.tts_chars_used}
              cap={summary.tts_chars_cap}
            />
            <span className="xs muted nums">
              {s.activePool(summary.speech_active, summary.speech_accounts)}
            </span>
          </div>
        </Card>

        <Card>
          <div className="stack">
            <UsageBar
              label={s.translatorLabel}
              detail={s.charsProgress(
                summary.translator_chars_used,
                summary.translator_chars_cap,
              )}
              used={summary.translator_chars_used}
              cap={summary.translator_chars_cap}
            />
            <span className="xs muted nums">
              {s.activePool(
                summary.translator_active,
                summary.translator_accounts,
              )}
            </span>
          </div>
        </Card>
      </div>

      <Card>
        <div className="stack">
          <span className="small muted">{s.strategyLabel}</span>
          <Segmented
            label={s.strategyLabel}
            options={STRATEGY_OPTIONS}
            value={summary.strategy}
            onChange={(next) => {
              if (!strategyBusy && next !== summary.strategy) {
                onStrategyChange(next);
              }
            }}
          />
        </div>
      </Card>
    </section>
  );
}

export function AdminAzure() {
  const api = useApi();
  const summaryState = useResource('admin-azure-summary', (signal) =>
    api.adminAzureSummary({ signal }),
  );
  const accountsState = useResource('admin-azure-accounts', (signal) =>
    api.adminAzureAccounts({ signal }),
  );

  const [notice, setNotice] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [strategyBusy, setStrategyBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<AzureAccountKind>('speech');
  const [region, setRegion] = useState('eastus');
  const [apiKey, setApiKey] = useState('');
  const [priority, setPriority] = useState('100');
  const [sttCap, setSttCap] = useState('16200');
  const [ttsCap, setTtsCap] = useState('450000');
  const [translatorCap, setTranslatorCap] = useState('1800000');

  const [confirmDelete, setConfirmDelete] = useState<AzureAccountOut | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  function resetForm(): void {
    setLabel('');
    setKind('speech');
    setRegion('eastus');
    setApiKey('');
    setPriority('100');
    setSttCap('16200');
    setTtsCap('450000');
    setTranslatorCap('1800000');
    setFormError(null);
  }

  function openCreate(): void {
    resetForm();
    setNotice(null);
    setErrorBanner(null);
    setCreateOpen(true);
  }

  function closeCreate(): void {
    if (saving) return;
    setApiKey('');
    setCreateOpen(false);
  }

  async function handleStrategyChange(
    strategy: AzurePoolStrategy,
  ): Promise<void> {
    setStrategyBusy(true);
    setNotice(null);
    setErrorBanner(null);
    try {
      await api.adminAzureSetStrategy({ strategy });
      setNotice(s.strategySaved);
      summaryState.reload();
    } catch (cause) {
      setErrorBanner(errText(cause));
    } finally {
      setStrategyBusy(false);
    }
  }

  async function handleCreateSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const cleanLabel = label.trim();
    const cleanRegion = region.trim().toLowerCase();
    const cleanKey = apiKey.trim();
    if (cleanLabel === '' || cleanRegion === '' || cleanKey.length < 8) {
      setFormError(s.validationRequired);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const created = await api.adminAzureCreate({
        label: cleanLabel,
        kind,
        region: cleanRegion,
        api_key: cleanKey,
        priority: Math.max(1, Number.parseInt(priority, 10) || 100),
        enabled: true,
        monthly_stt_seconds_cap: Math.max(0, Number.parseInt(sttCap, 10) || 0),
        monthly_tts_chars_cap: Math.max(0, Number.parseInt(ttsCap, 10) || 0),
        monthly_translator_chars_cap: Math.max(
          0,
          Number.parseInt(translatorCap, 10) || 0,
        ),
      });
      setApiKey('');
      setCreateOpen(false);
      setNotice(s.createdNotice(created.label));
      summaryState.reload();
      accountsState.reload();
    } catch (cause) {
      setFormError(errText(cause));
    } finally {
      setSaving(false);
    }
  }

  async function runTest(acc: AzureAccountOut): Promise<void> {
    setTestingId(acc.id);
    setNotice(null);
    setErrorBanner(null);
    try {
      const res = await api.adminAzureTest(acc.id);
      if (res.ok) {
        setNotice(s.testSuccess(acc.label, res.detail, res.latency_ms));
      } else {
        setErrorBanner(s.testFailure(acc.label, res.detail));
      }
      accountsState.reload();
    } catch (cause) {
      setErrorBanner(errText(cause));
    } finally {
      setTestingId(null);
    }
  }

  async function toggleEnabled(acc: AzureAccountOut): Promise<void> {
    setTogglingId(acc.id);
    setNotice(null);
    setErrorBanner(null);
    try {
      await api.adminAzureUpdate(acc.id, { enabled: !acc.enabled });
      setNotice(
        acc.enabled ? s.disabledNotice(acc.label) : s.enabledNotice(acc.label),
      );
      summaryState.reload();
      accountsState.reload();
    } catch (cause) {
      setErrorBanner(errText(cause));
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmRemove(): Promise<void> {
    if (confirmDelete === null) return;
    const acc = confirmDelete;
    setDeleting(true);
    setNotice(null);
    setErrorBanner(null);
    try {
      await api.adminAzureDelete(acc.id);
      setConfirmDelete(null);
      setNotice(s.removedNotice(acc.label));
      summaryState.reload();
      accountsState.reload();
    } catch (cause) {
      setErrorBanner(errText(cause));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="stack-lg">
      <AppBar
        title={s.title}
        subtitle={s.subtitle}
        back={{ to: '/mas/admin', label: 'Administración' }}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {s.addAccount}
          </Button>
        }
      />

      {notice !== null ? (
        <p className="callout info" role="status">
          {notice}
        </p>
      ) : null}
      {errorBanner !== null ? (
        <p className="callout error" role="alert">
          {errorBanner}
        </p>
      ) : null}

      <StateView
        state={summaryState}
        emptyText={s.empty}
        onRetry={summaryState.reload}
      >
        {(summary) => (
          <SummarySection
            summary={summary}
            strategyBusy={strategyBusy}
            onStrategyChange={(next) => void handleStrategyChange(next)}
          />
        )}
      </StateView>

      <section className="stack" aria-labelledby="azure-accounts-heading">
        <div className="section-title">
          <h2 id="azure-accounts-heading">{s.accountsTitle}</h2>
        </div>

        <StateView
          state={accountsState}
          empty={(rows) => rows.length === 0}
          emptyText={s.empty}
          onRetry={accountsState.reload}
        >
          {(accounts) => (
            <ul className="list">
              {accounts.map((acc) => {
                const status = accountStatusChip(acc);
                const envOrigin = acc.source === 'env';
                return (
                  <li key={acc.id}>
                    <Card>
                      <div className="stack">
                        <div className="row-between wrap">
                          <div className="stack">
                            <span className="title">{acc.label}</span>
                            <span className="small muted">
                              {s.kinds[acc.kind]} · {acc.region} ·{' '}
                              {acc.key_hint}
                            </span>
                          </div>
                          <div className="row wrap">
                            <Chip tone={status.tone}>{status.label}</Chip>
                            <Chip tone="neutral">
                              {s.priorityBadge(acc.priority)}
                            </Chip>
                            <Chip tone="neutral">
                              {envOrigin ? s.sourceEnv : s.sourceDb}
                            </Chip>
                          </div>
                        </div>

                        {acc.kind === 'speech' ? (
                          <div className="azure-grid">
                            <UsageBar
                              label={s.sttLabel}
                              detail={s.secondsProgress(
                                acc.usage.stt_seconds ?? 0,
                                acc.monthly_stt_seconds_cap,
                              )}
                              used={acc.usage.stt_seconds ?? 0}
                              cap={acc.monthly_stt_seconds_cap}
                            />
                            <UsageBar
                              label={s.ttsLabel}
                              detail={s.charsProgress(
                                acc.usage.tts_chars ?? 0,
                                acc.monthly_tts_chars_cap,
                              )}
                              used={acc.usage.tts_chars ?? 0}
                              cap={acc.monthly_tts_chars_cap}
                            />
                          </div>
                        ) : (
                          <UsageBar
                            label={s.translatorLabel}
                            detail={s.charsProgress(
                              acc.usage.translator_chars ?? 0,
                              acc.monthly_translator_chars_cap,
                            )}
                            used={acc.usage.translator_chars ?? 0}
                            cap={acc.monthly_translator_chars_cap}
                          />
                        )}

                        {acc.last_error !== undefined &&
                        acc.last_error !== null &&
                        acc.last_error !== '' ? (
                          <p className="small muted">{acc.last_error}</p>
                        ) : null}

                        <div className="row wrap">
                          <Button
                            variant="secondary"
                            busy={testingId === acc.id}
                            onClick={() => void runTest(acc)}
                          >
                            {testingId === acc.id ? s.testing : s.test}
                          </Button>
                          {!envOrigin ? (
                            <>
                              <Button
                                variant="secondary"
                                busy={togglingId === acc.id}
                                onClick={() => void toggleEnabled(acc)}
                              >
                                {acc.enabled ? s.disable : s.enable}
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => setConfirmDelete(acc)}
                              >
                                {s.remove}
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </StateView>
      </section>

      <Dialog open={createOpen} title={s.formTitle} onClose={closeCreate}>
        <form
          className="stack"
          onSubmit={(event) => void handleCreateSubmit(event)}
        >
          {formError !== null ? (
            <p className="callout error" role="alert">
              {formError}
            </p>
          ) : null}

          <Field label={s.fieldLabel}>
            <input
              className="input"
              required
              placeholder={s.fieldLabelPlaceholder}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>

          <div className="field">
            <span>{s.fieldKind}</span>
            <Segmented
              label={s.fieldKind}
              options={KIND_OPTIONS}
              value={kind}
              onChange={setKind}
            />
          </div>

          <Field label={s.fieldRegion} hint={s.fieldRegionHint}>
            <input
              className="input"
              required
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            />
          </Field>

          <Field label={s.fieldKey} hint={s.fieldKeyHint}>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>

          <Field label={s.fieldPriority}>
            <input
              className="input"
              type="number"
              min={1}
              max={10000}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
          </Field>

          {kind === 'speech' ? (
            <>
              <Field label={s.fieldSttCap}>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={sttCap}
                  onChange={(e) => setSttCap(e.target.value)}
                />
              </Field>
              <Field label={s.fieldTtsCap}>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={ttsCap}
                  onChange={(e) => setTtsCap(e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field label={s.fieldTranslatorCap}>
              <input
                className="input"
                type="number"
                min={0}
                value={translatorCap}
                onChange={(e) => setTranslatorCap(e.target.value)}
              />
            </Field>
          )}

          <div className="row wrap">
            <Button variant="ghost" type="button" onClick={closeCreate}>
              {s.cancel}
            </Button>
            <Button variant="primary" type="submit" busy={saving}>
              {s.save}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={confirmDelete !== null}
        title={s.deleteTitle}
        onClose={() => {
          if (!deleting) setConfirmDelete(null);
        }}
        actions={
          confirmDelete === null ? undefined : (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  if (!deleting) setConfirmDelete(null);
                }}
              >
                {s.cancel}
              </Button>
              <Button
                variant="primary"
                busy={deleting}
                onClick={() => void confirmRemove()}
              >
                {s.confirm}
              </Button>
            </>
          )
        }
      >
        {confirmDelete !== null ? (
          <p>{s.deleteConfirm(confirmDelete.label)}</p>
        ) : null}
      </Dialog>
    </div>
  );
}

export default AdminAzure;
