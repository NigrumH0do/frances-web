import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  THEME_COLOR,
  THEME_KEY,
  applyTheme,
  effectiveTheme,
  initialTheme,
} from './theme';

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});
afterEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((node) => node.remove());
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
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

  test('THEME_COLOR es el par del chrome claro y oscuro', () => {
    expect(THEME_COLOR.light).toBe('#2147a3');
    expect(THEME_COLOR.dark).toBe('#10131a');
  });

  test('applyTheme pinta meta theme-color en light y dark', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#2b37b8');
    document.head.appendChild(meta);

    applyTheme('dark');
    expect(meta.getAttribute('content')).toBe('#10131a');

    applyTheme('light');
    expect(meta.getAttribute('content')).toBe('#2147a3');
  });

  test('applyTheme system sigue al esquema con un solo listener', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);

    let matches = true;
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    const addEventListener = vi.fn(
      (type: string, listener: (event: MediaQueryListEvent) => void) => {
        expect(type).toBe('change');
        listeners.push(listener);
      },
    );
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => {
        expect(query).toBe('(prefers-color-scheme: dark)');
        return {
          get matches() {
            return matches;
          },
          media: query,
          addEventListener,
          removeEventListener: vi.fn(),
        };
      },
    });

    applyTheme('system');
    expect(meta.getAttribute('content')).toBe('#10131a');
    applyTheme('system');
    expect(addEventListener).toHaveBeenCalledTimes(1);

    matches = false;
    for (const listener of listeners) {
      listener({ matches: false } as MediaQueryListEvent);
    }
    expect(meta.getAttribute('content')).toBe('#2147a3');

    applyTheme('dark');
    expect(meta.getAttribute('content')).toBe('#10131a');
    for (const listener of listeners) {
      listener({ matches: false } as MediaQueryListEvent);
    }
    expect(meta.getAttribute('content')).toBe('#10131a');
  });

  test('forzado pinta todos los meta y system restaura el par con media', () => {
    const light = document.createElement('meta');
    light.setAttribute('name', 'theme-color');
    light.setAttribute('content', '#2147a3');
    light.setAttribute('media', '(prefers-color-scheme: light)');
    const dark = document.createElement('meta');
    dark.setAttribute('name', 'theme-color');
    dark.setAttribute('content', '#10131a');
    dark.setAttribute('media', '(prefers-color-scheme: dark)');
    document.head.append(light, dark);

    applyTheme('dark');
    expect(light.getAttribute('content')).toBe('#10131a');
    expect(dark.getAttribute('content')).toBe('#10131a');
    expect(light.hasAttribute('media')).toBe(true);

    applyTheme('light');
    expect(light.getAttribute('content')).toBe('#2147a3');
    expect(dark.getAttribute('content')).toBe('#2147a3');

    applyTheme('system');
    expect(light.getAttribute('content')).toBe('#2147a3');
    expect(dark.getAttribute('content')).toBe('#10131a');
    expect(light.getAttribute('media')).toContain('light');
    expect(dark.getAttribute('media')).toContain('dark');
  });

  test('index.html declara theme-color CSP-safe sin el azul viejo', () => {
    const html = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../index.html'),
      'utf8',
    );
    expect(html).not.toContain('#2b37b8');
    expect(html).toContain('#2147a3');
    expect(html).toContain('#10131a');
    const metas = [
      ...html.matchAll(/<meta\b[^>]*name="theme-color"[^>]*>/gi),
    ].map((match) => match[0]);
    expect(metas).toHaveLength(2);
    expect(
      metas.some(
        (tag) =>
          tag.includes('#2147a3') &&
          tag.includes('prefers-color-scheme: light'),
      ),
    ).toBe(true);
    expect(
      metas.some(
        (tag) =>
          tag.includes('#10131a') && tag.includes('prefers-color-scheme: dark'),
      ),
    ).toBe(true);
    expect(html).not.toMatch(/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i);
  });
});
