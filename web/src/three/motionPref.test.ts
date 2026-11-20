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
