import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  mountThreeScene,
  readThemePalette,
  subscribeToThemeChange,
} from './createSceneHost';

const originalMatchMedia = window.matchMedia;
const originalGetComputedStyle = window.getComputedStyle;

function stubSystemDark(initial: boolean) {
  let dark = initial;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return dark;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, callback: () => void) => {
      listeners.add(callback);
    },
    removeEventListener: (_type: string, callback: () => void) => {
      listeners.delete(callback);
    },
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => mql,
  });
  return {
    setDark(value: boolean) {
      dark = value;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

beforeEach(() => {
  document.documentElement.className = '';
});

afterEach(() => {
  document.documentElement.className = '';
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  Object.defineProperty(window, 'getComputedStyle', {
    configurable: true,
    writable: true,
    value: originalGetComputedStyle,
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readThemePalette', () => {
  test('sigue el tema oscuro del sistema cuando no hay clase forzada', () => {
    stubSystemDark(true);

    const palette = readThemePalette();

    expect(palette.isDark).toBe(true);
    expect(palette.gold).toBe(0xe6be53);
    expect(palette.ok).toBe(0x7fd9a6);
  });

  test('el modo claro forzado gana al tema oscuro del sistema', () => {
    stubSystemDark(true);
    document.documentElement.classList.add('theme-light');

    const palette = readThemePalette();

    expect(palette.isDark).toBe(false);
    expect(palette.gold).toBe(0xc99a1e);
    expect(palette.ok).toBe(0x17734a);
  });

  test('el modo oscuro forzado gana al tema claro del sistema', () => {
    stubSystemDark(false);
    document.documentElement.classList.add('theme-dark');

    expect(readThemePalette()).toMatchObject({
      isDark: true,
      gold: 0xe6be53,
    });
  });

  test('lee --c-gold y --c-success de los tokens activos', () => {
    stubSystemDark(false);
    const values: Record<string, string> = {
      '--c-gold': '#123456',
      '--c-success': '#0a0b0c',
    };
    vi.stubGlobal(
      'getComputedStyle',
      () =>
        ({
          getPropertyValue: (name: string) => values[name] ?? '',
        }) as CSSStyleDeclaration,
    );

    const palette = readThemePalette();

    expect(palette.gold).toBe(0x123456);
    expect(palette.ok).toBe(0x0a0b0c);
  });
});

describe('subscribeToThemeChange', () => {
  test('escucha prefers-color-scheme y se da de baja al limpiar', () => {
    const system = stubSystemDark(false);
    const onChange = vi.fn();

    const unsubscribe = subscribeToThemeChange(onChange);
    expect(system.listenerCount()).toBe(1);

    system.setDark(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      isDark: true,
      gold: 0xe6be53,
    });

    unsubscribe();
    expect(system.listenerCount()).toBe(0);

    system.setDark(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('mountThreeScene sin WebGL', () => {
  test('devuelve un no-op limpio y no monta la escena', () => {
    const container = document.createElement('div');
    const setup = vi.fn();

    const cleanup = mountThreeScene(container, setup);

    expect(setup).not.toHaveBeenCalled();
    expect(container.childElementCount).toBe(0);
    expect(() => cleanup()).not.toThrow();
  });
});
