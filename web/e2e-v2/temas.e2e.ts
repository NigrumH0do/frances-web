// Temas (UI-13/UI-14): filtros, detalle con cuatro pestañas y publicación con
// el PDF en canvas y el enlace seguro a Classroom.

import { expect, test } from '@playwright/test';
import {
  DEMO_ITEM_ID,
  DEMO_TOPIC_ID,
  DEMO_TOPIC_TITLE,
  loginDemo,
} from './helpers';

// El service worker no hace falta en estas pantallas y estorbaría al
// interceptar la instantánea para probar el enlace de Classroom.
test.use({ serviceWorkers: 'block' });

test('filtra por pendientes y busca por texto', async ({ page }) => {
  await loginDemo(page, '/temas');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Temas' }),
  ).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Buscar temas' });
  await search.fill('nasales');
  await expect(page.getByRole('link', { name: /Les nasales/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Salutations/ })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    '2 temas ocultos por el filtro',
  );

  await search.fill('');
  const pending = page.getByRole('button', { name: 'Con pendientes' });
  await pending.click();
  await expect(pending).toHaveAttribute('aria-pressed', 'true');
});

test('el detalle del tema tiene las 4 pestañas', async ({ page }) => {
  await loginDemo(page, `/temas/${DEMO_TOPIC_ID}`);
  await expect(
    page.getByRole('heading', { level: 1, name: DEMO_TOPIC_TITLE }),
  ).toBeVisible();

  const tabs = page.getByRole('tablist', { name: 'Partes del tema' });
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(tabs.getByRole('tab', { name: 'Resumen' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await tabs.getByRole('tab', { name: 'Clases' }).click();
  await expect(page.getByRole('link', { name: /Leçon 1/ })).toBeVisible();

  await tabs.getByRole('tab', { name: 'Tarjetas' }).click();
  await expect(page.getByRole('list', { name: 'Tarjetas' })).toBeVisible();

  await tabs.getByRole('tab', { name: 'Quiz' }).click();
  await expect(page.getByRole('link', { name: 'Empezar' })).toBeVisible();

  await tabs.getByRole('tab', { name: 'Resumen' }).click();
  await expect(page.getByRole('tabpanel')).toBeVisible();
});

test('la publicación pinta el PDF en canvas y omite un enlace ajeno', async ({
  page,
}) => {
  await loginDemo(page, `/publicaciones/${DEMO_ITEM_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Leçon 1',
  );
  await expect(
    page.getByRole('img', { name: /Página 1 de \d+/ }),
  ).toBeVisible();
  // La instantánea usa `https://example.org/...`; UI-14 solo pinta el enlace
  // si es del Classroom de Google.
  await expect(
    page.getByRole('link', { name: 'Abrir en Classroom' }),
  ).toHaveCount(0);
});

test('un enlace de Classroom sí se pinta', async ({ page }) => {
  await page.route('**/demo-api/r/**', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      item?: { id?: string };
      alternate_link?: string | null;
    };
    if (body.item?.id === DEMO_ITEM_ID) {
      body.alternate_link = 'https://classroom.google.com/c/demo';
    }
    await route.fulfill({ response, json: body });
  });

  await loginDemo(page, `/publicaciones/${DEMO_ITEM_ID}`);
  const link = page.getByRole('link', { name: 'Abrir en Classroom' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    'href',
    'https://classroom.google.com/c/demo',
  );
});
