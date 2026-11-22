import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  MOTION_3D_KEY,
  getMotion3dPref,
  hasWebGLSupport,
  prefersReducedMotion,
  resetWebGLSupportCacheForTests,
  setMotion3dPref,
  shouldRender3d,
} from './motionPref';

const origMatchMedia = window.matchMedia;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  resetWebGLSupportCacheForTests();
});

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: origMatchMedia,
  });
  vi.restoreAllMocks();
});

test('motion3d preferencia persiste auto/off y respeta prefers-reduced-motion', () => {
  expect(getMotion3dPref()).toBe('auto');
  expect(hasWebGLSupport()).toBe(false); // jsdom no expone WebGL
  expect(shouldRender3d()).toBe(false);
  expect(prefersReducedMotion()).toBe(false);

  setMotion3dPref('off');
  expect(localStorage.getItem(MOTION_3D_KEY)).toBe('off');
  expect(getMotion3dPref()).toBe('off');

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  });
  setMotion3dPref('auto');
  expect(prefersReducedMotion()).toBe(true);
  expect(shouldRender3d()).toBe(false);
});

test('setMotion3dPref sincroniza la clase motion-off en <html>', () => {
  expect(document.documentElement).not.toHaveClass('motion-off');

  setMotion3dPref('off');
  expect(document.documentElement).toHaveClass('motion-off');

  setMotion3dPref('auto');
  expect(document.documentElement).not.toHaveClass('motion-off');
});

test('al cargar el módulo con la preferencia off aplica motion-off', async () => {
  localStorage.setItem(MOTION_3D_KEY, 'off');
  vi.resetModules();

  await import('./motionPref');

  expect(document.documentElement).toHaveClass('motion-off');
});
