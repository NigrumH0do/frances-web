// QA-03: sin WebGL cuando el movimiento está apagado, paleta de sistema,
// pérdida de contexto en la brújula y LCP que no es un canvas.

import type { Page } from '@playwright/test';
import { expect, test } from './console.fixture';
import { loginDemo } from './helpers';

const THREE_ASSET = /\/assets\/three-[^/]+\.js$/;

type MotionPath =
  '/entrar' | '/' | '/repasar' | '/repasar/pronunciacion' | '/repasar/texto';

function trackThree(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (THREE_ASSET.test(path)) hits.push(path);
  });
  return hits;
}

async function assertMotionRoute(page: Page, path: MotionPath): Promise<void> {
  await expect(page.locator('canvas')).toHaveCount(0);
  if (path === '/entrar') {
    await expect(page.locator('.notebook-fallback')).toBeVisible();
    return;
  }
  if (path === '/') {
    await expect(page.locator('.hoy-compass-slot svg')).toBeVisible();
    return;
  }
  if (path === '/repasar') {
    await expect(
      page.getByRole('button', { name: 'Mostrar respuesta' }),
    ).toBeVisible();
    return;
  }
  await expect(page.locator('.orb-fallback')).toBeVisible();
}

async function visitMotionRoutes(page: Page): Promise<void> {
  await page.goto('/entrar');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Entrar' }),
  ).toBeVisible();
  await assertMotionRoute(page, '/entrar');

  await loginDemo(page, '/');
  await assertMotionRoute(page, '/');

  for (const path of [
    '/repasar',
    '/repasar/pronunciacion',
    '/repasar/texto',
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await assertMotionRoute(page, path);
  }
}

async function installFullTier(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const host = window as Window & {
      __francesTier?: string;
      __francesDprCap?: number;
    };
    host.__francesTier = 'full';
    host.__francesDprCap = 1;
  });
}

test('prefers-reduced-motion no monta canvas ni pide three', async ({
  page,
}) => {
  const hits = trackThree(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await visitMotionRoutes(page);
  expect(hits).toEqual([]);
});

test('frances.motion3d off no monta canvas ni pide three', async ({ page }) => {
  const hits = trackThree(page);
  await page.addInitScript(() => {
    localStorage.setItem('frances.motion3d', 'off');
  });
  await visitMotionRoutes(page);
  expect(hits).toEqual([]);
});

test('el tema de sistema marca la paleta y theme-light la cambia en caliente', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    localStorage.removeItem('fc-theme');
    const root = document.documentElement;
    if (root !== null) root.classList.remove('theme-light', 'theme-dark');
    const host = window as Window & {
      __francesTier?: string;
      __francesDprCap?: number;
    };
    host.__francesTier = 'full';
    host.__francesDprCap = 1;
  });

  await loginDemo(page, '/');
  await expect(page.locator('.hoy-compass-slot canvas')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.palette))
    .toBe('dark');

  await page.evaluate(() => {
    document.documentElement.classList.add('theme-light');
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.palette), {
      timeout: 500,
      intervals: [20, 20, 50, 50],
    })
    .toBe('light');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('perder el contexto WebGL muestra la brújula editorial', async ({
  page,
}, testInfo) => {
  await installFullTier(page);
  await loginDemo(page, '/');
  await expect(page.locator('.hoy-compass-slot')).toBeVisible();

  const webkit = testInfo.project.name.includes('webkit');
  let sawChunk = false;
  const onResponse = (response: { url: () => string }): void => {
    if (THREE_ASSET.test(new URL(response.url()).pathname)) sawChunk = true;
  };
  page.on('response', onResponse);

  let mode = '';
  const started = Date.now();
  try {
    await expect
      .poll(async () => {
        if ((await page.locator('canvas').count()) > 0) {
          mode = 'webgl';
          return mode;
        }
        const svg = await page.locator('.hoy-compass-slot svg').count();
        if (svg > 0 && (sawChunk || Date.now() - started > 8_000)) {
          mode = 'css';
          return mode;
        }
        return '';
      })
      .not.toBe('');
  } finally {
    page.off('response', onResponse);
  }

  if (mode === 'css') {
    expect(webkit, 'Chromium debe crear contexto con __francesTier=full').toBe(
      true,
    );
    testInfo.annotations.push({
      type: 'webkit-webgl-unavailable',
      description:
        'WebKit no creó contexto WebGL; se acepta el camino css (0 canvas, fallback, 0 errores).',
    });
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.locator('.hoy-compass-slot svg')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    return;
  }

  const lost = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (canvas === null) return 'no-canvas';
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl === null) return 'no-context';
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext === null) return 'no-extension';
    ext.loseContext();
    return 'lost';
  });
  expect(lost).toBe('lost');

  await expect(page.locator('.hoy-compass-slot svg')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('el LCP de entrar, hoy y repasar no es un canvas', async ({
  page,
  browserName,
}) => {
  const supported = await page.evaluate(
    () =>
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes.includes(
        'largest-contentful-paint',
      ),
  );
  test.skip(
    browserName === 'webkit' && !supported,
    'WebKit sin largest-contentful-paint',
  );
  expect(supported).toBe(true);

  await page.goto('/entrar');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Entrar' }),
  ).toBeVisible();
  await expectLcpNotCanvas(page);

  await loginDemo(page, '/');
  await expectLcpNotCanvas(page);

  await page.goto('/repasar');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Repasar' }),
  ).toBeVisible();
  await expectLcpNotCanvas(page);
});

async function expectLcpNotCanvas(page: Page): Promise<void> {
  const entry = await page.evaluate(
    () =>
      new Promise<{ tag: string | null; startTime: number } | null>(
        (resolve) => {
          let latest: { tag: string | null; startTime: number } | null = null;
          let settled = false;
          const finish = (): void => {
            if (settled) return;
            settled = true;
            resolve(latest);
          };
          try {
            const observer = new PerformanceObserver((list) => {
              for (const item of list.getEntries()) {
                const painted = item as PerformanceEntry & {
                  element?: Element | null;
                };
                latest = {
                  tag: painted.element ? painted.element.tagName : null,
                  startTime: painted.startTime,
                };
              }
            });
            observer.observe({
              type: 'largest-contentful-paint',
              buffered: true,
            });
            window.setTimeout(() => {
              observer.disconnect();
              finish();
            }, 3000);
          } catch {
            finish();
          }
        },
      ),
  );

  expect(entry, 'no hubo largest-contentful-paint en 3 s').not.toBeNull();
  const paint = entry as { tag: string | null; startTime: number };
  expect(paint.startTime).toBeLessThanOrEqual(3000);
  if (paint.tag !== null) expect(paint.tag).not.toBe('CANVAS');
}
