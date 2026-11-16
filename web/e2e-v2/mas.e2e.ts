// Más (UI-19): tema persistente, tarjetas nuevas por día y ausencia de admin
// para el usuario demo.

import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

test('el tema oscuro persiste tras recargar', async ({ page }) => {
  await loginDemo(page, '/mas');
  const theme = page.getByRole('radiogroup', { name: 'Tema' });
  await theme.getByRole('radio', { name: 'Oscuro' }).click();
  await expect(page.locator('html')).toHaveClass(/theme-dark/);

  await page.reload();
  await expect(page.locator('html')).toHaveClass(/theme-dark/);
});

test('las tarjetas nuevas por día se guardan', async ({ page }) => {
  await loginDemo(page, '/mas');
  const daily = page.getByRole('radiogroup', {
    name: 'Tarjetas nuevas por día',
  });
  await daily.getByRole('radio', { name: '20' }).click();
  await expect(page.getByText('Ajustes guardados.')).toBeVisible();

  await page.reload();
  const reloaded = page.getByRole('radiogroup', {
    name: 'Tarjetas nuevas por día',
  });
  await expect(reloaded.getByRole('radio', { name: '20' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('el usuario demo no ve Administración', async ({ page }) => {
  await loginDemo(page, '/mas');
  await expect(page.getByText('demo@example.com')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Administración' }),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Administración/ })).toHaveCount(
    0,
  );
});
