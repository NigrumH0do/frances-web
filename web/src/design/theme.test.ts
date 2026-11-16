import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { THEME_KEY, applyTheme, effectiveTheme, initialTheme } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});
afterEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

describe('theme', () => {
  test('applyTheme pone la clase y recuerda; system la quita', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('theme-dark')).toBe(
      true,
    );
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    applyTheme('system');
    expect(document.documentElement.className).not.toMatch(/theme-/);
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  test('applyTheme cambia de light a dark sin dejar la clase anterior', () => {
    applyTheme('light');
    applyTheme('dark');
    expect(document.documentElement.classList.contains('theme-light')).toBe(
      false,
    );
    expect(document.documentElement.classList.contains('theme-dark')).toBe(
      true,
    );
  });

  test('applyTheme no falla si localStorage lanza', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('cuota');
    };
    try {
      expect(() => applyTheme('light')).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  test('initialTheme lee lo guardado y por defecto es system', () => {
    expect(initialTheme()).toBe('system');
    localStorage.setItem(THEME_KEY, 'light');
    expect(initialTheme()).toBe('light');
    localStorage.setItem(THEME_KEY, 'basura');
    expect(initialTheme()).toBe('system');
  });

  test('effectiveTheme sigue al sistema solo en modo system', () => {
    const dark = { matches: true } as Pick<MediaQueryList, 'matches'>;
    const light = { matches: false } as Pick<MediaQueryList, 'matches'>;
    expect(effectiveTheme('system', dark)).toBe('dark');
    expect(effectiveTheme('system', light)).toBe('light');
    expect(effectiveTheme('light', dark)).toBe('light');
    expect(effectiveTheme('dark', light)).toBe('dark');
  });
});
