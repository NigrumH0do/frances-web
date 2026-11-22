// Texto libre (PRACTICE-01): escribir, letras francesas, aviso del audio en el
// demo y grabación evaluada con el recognizer falso del build VITE_E2E.

import { expect, test } from './console.fixture';
import { installFakeRecognizer, loginDemo } from './helpers';

test('escribir, insertar letras y evaluar la pronunciación', async ({
  page,
}) => {
  await installFakeRecognizer(page);
  await loginDemo(page, '/repasar/texto');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Texto libre' }),
  ).toBeVisible();

  const editor = page.getByRole('textbox', { name: 'Tu texto en francés' });
  await editor.fill('Bonjour, ca va');
  await editor.evaluate((el: HTMLTextAreaElement) =>
    el.setSelectionRange(9, 10),
  );
  await page.getByRole('button', { name: 'Escribir ç' }).click();
  await expect(editor).toHaveValue('Bonjour, ça va');

  // El demo no sintetiza audio nuevo: se avisa y se ofrece reintentar.
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Tu texto en francés' }),
  ).toHaveAttribute('spellcheck', 'false');

  await page.getByRole('button', { name: 'Grabar y evaluar' }).click();
  const score = page.getByRole('region', { name: 'Puntaje global' });
  await expect(score).toBeVisible();
  await expect(score).toContainText('Exactitud');
  await expect(
    page.getByRole('heading', { name: 'Palabras para repetir' }),
  ).toBeVisible();
});

test('una frase de arranque llena el editor y Hoy enlaza la sección', async ({
  page,
}) => {
  await loginDemo(page, '/');
  await page.getByRole('link', { name: /Practica un texto tuyo/ }).click();
  await expect(page).toHaveURL(/\/repasar\/texto$/);
  await page
    .getByRole('button', { name: 'Où se trouve la gare la plus proche ?' })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Tu texto en francés' }),
  ).toHaveValue('Où se trouve la gare la plus proche ?');
});
