export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_KEY = 'fc-theme';

// CSP script-src 'self': dos meta theme-color con media en index.html, sin script inline.
export const THEME_COLOR = { light: '#2147a3', dark: '#10131a' } as const;

const MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

let schemeListenerBound = false;

function syncThemeColor(mode: ThemeMode, effective: 'light' | 'dark'): void {
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    if (mode !== 'system') {
      meta.setAttribute('content', THEME_COLOR[effective]);
      return;
    }
    const media = meta.getAttribute('media') ?? '';
    if (media.includes('dark')) {
      meta.setAttribute('content', THEME_COLOR.dark);
    } else if (media.includes('light')) {
      meta.setAttribute('content', THEME_COLOR.light);
    } else {
      meta.setAttribute('content', THEME_COLOR[effective]);
    }
  });
}

function bindSystemSchemeListener(): void {
  if (schemeListenerBound || typeof window.matchMedia !== 'function') return;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  schemeListenerBound = true;
  query.addEventListener('change', () => {
    const root = document.documentElement;
    if (
      root.classList.contains('theme-light') ||
      root.classList.contains('theme-dark')
    ) {
      return;
    }
    syncThemeColor('system', effectiveTheme('system', query));
  });
}

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
  const effective =
    mode === 'system' && typeof window.matchMedia !== 'function'
      ? 'light'
      : effectiveTheme(mode);
  syncThemeColor(mode, effective);
  if (mode === 'system') bindSystemSchemeListener();
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
