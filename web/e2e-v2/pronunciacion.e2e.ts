// Pronunciación (UI-16): recognizer falso del build VITE_E2E, puntajes por
// palabra y fonema. No se pide token de Azure real.

import { expect, test } from './console.fixture';
import { installFakeRecognizer, loginDemo } from './helpers';

test('grabar con el recognizer falso muestra puntajes y fonemas', async ({
  page,
}) => {
  await installFakeRecognizer(page);
  await loginDemo(page, '/repasar/pronunciacion');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Pronunciación' }),
  ).toBeVisible();

  await expect(page.getByText(/Frase 1 de \d+/)).toBeVisible();
  await page.getByRole('button', { name: 'Grabar' }).click();

  const score = page.getByRole('region', { name: 'Puntaje global' });
  await expect(score).toBeVisible();
  await expect(score).toContainText('Exactitud');
  await expect(score).toContainText('Fluidez');

  const words = page.getByRole('list', { name: 'Palabras' });
  await expect(words.getByRole('button').first()).toBeVisible();
  await words.getByRole('button').first().click();
  await expect(page.getByRole('list', { name: /Fonemas de / })).toBeVisible();
});
