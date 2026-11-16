// Accesibilidad (P09-8, parte de navegador): axe sin violaciones graves en
// claro y oscuro, objetivos táctiles de 44 px y movimiento reducido sin
// animación de volteo.

import { expect, test } from '@playwright/test';
import { axe, expectTapTargets, loginDemo, screenPaths } from './helpers';

test('sin violaciones graves, 44 px y volteo sin animación', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await loginDemo(page, '/chat');
  if (/\/chat$/.test(page.url())) {
    await page
      .getByRole('button', { name: 'Nueva conversación' })
      .first()
      .click();
    await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  }
  const threadId = page.url().split('/').pop() ?? '';

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({
      colorScheme: scheme,
      reducedMotion: 'reduce',
    });
    for (const path of screenPaths(threadId)) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      // WebKit puede exponer `getComputedStyle` antes de aplicar la hoja
      // (fondo transparente y texto negro del UA) y, al cambiar de esquema,
      // deja etiquetas con el color del navegador. Se espera a que el tema
      // esté aplicado del todo antes de medir contraste; no se relaja axe.
      await page.waitForFunction(() => {
        const body = getComputedStyle(document.body);
        const label = document.querySelector('label[for]');
        const labelColor = label === null ? '' : getComputedStyle(label).color;
        return (
          body.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
          body.color !== 'rgb(0, 0, 0)' &&
          body.color !== 'rgb(255, 255, 255)' &&
          labelColor !== 'rgb(0, 0, 0)' &&
          labelColor !== 'rgb(255, 255, 255)'
        );
      });

      if (path === '/repasar') {
        await page.getByRole('button', { name: 'Mostrar respuesta' }).click();
        const duration = await page.evaluate(
          () =>
            getComputedStyle(document.querySelector('.flip-inner') as Element)
              .transitionDuration,
        );
        expect(['0s', '0.00001s', '1e-05s']).toContain(duration);
      }

      await axe(page);
      await expectTapTargets(page);
    }
  }
});
