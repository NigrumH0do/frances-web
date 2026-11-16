// El servidor define el CSRF en `__Host-frances_csrf` legible por JS
// (SRV-04, plan maestro v2). El cliente lo copia al header `X-CSRF-Token`.

export const CSRF_COOKIE = '__Host-frances_csrf';

export function readCsrfCookie(
  cookie: string = typeof document === 'undefined' ? '' : document.cookie,
): string | null {
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== CSRF_COOKIE) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw) || null;
    } catch {
      return null;
    }
  }
  return null;
}
