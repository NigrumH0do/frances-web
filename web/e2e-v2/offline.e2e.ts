// Sin conexión (P09-4, UI-07/UI-09): el service worker sirve el shell y la
// instantánea del demo, las reseñas entran en la cola y se envían al volver la
// red. Es el e2e del Review Focus P09-4.

import { expect, test, type Page } from './console.fixture';
import { loginDemo } from './helpers';

async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // `clientsClaim` puede no haber tomado esta pestaña todavía; una recarga
  // garantiza que la navegación ya pase por el service worker.
  await page.reload();
  await expect
    .poll(
      () => page.evaluate(() => navigator.serviceWorker.controller !== null),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function cacheEntries(page: Page, name: string): Promise<number> {
  return page.evaluate(async (cacheName) => {
    if (typeof caches === 'undefined') return 0;
    const names = await caches.keys();
    if (!names.includes(cacheName)) return 0;
    const cache = await caches.open(cacheName);
    return (await cache.keys()).length;
  }, name);
}

async function outboxCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('frances-v2');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('outbox')) {
            db.close();
            resolve(0);
            return;
          }
          const count = db
            .transaction('outbox', 'readonly')
            .objectStore('outbox')
            .count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => {
            db.close();
            reject(count.error);
          };
        };
      }),
  );
}

test('offline: shell cacheado, cola de reseñas y sincronización', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await loginDemo(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    /Buenos días|Buenas tardes|Buenas noches/,
  );
  await waitForServiceWorker(page);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Secciones' });
  await nav.locator('a[href="/repasar"]').click();
  await expect(
    page.getByRole('button', { name: 'Mostrar respuesta' }),
  ).toBeVisible();
  await nav.locator('a[href="/"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // La instantánea del demo se cachea con NetworkFirst; esperar a que la
  // primera navegación haya dejado sus cuerpos en `frances-demo`.
  await expect
    .poll(() => cacheEntries(page, 'frances-demo'), { timeout: 30_000 })
    .toBeGreaterThan(0);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(
    page.getByText('Sin conexión. Verás lo último que se guardó'),
  ).toBeVisible();

  // El chat nunca usa la caché y lo dice en texto.
  await nav.locator('a[href="/chat"]').click();
  await expect(page.getByText('El chat necesita conexión')).toBeVisible();

  await nav.locator('a[href="/repasar"]').click();
  await expect(
    page.getByRole('button', { name: 'Mostrar respuesta' }),
  ).toBeVisible();
  for (let index = 0; index < 2; index += 1) {
    await page.getByRole('button', { name: 'Mostrar respuesta' }).click();
    await page
      .getByRole('group', { name: '¿Qué tal la recordaste?' })
      .getByRole('button', { name: /^Bien/ })
      .click();
  }
  await expect(page.getByText(/2 cambios esperando/)).toBeVisible();
  expect(await outboxCount(page)).toBe(2);

  // Guardar el texto de la franja mientras vuelve la red: «Sincronizando…»
  // puede durar muy poco y no se debe asertar por sondeo tardío.
  await page.evaluate(() => {
    const texts: string[] = [];
    (window as unknown as { __bannerTexts?: string[] }).__bannerTexts = texts;
    const observer = new MutationObserver(() => {
      for (const node of document.querySelectorAll('[role="status"]')) {
        const text = node.textContent?.trim() ?? '';
        if (text !== '' && !texts.includes(text)) texts.push(text);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });

  await context.setOffline(false);
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (
            (window as unknown as { __bannerTexts?: string[] }).__bannerTexts ??
            []
          ).some((text) => text.includes('Sincronizando…')),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);

  await expect(page.getByText(/cambios esperando/)).toHaveCount(0);
  await expect.poll(() => outboxCount(page), { timeout: 30_000 }).toBe(0);
  await expect(
    page.getByText('Sin conexión. Verás lo último que se guardó'),
  ).toHaveCount(0);
});
