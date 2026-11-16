import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { jsonResponse } from '../../api/testing';
import type { JobOut, PipelineStatus } from '../../contracts/generated';
import { closeV2DbForTests } from '../../offline/db';
import { ME_ADMIN, renderScreen } from '../../shell/testing';
import AdminPipeline from './AdminPipeline';

const JOB: JobOut = {
  id: 7,
  kind: 'pipeline.daily',
  state: 'failed',
  attempts: 5,
  max_attempts: 5,
  run_after: '2026-11-06T10:17:00.000Z',
  last_error: 'Leçon 3 — Mme X: traceback crudo',
  created_at: '2026-11-06T10:17:00.000Z',
  updated_at: '2026-11-06T10:20:00.000Z',
  finished_at: '2026-11-06T10:20:00.000Z',
};

const PIPELINE: PipelineStatus = {
  last_runs: [
    {
      id: 1,
      stage: 'fetch',
      started_at: '2026-11-06T10:17:00.000Z',
      finished_at: '2026-11-06T10:20:00.000Z',
      status: 'partial',
      counts: { downloaded: 3 },
    },
  ],
  jobs: { queued: 2, running: 1, done: 10, failed: 1 },
  recent_failed: [JOB],
  next_daily_at: '2026-11-07T10:17:00.000Z',
  next_reconcile_at: '2026-11-08T11:00:00.000Z',
  last_backup: null,
  worker_seen_at: '2026-11-06T20:00:00.000Z',
};

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('pipeline muestra el último run y reintenta un fallo', async () => {
  const { transport } = renderScreen(<AdminPipeline />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/pipeline': PIPELINE,
      'POST /api/admin/jobs/7/retry': { ...JOB, state: 'queued', attempts: 0 },
    },
  });

  expect(await screen.findByText('fetch')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

  await waitFor(() =>
    expect(
      transport.calls.some((call) => call.url === '/api/admin/jobs/7/retry'),
    ).toBe(true),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('reencolado');
});

test('pipeline lanza el diario y la reconciliación tras confirmar', async () => {
  const { transport } = renderScreen(<AdminPipeline />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/pipeline': PIPELINE,
      'POST /api/admin/pipeline/run': { ...JOB, id: 9, state: 'queued' },
    },
  });

  await userEvent.click(
    await screen.findByRole('button', { name: 'Lanzar pipeline diario' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => {
    const runs = transport.calls.filter(
      (call) => call.url === '/api/admin/pipeline/run',
    );
    expect(runs.at(-1)?.body).toEqual({ kind: 'pipeline.daily' });
  });

  await userEvent.click(
    screen.getByRole('button', { name: 'Lanzar reconciliación' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => {
    const runs = transport.calls.filter(
      (call) => call.url === '/api/admin/pipeline/run',
    );
    expect(runs.at(-1)?.body).toEqual({ kind: 'pipeline.reconcile' });
  });
});

test('pipeline no muestra texto del curso ni errores crudos', async () => {
  const leakyJob = {
    ...JOB,
    payload: { text: 'Leçon payload' },
    result: { text: 'Leçon result' },
  } as JobOut;
  renderScreen(<AdminPipeline />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/pipeline': { ...PIPELINE, recent_failed: [leakyJob] },
    },
  });

  expect(await screen.findByText('fetch')).toBeVisible();
  expect(screen.queryByText(/Leçon/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Mme X/)).not.toBeInTheDocument();
  expect(screen.queryByText(/traceback/)).not.toBeInTheDocument();
  expect(screen.queryByText(/payload/)).not.toBeInTheDocument();
  expect(screen.queryByText(/result/)).not.toBeInTheDocument();
});

test('pipeline muestra carga y vacío', async () => {
  renderScreen(<AdminPipeline />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/pipeline': () => new Promise<Response>(() => undefined),
    },
  });
  expect(screen.getByRole('status')).toHaveTextContent('Cargando');
  cleanup();

  renderScreen(<AdminPipeline />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/pipeline': {
        ...PIPELINE,
        last_runs: [],
        recent_failed: [],
      },
    },
  });
  expect(
    await screen.findByText('No hay ejecuciones registradas'),
  ).toBeVisible();
  expect(screen.getByText('No hay trabajos fallidos')).toBeVisible();
});

test('pipeline muestra error y Reintentar recarga', async () => {
  let fail = true;
  renderScreen(<AdminPipeline />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/pipeline': () =>
        Promise.resolve(
          fail
            ? jsonResponse(
                { code: 'internal', message_es: 'fallo del servidor' },
                500,
              )
            : jsonResponse(PIPELINE),
        ),
    },
  });

  expect(
    await screen.findByText('Algo salió mal en el servidor'),
  ).toBeVisible();
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

  expect(await screen.findByText('fetch')).toBeVisible();
});
