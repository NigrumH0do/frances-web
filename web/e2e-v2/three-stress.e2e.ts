// QA-03: 50 ciclos de navegación en el mismo documento. Chromium mantiene las
// 50 vueltas. WebKit también parte de 50; si el presupuesto no alcanza, solo
// se baja WebKit y queda anotado.

import type { Page } from '@playwright/test';
import { expect, test } from './console.fixture';
import { loginDemo } from './helpers';

const CYCLES = 50;

test.use({ serviceWorkers: 'block' });

test(
  'cincuenta navegaciones reutilizan un WebGL y un chunk',
  { tag: '@stress' },
  async ({ page }, testInfo) => {
    test.setTimeout(600_000);
    const cycles = CYCLES;

    await page.addInitScript(() => {
      const host = window as Window & {
        __francesTier?: string;
        __francesDprCap?: number;
      };
      host.__francesTier = 'full';
      host.__francesDprCap = 1;
    });

    await loginDemo(page, '/');
    const origin = await page.evaluate(() => performance.timeOrigin);
    let mode: 'unknown' | 'webgl' | 'css' = 'unknown';
    // WebKit rechaza más de 100 pushState en 10 s. 50×4 sigue siendo
    // obligatorio; el hueco deja la ráfaga por debajo de ese tope.
    const paceMs = testInfo.project.name.includes('webkit') ? 120 : 0;

    for (let i = 0; i < cycles; i += 1) {
      await spaGoto(page, '/entrar', 'Entrar', paceMs);
      mode = await settleScene(page, '.notebook-fallback', mode);
      await spaGoto(
        page,
        '/',
        /Buenos días|Buenas tardes|Buenas noches/,
        paceMs,
      );
      mode = await settleScene(page, '.hoy-compass-slot svg', mode);
      await spaGoto(page, '/repasar', 'Repasar', paceMs);
      await spaGoto(page, '/chat', 'Chat', paceMs);
    }

    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
    await expect(page.locator('canvas')).toHaveCount(0);

    const creates = await page.evaluate(() => {
      const host = window as Window & { __francesGlCreates?: number };
      return host.__francesGlCreates ?? 0;
    });
    if (creates === 0 && testInfo.project.name.includes('webkit')) {
      testInfo.annotations.push({
        type: 'webkit-webgl-unavailable',
        description:
          'WebKit no creó contexto en el estrés; el chunk se mide igual y Chromium exige un solo WebGL.',
      });
    } else {
      expect(creates).toBe(1);
    }

    const transfers = await page.evaluate(() => {
      const pattern = /\/assets\/three-[^/]+\.js$/;
      return performance.getEntriesByType('resource').filter((entry) => {
        const timing = entry as PerformanceResourceTiming;
        try {
          return (
            pattern.test(new URL(timing.name).pathname) &&
            timing.transferSize > 0
          );
        } catch {
          return false;
        }
      }).length;
    });
    expect(transfers).toBe(1);
  },
);

async function spaGoto(
  page: Page,
  path: string,
  heading: string | RegExp,
  paceMs = 0,
): Promise<void> {
  if (paceMs > 0) await page.waitForTimeout(paceMs);
  await page.evaluate((to) => {
    const current = history.state as { idx?: number } | null;
    const idx = typeof current?.idx === 'number' ? current.idx + 1 : 1;
    history.pushState(
      {
        usr: null,
        key: Math.random().toString(36).slice(2, 10),
        idx,
      },
      '',
      to,
    );
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  const url = path === '/' ? /\/$/ : new RegExp(`${path}$`);
  await expect(page).toHaveURL(url);
  await expect(
    page.getByRole('heading', { level: 1, name: heading }),
  ).toBeVisible();
}

async function settleScene(
  page: Page,
  fallback: string,
  mode: 'unknown' | 'webgl' | 'css',
): Promise<'webgl' | 'css'> {
  if (mode === 'webgl') {
    await expect(page.locator('canvas')).toBeVisible();
    return 'webgl';
  }
  if (mode === 'css') {
    await expect(page.locator(fallback)).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    return 'css';
  }
  const canvas = page.locator('canvas');
  const appeared = await canvas
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) return 'webgl';
  await expect(page.locator(fallback)).toBeVisible();
  return 'css';
}
