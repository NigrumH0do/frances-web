import { useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { toUiError } from '../../api/client';
import { useResource } from '../../api/useResource';
import {
  AppBar,
  Button,
  Card,
  Chip,
  Dialog,
  StateView,
} from '../../components';
import type { ChipTone } from '../../components';
import type { JobOut, PipelineStatus } from '../../contracts/generated';
import { formatShort } from '../../i18n/dates';
import { messageFor } from '../../l10n/errors';
import {
  jobStateLabel,
  pipelineStrings,
  runStatusLabel,
} from '../pipelineStrings';

type JobState = JobOut['state'];
type RunStatus = string | null;

type PendingAction =
  | { kind: 'run'; runKind: 'pipeline.daily' | 'pipeline.reconcile' }
  | { kind: 'retry'; job: JobOut };

const STATES: JobState[] = ['queued', 'running', 'done', 'failed'];

function stateTone(state: JobState): ChipTone {
  if (state === 'failed') return 'danger';
  if (state === 'running') return 'warning';
  if (state === 'done') return 'success';
  return 'neutral';
}

function runTone(status: RunStatus): ChipTone {
  if (status === 'failed') return 'danger';
  if (status === 'partial') return 'warning';
  if (status === 'ok') return 'success';
  return 'neutral';
}

export function AdminPipeline() {
  const api = useApi();
  const strings = pipelineStrings;
  const state = useResource('admin-pipeline', (signal) =>
    api.adminPipeline({ signal }),
  );
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function open(next: PendingAction): void {
    setNotice(null);
    setActionError(null);
    setPending(next);
  }

  function close(): void {
    if (!busy) setPending(null);
  }

  async function confirm(): Promise<void> {
    if (pending === null) return;
    setBusy(true);
    setNotice(null);
    setActionError(null);
    try {
      if (pending.kind === 'run') {
        await api.runPipeline({ kind: pending.runKind });
        setNotice(
          pending.runKind === 'pipeline.daily'
            ? strings.runDailyQueued
            : strings.runReconcileQueued,
        );
      } else {
        await api.retryJob(pending.job.id);
        setNotice(strings.retryQueued(pending.job.id));
      }
      setPending(null);
      state.reload();
    } catch (cause) {
      setActionError(messageFor(toUiError(cause)));
    } finally {
      setBusy(false);
    }
  }

  function confirmText(action: PendingAction): string {
    if (action.kind === 'retry') return strings.retryConfirm(action.job.id);
    return action.runKind === 'pipeline.daily'
      ? strings.runDailyConfirm
      : strings.runReconcileConfirm;
  }

  function PipelineContent({ data }: { data: PipelineStatus }) {
    return (
      <div className="stack-lg">
        <section className="stack" aria-labelledby="admin-pipeline-schedule">
          <div className="section-title">
            <h2 id="admin-pipeline-schedule">{strings.scheduleTitle}</h2>
          </div>
          <Card>
            <p>{strings.nextDaily(formatShort(data.next_daily_at))}</p>
            <p>{strings.nextReconcile(formatShort(data.next_reconcile_at))}</p>
            <p>
              {data.worker_seen_at === null
                ? strings.workerNever
                : strings.workerSeen(formatShort(data.worker_seen_at))}
            </p>
            <p>
              {data.last_backup === null
                ? strings.backupNone
                : strings.backupLast(
                    formatShort(data.last_backup.started_at),
                    data.last_backup.status,
                  )}
            </p>
          </Card>
        </section>

        <section className="stack" aria-labelledby="admin-pipeline-runs">
          <div className="section-title">
            <h2 id="admin-pipeline-runs">{strings.runsTitle}</h2>
          </div>
          {data.last_runs.length === 0 ? (
            <p className="small muted">{strings.emptyRuns}</p>
          ) : (
            <ul className="list">
              {data.last_runs.map((run) => (
                <li key={run.id}>
                  <div className="list-item">
                    <span className="grow">
                      <span className="title">{run.stage}</span>
                      <br />
                      <span className="meta">
                        {formatShort(run.started_at)} ·{' '}
                        {strings.counts(run.counts)}
                      </span>
                    </span>
                    <Chip tone={runTone(run.status)}>
                      {runStatusLabel(run.status)}
                    </Chip>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="stack" aria-labelledby="admin-pipeline-jobs">
          <div className="section-title">
            <h2 id="admin-pipeline-jobs">{strings.jobsTitle}</h2>
          </div>
          <ul className="list">
            {STATES.map((jobState) => (
              <li key={jobState}>
                <div className="list-item">
                  <span className="grow">{jobStateLabel(jobState)}</span>
                  <Chip tone={stateTone(jobState)}>
                    {data.jobs[jobState] ?? 0}
                  </Chip>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="stack" aria-labelledby="admin-pipeline-failed">
          <div className="section-title">
            <h2 id="admin-pipeline-failed">{strings.failedTitle}</h2>
          </div>
          {data.recent_failed.length === 0 ? (
            <p className="small muted">{strings.emptyFailed}</p>
          ) : (
            <ul className="list">
              {data.recent_failed.map((job) => (
                <li key={job.id}>
                  <div className="list-item">
                    <span className="grow">
                      <span className="title">
                        {strings.jobMeta(job.kind, job.id)}
                      </span>
                      <br />
                      <span className="meta">
                        {strings.attempts(job.attempts, job.max_attempts)}
                      </span>
                    </span>
                    <Chip tone="danger">{jobStateLabel(job.state)}</Chip>
                    <Button
                      variant="secondary"
                      onClick={() => open({ kind: 'retry', job })}
                    >
                      {strings.retry}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <AppBar title={strings.title} back={{ to: '/mas', label: 'Más' }} />

      {notice !== null ? (
        <p className="callout info" role="alert">
          {notice}
        </p>
      ) : null}
      {actionError !== null ? (
        <p className="callout error" role="alert">
          {actionError}
        </p>
      ) : null}

      <Card>
        <div className="row">
          <Button
            variant="primary"
            onClick={() => open({ kind: 'run', runKind: 'pipeline.daily' })}
          >
            {strings.runDaily}
          </Button>
          <Button
            variant="secondary"
            onClick={() => open({ kind: 'run', runKind: 'pipeline.reconcile' })}
          >
            {strings.runReconcile}
          </Button>
        </div>
      </Card>

      <StateView
        state={state}
        emptyText={strings.emptyRuns}
        onRetry={state.reload}
      >
        {(data) => <PipelineContent data={data} />}
      </StateView>

      <Dialog
        open={pending !== null}
        title={
          pending?.kind === 'retry' ? strings.retryTitle : strings.runTitle
        }
        onClose={close}
        actions={
          pending === null ? undefined : (
            <>
              <Button variant="ghost" onClick={close}>
                {strings.cancel}
              </Button>
              <Button
                variant="primary"
                busy={busy}
                onClick={() => void confirm()}
              >
                {strings.confirm}
              </Button>
            </>
          )
        }
      >
        {pending !== null ? <p>{confirmText(pending)}</p> : null}
      </Dialog>
    </div>
  );
}

export default AdminPipeline;
