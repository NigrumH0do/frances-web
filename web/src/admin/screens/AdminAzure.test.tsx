import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  AzureAccountOut,
  AzurePoolSummary,
  AzureTestResult,
} from '../../contracts/generated';
import { closeV2DbForTests } from '../../offline/db';
import { ME_ADMIN, renderScreen } from '../../shell/testing';
import AdminAzure from './AdminAzure';

const BASE_SUMMARY: AzurePoolSummary = {
  strategy: 'priority',
  month: '2026-11',
  speech_accounts: 2,
  speech_active: 2,
  translator_accounts: 1,
  translator_active: 1,
  stt_seconds_used: 3600,
  stt_seconds_cap: 32400,
  tts_chars_used: 50000,
  tts_chars_cap: 900000,
  translator_chars_used: 120000,
  translator_chars_cap: 1800000,
  encryption_ready: false,
};

const DB_ACCOUNT: AzureAccountOut = {
  id: 'az_db_1',
  label: 'Speech secundaria',
  kind: 'speech',
  region: 'eastus',
  key_hint: '••••abcd',
  enabled: true,
  priority: 10,
  monthly_stt_seconds_cap: 16200,
  monthly_tts_chars_cap: 450000,
  monthly_translator_chars_cap: 0,
  cooldown_until: null,
  last_error: null,
  last_error_at: null,
  last_used_at: null,
  usage: { stt_seconds: 1200, tts_chars: 25000, translator_chars: 0 },
  source: 'db',
};

const ENV_ACCOUNT: AzureAccountOut = {
  id: 'env_translator',
  label: 'Translator env',
  kind: 'translator',
  region: 'westeurope',
  key_hint: '••••efgh',
  enabled: true,
  priority: 1000,
  monthly_stt_seconds_cap: 0,
  monthly_tts_chars_cap: 0,
  monthly_translator_chars_cap: 1800000,
  cooldown_until: null,
  last_error: null,
  last_error_at: null,
  last_used_at: null,
  usage: { stt_seconds: 0, tts_chars: 0, translator_chars: 120000 },
  source: 'env',
};

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('muestra resumen mensual, aviso de cifrado y cambia la estrategia del pool', async () => {
  const { transport } = renderScreen(<AdminAzure />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/azure/summary': BASE_SUMMARY,
      'GET /api/admin/azure/accounts': [DB_ACCOUNT, ENV_ACCOUNT],
      'PATCH /api/admin/azure/strategy': {
        ...BASE_SUMMARY,
        strategy: 'least_used',
      },
    },
  });

  expect(
    await screen.findByText(/Falta FRANCES_SECRETS_KEY en el servidor/),
  ).toBeVisible();
  const summary = screen.getByRole('region', {
    name: 'Consumo mensual del pool',
  });
  expect(
    within(summary).getByRole('progressbar', {
      name: 'Reconocimiento de voz (STT)',
    }),
  ).toHaveAttribute('aria-valuenow', '11');
  expect(
    within(summary).getByRole('progressbar', {
      name: 'Síntesis de audio (TTS)',
    }),
  ).toHaveAttribute('aria-valuenow', '6');

  await userEvent.click(screen.getByRole('radio', { name: 'Menor uso' }));

  await waitFor(() =>
    expect(
      transport.calls.find((c) => c.url === '/api/admin/azure/strategy')?.body,
    ).toEqual({ strategy: 'least_used' }),
  );
  expect(await screen.findByText('Estrategia actualizada.')).toBeVisible();
});

test('un cupo al 80 % o más marca el relleno warn y el aviso no es rojo', async () => {
  renderScreen(<AdminAzure />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/azure/summary': {
        ...BASE_SUMMARY,
        stt_seconds_used: 25920,
        tts_chars_used: 50000,
      },
      'GET /api/admin/azure/accounts': [],
    },
  });

  const summary = await screen.findByRole('region', {
    name: 'Consumo mensual del pool',
  });
  const stt = within(summary).getByRole('progressbar', {
    name: 'Reconocimiento de voz (STT)',
  });
  const tts = within(summary).getByRole('progressbar', {
    name: 'Síntesis de audio (TTS)',
  });
  expect(stt.querySelector('.usage-meter-fill')).toHaveClass('warn');
  expect(tts.querySelector('.usage-meter-fill')).not.toHaveClass('warn');
  expect(stt).toHaveAttribute('aria-valuenow', '80');

  const sttLabel = within(summary).getByText('Reconocimiento de voz (STT)');
  expect(sttLabel.parentElement?.querySelector('.nums')).toHaveTextContent(
    /\d/,
  );
  for (const pool of within(summary).getAllByText('2 de 2 cuentas activas')) {
    expect(pool).toHaveClass('nums');
  }

  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../admin.css'),
    'utf8',
  );
  const warn = /\.usage-meter-fill\.warn\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  expect(warn).toMatch(/background:\s*var\(--c-warning\)/);
  expect(warn).not.toMatch(/var\(--c-danger\)/);
});

test('crea, prueba, deshabilita y elimina cuentas db sin ofrecer edición en env', async () => {
  const createdAccount: AzureAccountOut = {
    ...DB_ACCOUNT,
    id: 'az_db_2',
    label: 'Speech respaldo',
    region: 'brazilsouth',
    key_hint: '••••9999',
  };
  let accounts: AzureAccountOut[] = [DB_ACCOUNT, ENV_ACCOUNT];
  const testResult: AzureTestResult = {
    ok: true,
    detail: 'Token emitido correctamente',
    status_code: 200,
    latency_ms: 42,
  };

  const { transport } = renderScreen(<AdminAzure />, {
    user: ME_ADMIN,
    routes: {
      'GET /api/admin/azure/summary': {
        ...BASE_SUMMARY,
        encryption_ready: true,
      },
      'GET /api/admin/azure/accounts': () =>
        new Response(JSON.stringify(accounts), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      'POST /api/admin/azure/accounts': () => {
        accounts = [createdAccount, ...accounts];
        return new Response(JSON.stringify(createdAccount), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      },
      'POST /api/admin/azure/accounts/az_db_1/test': testResult,
      'PATCH /api/admin/azure/accounts/az_db_1': {
        ...DB_ACCOUNT,
        enabled: false,
      },
      'DELETE /api/admin/azure/accounts/az_db_1': { ok: true },
    },
  });

  await screen.findByText('Speech secundaria');
  const envRow = screen
    .getByText('Translator env')
    .closest('li') as HTMLElement;
  expect(within(envRow).getByRole('button', { name: 'Probar' })).toBeVisible();
  expect(
    within(envRow).queryByRole('button', { name: 'Eliminar' }),
  ).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Agregar cuenta' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(
    within(dialog).getByLabelText('Nombre descriptivo'),
    'Speech respaldo',
  );
  const regionInput = within(dialog).getByLabelText('Región Azure');
  await userEvent.clear(regionInput);
  await userEvent.type(regionInput, 'brazilsouth');
  await userEvent.type(
    within(dialog).getByLabelText('Clave API'),
    'secret-key-9999',
  );
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Guardar cuenta' }),
  );

  await waitFor(() =>
    expect(
      transport.calls.find(
        (c) => c.method === 'POST' && c.url === '/api/admin/azure/accounts',
      )?.body,
    ).toMatchObject({
      label: 'Speech respaldo',
      kind: 'speech',
      region: 'brazilsouth',
      api_key: 'secret-key-9999',
    }),
  );

  const dbRow = (await screen.findByText('Speech secundaria')).closest(
    'li',
  ) as HTMLElement;
  await userEvent.click(within(dbRow).getByRole('button', { name: 'Probar' }));
  expect(
    await screen.findByText(/Speech secundaria: conexión OK \(42 ms\)/),
  ).toBeVisible();

  await userEvent.click(
    within(dbRow).getByRole('button', { name: 'Deshabilitar' }),
  );
  await waitFor(() =>
    expect(
      transport.calls.find(
        (c) =>
          c.method === 'PATCH' && c.url === '/api/admin/azure/accounts/az_db_1',
      )?.body,
    ).toEqual({ enabled: false }),
  );

  await userEvent.click(
    within(dbRow).getByRole('button', { name: 'Eliminar' }),
  );
  const confirmDialog = await screen.findByRole('dialog');
  await userEvent.click(
    within(confirmDialog).getByRole('button', { name: 'Confirmar' }),
  );
  await waitFor(() =>
    expect(
      transport.calls.some(
        (c) =>
          c.method === 'DELETE' &&
          c.url === '/api/admin/azure/accounts/az_db_1',
      ),
    ).toBe(true),
  );
});
