// `next` de la URL de login: solo rutas internas de la app (P09-2).
// Rechaza rutas absolutas de otro origen (`//`), esquemas (`:`) y `\`.

export function safeNext(raw: string | null): string {
  if (raw === null) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  if (raw.includes(':') || raw.includes('\\')) return '/';
  return raw;
}
