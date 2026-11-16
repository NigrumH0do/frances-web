import '@testing-library/jest-dom/vitest';
import { describe, expect, test } from 'vitest';
import { messageFor } from './errors';
import { tr } from './es';

describe('messageFor', () => {
  test('messageFor traduce códigos conocidos y cae al mensaje del servidor', () => {
    expect(messageFor({ kind: 'offline' })).toBe('Sin conexión');
    expect(
      messageFor({ kind: 'http', status: 418, code: 'x', message: 'Mensaje' }),
    ).toBe('Mensaje');
  });

  test('csrf y unauthenticated son textos distintos y en español', () => {
    expect(
      messageFor({ kind: 'http', status: 403, code: 'csrf', message: '' }),
    ).toBe('La sesión caducó; recarga la página');
    expect(
      messageFor({
        kind: 'http',
        status: 401,
        code: 'unauthenticated',
        message: '',
      }),
    ).toMatch(/Inicia sesión/);
  });

  test('código desconocido sin mensaje usa el texto genérico', () => {
    expect(
      messageFor({ kind: 'http', status: 500, code: 'raro', message: '' }),
    ).toBe('Algo salió mal');
  });

  test('ignora propiedades heredadas del objeto', () => {
    expect(
      messageFor({
        kind: 'http',
        status: 500,
        code: 'constructor',
        message: '',
      }),
    ).toBe('Algo salió mal');
  });
});

describe('tr', () => {
  test('sustituye {nombre} por el valor y deja los marcadores sin valor', () => {
    expect(
      tr('Hola, {nombre}. Tienes {n} tarjetas.', { nombre: 'Ana', n: 3 }),
    ).toBe('Hola, Ana. Tienes 3 tarjetas.');
    expect(tr('Falta {x}')).toBe('Falta {x}');
  });
});
