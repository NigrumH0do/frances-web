// Repaso FSRS (UI-15): volteo con Espacio, intervalos, calificación 1–4,
// suspender con deshacer y fin de sesión.

import { expect, test } from './console.fixture';
import { loginDemo } from './helpers';

const RATING = /^¿Qué tal la recordaste\?$/;

test('voltear con Espacio muestra los intervalos y califica con el teclado', async ({
  page,
}) => {
  await loginDemo(page, '/repasar');
  await expect(
    page.getByRole('button', { name: 'Mostrar respuesta' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();

  await page.keyboard.press('Space');
  const ratings = page.getByRole('group', { name: RATING });
  await expect(ratings).toBeVisible();
  await expect(ratings.getByRole('button')).toHaveCount(4);
  const intervals = await ratings.locator('button small').allTextContents();
  expect(intervals).toHaveLength(4);
  for (const interval of intervals) expect(interval.trim()).not.toBe('');

  await page.keyboard.press('3');
  await expect(page.getByText('2/10')).toBeVisible();
});

test('suspender se puede deshacer', async ({ page }) => {
  await loginDemo(page, '/repasar');
  await expect(page.getByRole('button', { name: 'Suspender' })).toBeVisible();
  await page.getByRole('button', { name: 'Suspender' }).click();
  await expect(page.getByText('Tarjeta suspendida.')).toBeVisible();

  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.getByText('Tarjeta suspendida.')).toHaveCount(0);
});

test('al calificar todas las tarjetas termina la sesión', async ({ page }) => {
  test.setTimeout(180_000);
  await loginDemo(page, '/repasar');
  for (let index = 0; index < 10; index += 1) {
    await page.getByRole('button', { name: 'Mostrar respuesta' }).click();
    await page
      .getByRole('group', { name: RATING })
      .getByRole('button', { name: /^Bien/ })
      .click();
  }
  await expect(
    page.getByRole('heading', { name: 'Sesión terminada' }),
  ).toBeVisible();
  await expect(page.getByText('Repasadas: 10')).toBeVisible();
});
