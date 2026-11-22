// QA-03: la ráfaga de /repasar cabe en 440×280, dispara una vez y deja de
// pedir frames. El cierre de una sola tarjeta también dispara una sola vez.

import type { Page } from '@playwright/test';
import { expect, test } from './console.fixture';
import { loginDemo } from './helpers';

const RATING = /^¿Qué tal la recordaste\?$/;

interface DemoIndex {
  routes: Record<string, string>;
}

async function installBurstProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const host = window as Window & {
      __francesTier?: string;
      __francesDprCap?: number;
      __rafCount?: () => number;
      __burstFireWrites?: () => string[];
    };
    host.__francesTier = 'full';
    host.__francesDprCap = 1;

    const origRaf = window.requestAnimationFrame.bind(window);
    let frames = 0;
    window.requestAnimationFrame = (callback) => {
      frames += 1;
      return origRaf(callback);
    };
    host.__rafCount = () => frames;

    const writes: string[] = [];
    const origSet = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (name === 'data-burst-fires') writes.push(String(value));
      return origSet.call(this, name, value);
    };
    host.__burstFireWrites = () => writes.slice();
  });
}

async function fireWrites(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = window as Window & { __burstFireWrites?: () => string[] };
    return host.__burstFireWrites?.() ?? [];
  });
}

async function rateBien(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Mostrar respuesta' }).click();
  await page
    .getByRole('group', { name: RATING })
    .getByRole('button', { name: /^Bien/ })
    .click();
}

async function expectOverlayBox(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const box = await page.locator('.burst-overlay').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const width = viewport?.width ?? 0;
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(box.width).toBeLessThanOrEqual(Math.min(440, width));
  expect(box.height).toBeLessThanOrEqual(280);
}

test('calificar Bien dispara una ráfaga acotada y luego el rAF descansa', async ({
  page,
}) => {
  await installBurstProbes(page);
  await loginDemo(page, '/repasar');
  expect(await fireWrites(page)).toEqual([]);

  await rateBien(page);
  // El chunk de la ráfaga llega después del clic. Los 2 s empiezan cuando el
  // disparo ya está en el DOM: la vida de la variante grade es 1,15 s.
  await expect.poll(() => fireWrites(page)).toEqual(['0', '1']);
  await expect(page.locator('[data-burst-fires]')).toHaveAttribute(
    'data-burst-fires',
    '1',
  );
  await expectOverlayBox(page);

  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  const before = await page.evaluate(() => {
    const host = window as Window & { __rafCount?: () => number };
    return host.__rafCount?.() ?? -1;
  });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const host = window as Window & { __rafCount?: () => number };
    return host.__rafCount?.() ?? -1;
  });
  expect(after - before).toBe(0);
});

test('la última tarjeta dispara la ráfaga una sola vez al terminar', async ({
  page,
}) => {
  const indexRes = await page.request.get('/demo-api/index.json');
  expect(indexRes.ok()).toBe(true);
  const index = (await indexRes.json()) as DemoIndex;
  const file = index.routes['GET /api/review/queue'];
  const queueKeys = Object.keys(index.routes).filter((key) =>
    key.startsWith('GET /api/review/queue'),
  );
  expect(
    typeof file,
    `falta GET /api/review/queue (${queueKeys.join(', ')})`,
  ).toBe('string');
  if (typeof file !== 'string') return;

  await page.route(`**/demo-api/${file}`, async (route) => {
    const response = await route.fetch();
    const body: unknown = await response.json();
    expect(Array.isArray(body)).toBe(true);
    const cards = (body as unknown[]).slice(0, 1);
    await route.fulfill({
      status: response.status(),
      contentType: 'application/json',
      body: JSON.stringify(cards),
    });
  });

  await installBurstProbes(page);
  await loginDemo(page, '/repasar');
  await rateBien(page);
  await expect(
    page.getByRole('heading', { name: 'Sesión terminada' }),
  ).toBeVisible();
  await expect.poll(() => fireWrites(page)).toEqual(['0', '1']);
  await expect(page.locator('[data-burst-fires]')).toHaveAttribute(
    'data-burst-fires',
    '1',
  );
  await page.waitForTimeout(400);
  expect(await fireWrites(page)).toEqual(['0', '1']);
});
