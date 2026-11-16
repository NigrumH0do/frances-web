export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_KEY = 'fc-theme';

const MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

// Pone la clase de tema en <html> y guarda la elección. `system` quita la clase
// y borra la preferencia guardada. Si localStorage falla, el tema se aplica igual.
export function applyTheme(
  mode: ThemeMode,
  root: HTMLElement = document.documentElement,
): void {
  root.classList.remove('theme-light', 'theme-dark');
  if (mode !== 'system') root.classList.add(`theme-${mode}`);
  try {
    if (mode === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Sin almacenamiento (modo privado, cuota): la preferencia sólo dura la sesión.
  }
}

export function initialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved !== null && (MODES as readonly string[]).includes(saved)) {
      return saved as ThemeMode;
    }
  } catch {
    // Sin almacenamiento: se usa el valor por defecto.
  }
  return 'system';
}

// `mql` se evalúa sólo en modo system: sin él no se consulta matchMedia.
export function effectiveTheme(
  mode: ThemeMode,
  mql?: Pick<MediaQueryList, 'matches'>,
): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  const query = mql ?? window.matchMedia('(prefers-color-scheme: dark)');
  return query.matches ? 'dark' : 'light';
}
