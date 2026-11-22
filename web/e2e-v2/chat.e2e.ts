// Chat (UI-18): «pensando» con cronómetro, cancelar, citas que abren la
// publicación y respuesta sin fuentes.

import { expect, test, type Page } from './console.fixture';
import {
  DEMO_CHAT_QUESTION,
  DEMO_NO_MATERIAL_QUESTION,
  loginDemo,
  setChatDelay,
} from './helpers';

async function startThread(page: Page): Promise<void> {
  await loginDemo(page, '/chat');
  if (/\/chat$/.test(page.url())) {
    await page
      .getByRole('button', { name: 'Nueva conversación' })
      .first()
      .click();
    await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  }
  await expect(page.getByRole('textbox', { name: 'Pregunta' })).toBeEnabled();
}

async function ask(page: Page, question: string): Promise<void> {
  const composer = page.getByRole('textbox', { name: 'Pregunta' });
  await composer.fill(question);
  await page.keyboard.press('Enter');
}

test('pensando con cronómetro y cancelar', async ({ page }) => {
  await setChatDelay(page, 2000);
  await startThread(page);
  await ask(page, DEMO_CHAT_QUESTION);

  const thinking = page.getByRole('status').filter({ hasText: 'Pensando' });
  await expect(thinking).toContainText(/Pensando… [1-9] s/);
  await expect(thinking).toContainText('Buscando en el material');

  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByText('Cancelada')).toBeVisible();
});

test('una pregunta grabada muestra citas que abren la publicación', async ({
  page,
}) => {
  await startThread(page);
  await ask(page, DEMO_CHAT_QUESTION);

  await expect(
    page.getByText(
      'Modo demo: estos son los fragmentos del material que responden.',
    ),
  ).toBeVisible();
  const citation = page
    .getByRole('link', { name: /Annonce : examen oral/ })
    .first();
  await expect(citation).toBeVisible();
  await expect(citation).toHaveAttribute(
    'href',
    /\/publicaciones\/an_demo6(?:\?|$)/,
  );
  await citation.click();
  await expect(page).toHaveURL(/\/publicaciones\/an_demo6/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('una pregunta sin material muestra el aviso', async ({ page }) => {
  await startThread(page);
  await ask(page, DEMO_NO_MATERIAL_QUESTION);
  await expect(page.getByText('Sin fuentes en el material')).toBeVisible();
});
