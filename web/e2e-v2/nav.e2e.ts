// Navegación del shell v2 (UI-09): barra inferior, enlaces profundos, atrás y
// foco en el encabezado de cada pantalla.

import { expect, test } from '@playwright/test';
import {
  DEMO_QUIZ_ID,
  DEMO_TOPIC_ID,
  DEMO_TOPIC_TITLE,
  loginDemo,
} from './helpers';

test('las 5 pestañas marcan aria-current al navegar', async ({ page }) => {
  await loginDemo(page);
  const nav = page.getByRole('navigation', { name: 'Secciones' });
  await expect(nav.getByRole('link')).toHaveCount(5);

  const tabs = [
    { href: '/', heading: null },
    { href: '/temas', heading: 'Temas' },
    { href: '/repasar', heading: 'Repasar' },
    { href: '/chat', heading: 'Chat' },
    { href: '/mas', heading: 'Más' },
  ] as const;

  for (const tab of tabs) {
    await nav.locator(`a[href="${tab.href}"]`).click();
    await expect(nav.locator(`a[href="${tab.href}"]`)).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    if (tab.heading !== null) {
      await expect(
        page.getByRole('heading', { level: 1, name: tab.heading }),
      ).toBeVisible();
    }
  }
});

test('enlaces profundos y atrás del navegador', async ({ page }) => {
  await loginDemo(page, '/temas');
  await page.getByRole('link', { name: new RegExp(DEMO_TOPIC_TITLE) }).click();
  await expect(page).toHaveURL(new RegExp(`/temas/${DEMO_TOPIC_ID}$`));
  await expect(
    page.getByRole('heading', { level: 1, name: DEMO_TOPIC_TITLE }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/temas$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Temas' }),
  ).toBeVisible();

  await page.goto(`/quiz/${DEMO_QUIZ_ID}`);
  await expect(page).toHaveURL(new RegExp(`/quiz/${DEMO_QUIZ_ID}$`));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/temas$/);
});

test('el foco va al h1 al cambiar de pantalla', async ({ page }) => {
  await loginDemo(page);

  const nav = page.getByRole('navigation', { name: 'Secciones' });
  await nav.locator('a[href="/temas"]').click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Temas' }),
  ).toBeFocused();

  await nav.locator('a[href="/mas"]').click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Más' }),
  ).toBeFocused();
});
