// Quiz (UI-17): los 5 tipos de pregunta, orden solo con teclado, envío y
// resultados, y borrador que sobrevive a una recarga.

import { expect, test, type Page } from './console.fixture';
import { DEMO_QUIZ_ID, loginDemo } from './helpers';

async function answerCurrent(page: Page): Promise<void> {
  const radios = page.getByRole('radio');
  if ((await radios.count()) > 0) {
    await radios.first().click();
    return;
  }

  const words = page.getByRole('group', { name: 'Palabras' });
  if ((await words.count()) > 0) {
    const tiles = words.getByRole('button');
    await tiles.first().focus();
    await page.keyboard.press('Enter');
    if ((await tiles.count()) > 0) {
      await tiles.first().focus();
      await page.keyboard.press('Enter');
    }
    const moveDown = page
      .getByRole('group', { name: 'Frase' })
      .getByRole('button', { name: /^Bajar / })
      .first();
    if ((await moveDown.count()) > 0 && (await moveDown.isEnabled())) {
      await moveDown.focus();
      await page.keyboard.press('Enter');
    }
    return;
  }

  const translate = page.getByRole('textbox', { name: /Traducción/ });
  if ((await translate.count()) > 0) {
    await translate.fill('bonjour');
    return;
  }

  const dictation = page.getByRole('textbox', { name: 'Lo que oyes' });
  if ((await dictation.count()) > 0) {
    await dictation.fill('bonjour');
    return;
  }

  await page.getByRole('textbox', { name: 'Respuesta' }).fill('bonjour');
}

test('los 5 tipos se responden, se envía y se ven los resultados', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await loginDemo(page, `/quiz/${DEMO_QUIZ_ID}`);
  await expect(page.getByText('1 de 12')).toBeVisible();

  let sawOrder = false;
  for (let index = 0; index < 12; index += 1) {
    if ((await page.getByRole('group', { name: 'Palabras' }).count()) > 0) {
      sawOrder = true;
    }
    await answerCurrent(page);
    await page
      .getByRole('button', { name: index === 11 ? 'Revisar' : 'Siguiente' })
      .click();
  }
  expect(sawOrder).toBe(true);

  await expect(
    page.getByRole('heading', { name: 'Revisa tus respuestas' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(
    page.getByRole('heading', { name: 'Resultado del quiz' }),
  ).toBeVisible();
  await expect(page.getByText(/de 12 correctas/)).toBeVisible();
});

test('recargar a mitad conserva el borrador', async ({ page }) => {
  await loginDemo(page, `/quiz/${DEMO_QUIZ_ID}`);
  const option = page.getByRole('radio', { name: 'Encantado' });
  await option.click();
  await expect(option).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await expect(page.getByRole('radio', { name: 'Encantado' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
