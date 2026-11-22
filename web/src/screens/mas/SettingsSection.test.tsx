import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { UserPrefs } from '../../contracts/generated';
import { jsonResponse, offline } from '../../api/testing';
import { closeV2DbForTests } from '../../offline/db';
import { getOfflineAudio } from '../../offline/settings';
import { prefetchForOffline } from '../../offline/prefetch';
import { renderScreen } from '../../shell/testing';
import { setMotion3dPref } from '../../three/motionPref';
import SettingsSection from './SettingsSection';

const masDir = dirname(fileURLToPath(import.meta.url));

vi.mock('../../offline/prefetch', () => ({
  prefetchForOffline: vi.fn(() => Promise.resolve()),
}));

const PREFS: UserPrefs = {
  preferred_voice_ids: [],
  daily_new_cards: 10,
  theme: 'system',
};

function routes(overrides: Record<string, unknown> = {}) {
  return {
    'GET /api/me/prefs': PREFS,
    'PUT /api/me/prefs': (request: { body: unknown }) =>
      jsonResponse(request.body),
    ...overrides,
  };
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
  document.documentElement.className = '';
  vi.mocked(prefetchForOffline).mockClear();
});

afterEach(() => {
  setMotion3dPref('auto');
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.className = '';
});

test('sin conexión el tema queda en el dispositivo y lo avisa', async () => {
  const { transport } = renderScreen(<SettingsSection />, {
    routes: routes({ 'PUT /api/me/prefs': offline() }),
  });

  await userEvent.click(await screen.findByRole('radio', { name: 'Oscuro' }));

  expect(document.documentElement).toHaveClass('theme-dark');
  expect(
    await screen.findByText(
      'Sin conexión: el tema queda solo en este dispositivo.',
    ),
  ).toBeVisible();
  expect(transport.calls.some((call) => call.method === 'PUT')).toBe(true);
});

test('tarjetas nuevas por día acepta 0…100 y avisa fuera de rango', async () => {
  const { transport } = renderScreen(<SettingsSection />, {
    routes: routes(),
  });

  await userEvent.click(await screen.findByRole('radio', { name: '20' }));
  await waitFor(() => {
    const put = transport.calls.find((call) => call.method === 'PUT');
    expect(put?.body).toMatchObject({ daily_new_cards: 20 });
  });

  const input = screen.getByRole('spinbutton', {
    name: 'Valor exacto (0 a 100)',
  });
  await userEvent.clear(input);
  await userEvent.type(input, '150');
  await userEvent.tab();

  expect(
    await screen.findByText('El valor debe estar entre 0 y 100.'),
  ).toBeVisible();
  expect(transport.calls.filter((call) => call.method === 'PUT')).toHaveLength(
    1,
  );

  await userEvent.clear(input);
  await userEvent.type(input, '0');
  await userEvent.tab();

  await waitFor(() => {
    const puts = transport.calls.filter((call) => call.method === 'PUT');
    expect(puts.at(-1)?.body).toMatchObject({ daily_new_cards: 0 });
  });
});

test('guardar audios sin conexión persiste el ajuste y precarga', async () => {
  renderScreen(<SettingsSection />, { routes: routes() });

  const toggle = await screen.findByRole('switch', {
    name: 'Guardar audios sin conexión',
  });
  expect(toggle).toHaveAttribute('aria-checked', 'false');

  await userEvent.click(toggle);

  await waitFor(() => {
    expect(prefetchForOffline).toHaveBeenCalledTimes(1);
  });
  expect(prefetchForOffline).toHaveBeenCalledWith(expect.anything(), {
    audio: true,
  });
  expect(await getOfflineAudio()).toBe(true);
  expect(
    await screen.findByText('Audios guardados para usar sin conexión.'),
  ).toBeVisible();
});

test('la muestra enseña francés e IPA y avisa sin animación', async () => {
  renderScreen(<SettingsSection />, { routes: routes() });

  const sample = await screen.findByRole('article', { name: 'Muestra' });
  expect(sample).toHaveClass('paper', 'settings-sample');
  expect(within(sample).getByText('Cahier')).toHaveAttribute('lang', 'fr');
  expect(within(sample).getByText('/kaje/')).toHaveClass('settings-sample-ipa');
  const dot = sample.querySelector('.settings-sample-dot');
  expect(dot).toHaveAttribute('aria-hidden', 'true');
  expect(within(sample).queryByText('sin animación')).not.toBeInTheDocument();

  setMotion3dPref('off');

  expect(await within(sample).findByText('sin animación')).toBeVisible();
  expect(sample.querySelector('.settings-sample-dot')).toBe(dot);

  const css = readFileSync(join(masDir, 'mas.css'), 'utf8');
  expect(css).toMatch(/\.settings-sample\s*\{[^}]*min-height:\s*120px/);
  expect(css).toMatch(
    /\.settings-sample-word\s*\{[^}]*font-family:\s*var\(--font-read\)/,
  );
  expect(css).toMatch(
    /\.settings-sample-ipa\s*\{[^}]*font-family:\s*var\(--font-mono\)/,
  );
  const dotRule = /\.settings-sample-dot\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  expect(dotRule).toMatch(/width:\s*24px/);
  expect(dotRule).toMatch(/height:\s*24px/);
  expect(dotRule).toMatch(/background:\s*var\(--c-gold-3d\)/);
  expect(css).not.toMatch(/color:\s*var\(--c-gold-3d\)/);
});
