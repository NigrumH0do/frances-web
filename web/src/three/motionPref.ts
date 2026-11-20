import { useSyncExternalStore } from 'react';

export type Motion3dPref = 'auto' | 'off';

export const MOTION_3D_KEY = 'frances.motion3d';

const listeners = new Set<() => void>();
let webglSupportedCache: boolean | null = null;

export function getMotion3dPref(): Motion3dPref {
  if (typeof window === 'undefined') return 'auto';
  try {
    return window.localStorage.getItem(MOTION_3D_KEY) === 'off'
      ? 'off'
      : 'auto';
  } catch {
    return 'auto';
  }
}

export function setMotion3dPref(pref: Motion3dPref): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MOTION_3D_KEY, pref);
  } catch {
    // localStorage no disponible en modo privado estricto
  }
  for (const listener of listeners) {
    listener();
  }
}

export function prefersReducedMotion(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function hasWebGLSupport(): boolean {
  if (webglSupportedCache !== null) return webglSupportedCache;
  if (typeof document === 'undefined') {
    webglSupportedCache = false;
    return false;
  }
  if (
    typeof navigator !== 'undefined' &&
    /jsdom/i.test(navigator.userAgent ?? '')
  ) {
    webglSupportedCache = false;
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2', { powerPreference: 'low-power' }) ??
      canvas.getContext('webgl', { powerPreference: 'low-power' });
    webglSupportedCache = gl !== null;
  } catch {
    webglSupportedCache = false;
  }
  return webglSupportedCache;
}

export function shouldRender3d(): boolean {
  if (getMotion3dPref() === 'off') return false;
  if (prefersReducedMotion()) return false;
  return hasWebGLSupport();
}

export function resetWebGLSupportCacheForTests(): void {
  webglSupportedCache = null;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  const onStorage = (ev: StorageEvent) => {
    if (ev.key === MOTION_3D_KEY || ev.key === null) callback();
  };
  let mql: MediaQueryList | null = null;
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
    if (typeof window.matchMedia === 'function') {
      mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      mql.addEventListener('change', callback);
    }
  }
  return () => {
    listeners.delete(callback);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
      mql?.removeEventListener('change', callback);
    }
  };
}

export function useShouldRender3d(): boolean {
  return useSyncExternalStore(subscribe, shouldRender3d, () => false);
}
