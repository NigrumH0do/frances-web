// Sesión v2 (Task UI-08): login, `next`, invitación y cierre de sesión.

import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

test('credenciales malas muestran un mensaje genérico', async ({ page }) => {
  await page.goto('/entrar');
  await page.getByLabel('Email').fill('nadie@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill('no-es-la-clave');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Email o contraseña incorrectos.');
  await expect(alert).not.toContainText('no existe');
  await expect(page).toHaveURL(/\/entrar/);
});

test('entrar lleva a Hoy', async ({ page }) => {
  await loginDemo(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    /Buenos días|Buenas tardes|Buenas noches/,
  );
});

test('next lleva a la ruta pedida', async ({ page }) => {
  await page.goto('/temas');
  await expect(page).toHaveURL(/\/entrar\?next=%2Ftemas$/);
  await page.getByRole('button', { name: 'Entrar al demo' }).click();
  await expect(page).toHaveURL(/\/temas$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Temas' }),
  ).toBeVisible();
});

test('next=//evil.test termina en la raíz', async ({ page }) => {
  await page.goto('/entrar?next=//evil.test');
  await page.getByRole('button', { name: 'Entrar al demo' }).click();
  await expect(page).toHaveURL(/http:\/\/localhost:4174\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    /Buenos días|Buenas tardes|Buenas noches/,
  );
});

test('la invitación borra el fragmento, valida 12 caracteres y entra', async ({
  page,
}) => {
  await page.goto('/invitacion#demo');
  await expect(page).toHaveURL(/\/invitacion$/);
  await expect(
    page.getByRole('heading', { name: 'Aceptar invitación' }),
  ).toBeVisible();

  await expect(page.getByLabel('Email')).toBeVisible();
  await page.getByLabel('Email').fill('companera@example.com');
  await page.getByLabel('Nombre visible').fill('Compañera Demo');
  await page.getByLabel('Contraseña', { exact: true }).fill('12345678901');
  await page.getByLabel('Confirmar contraseña').fill('12345678901');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('alert')).toContainText('al menos 12 caracteres');

  await page.getByLabel('Contraseña', { exact: true }).fill('123456789012');
  await page.getByLabel('Confirmar contraseña').fill('123456789012');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(page).toHaveURL(/http:\/\/localhost:4174\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('cerrar sesión vuelve a /entrar', async ({ page }) => {
  await loginDemo(page, '/mas');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/entrar(?:\?|$)/);
  await expect(
    page.getByRole('button', { name: 'Entrar al demo' }),
  ).toBeVisible();
});
