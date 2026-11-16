// Pantalla Hoy (UI-12): plan del día, enlaces y marca de «Hecho» persistente.

import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

test('el plan enlaza cada entrada con su pantalla', async ({ page }) => {
  await loginDemo(page);
  const plan = page.locator('section[aria-labelledby="plan-hoy"]');
  await expect(plan).toBeVisible();

  const links = plan.locator('a[href]');
  await expect(links.first()).toBeVisible();
  const hrefs = await links.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')),
  );
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect(href).toMatch(
      /^\/(?:repasar(?:\/pronunciacion)?|temas|quiz\/|publicaciones\/)/,
    );
  }
});

test('marcar hecho y recargar lo conserva', async ({ page }) => {
  await loginDemo(page);
  const checkbox = page.getByRole('checkbox', { name: 'Hecho' }).first();
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  await expect(checkbox).toBeChecked();

  await page.reload();
  const reloaded = page.getByRole('checkbox', { name: 'Hecho' }).first();
  await expect(reloaded).toBeChecked();
});
