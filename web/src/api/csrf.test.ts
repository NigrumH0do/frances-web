import { CSRF_COOKIE, readCsrfCookie } from './csrf';

it('CSRF cookie name matches the master plan', () => {
  expect(CSRF_COOKIE).toBe('__Host-frances_csrf');
});

it('lee el token de la cookie legible si no hay uno en memoria', () => {
  expect(readCsrfCookie('a=1; __Host-frances_csrf=tok%3D; b=2')).toBe('tok=');
});

it('devuelve null si la cookie no existe o está vacía', () => {
  expect(readCsrfCookie('a=1; b=2')).toBeNull();
  expect(readCsrfCookie('__Host-frances_csrf=')).toBeNull();
  expect(readCsrfCookie('')).toBeNull();
});
