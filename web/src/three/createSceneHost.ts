import * as THREE from 'three';

export interface ScenePalette {
  accent: number;
  accentSoft: number;
  gold: number;
  ok: number;
  danger: number;
  paper: number;
  ink: number;
  isDark: boolean;
}

function cssColorToHex(varName: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  if (!raw) return fallback;
  try {
    return new THREE.Color(raw).getHex();
  } catch {
    return fallback;
  }
}

function systemPrefersDark(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

// Tema efectivo: la clase forzada en <html> gana; sin clase se sigue al
// sistema operativo, igual que hace tokens.css con sus @media.
function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  if (root.classList.contains('theme-dark')) return true;
  if (root.classList.contains('theme-light')) return false;
  return systemPrefersDark();
}

export function readThemePalette(): ScenePalette {
  const isDark = isDarkTheme();
  return {
    accent: cssColorToHex('--c-accent', isDark ? 0xaab3ff : 0x2b37b8),
    accentSoft: cssColorToHex('--c-accent-soft', isDark ? 0x232c52 : 0xe9ebfb),
    gold: cssColorToHex('--c-gold', isDark ? 0xe6be53 : 0xc99a1e),
    ok: cssColorToHex('--c-success', isDark ? 0x7fd9a6 : 0x17734a),
    danger: cssColorToHex('--c-danger', isDark ? 0xff8f8a : 0xc22636),
    paper: cssColorToHex('--c-card', isDark ? 0x1e2926 : 0xffffff),
    ink: cssColorToHex('--c-text', isDark ? 0xecf0ea : 0x1f1d2b),
    isDark,
  };
}

// Cambios de tema por clase (tema forzado desde Ajustes) o por el tema del
// sistema operativo. Devolver la baja evita observadores y listeners vivos.
export function subscribeToThemeChange(
  callback: (palette: ScenePalette) => void,
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }
  const notify = () => callback(readThemePalette());

  let observer: MutationObserver | null = null;
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(notify);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  let mql: MediaQueryList | null = null;
  if (typeof window.matchMedia === 'function') {
    mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', notify);
  }

  return () => {
    observer?.disconnect();
    mql?.removeEventListener('change', notify);
  };
}

export interface SceneHostContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  palette: ScenePalette;
}

export interface SceneUpdateArgs {
  elapsed: number;
  delta: number;
  pointerX: number;
  pointerY: number;
  palette: ScenePalette;
}

export interface SceneSetupResult {
  onFrame: (args: SceneUpdateArgs) => void;
  onThemeChange?: (palette: ScenePalette) => void;
  onResize?: (width: number, height: number) => void;
  dispose?: () => void;
}

export function mountThreeScene(
  container: HTMLElement,
  setup: (ctx: SceneHostContext) => SceneSetupResult,
): () => void {
  const width = Math.max(container.clientWidth, 120);
  const height = Math.max(container.clientHeight, 96);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
  } catch {
    // Sin contexto WebGL en runtime (driver perdido, GPU bloqueada): no
    // lanzamos el error a React; la escena cae al fallback editorial en CSS.
    return () => {};
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 40);
  camera.position.set(0, 0, 5.2);

  let palette = readThemePalette();
  const hooks = setup({ scene, camera, renderer, palette });

  let targetX = 0;
  let targetY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let inViewport = true;
  let tabVisible = document.visibilityState !== 'hidden';
  let rafId = 0;
  let lastTime = performance.now();
  let startTime = lastTime;

  const tick = (now: number) => {
    rafId = 0;
    if (!inViewport || !tabVisible) return;
    const delta = Math.min((now - lastTime) / 1000, 0.08);
    lastTime = now;
    pointerX += (targetX - pointerX) * Math.min(delta * 6, 1);
    pointerY += (targetY - pointerY) * Math.min(delta * 6, 1);

    hooks.onFrame({
      elapsed: (now - startTime) / 1000,
      delta,
      pointerX,
      pointerY,
      palette,
    });
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  };

  const ensureLoop = () => {
    if (rafId === 0 && inViewport && tabVisible) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  };

  const stopLoop = () => {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const onPointerMove = (ev: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    targetX = ((ev.clientX - rect.left) / rect.width - 0.5) * 2;
    targetY = -(((ev.clientY - rect.top) / rect.height - 0.5) * 2);
  };

  const onPointerLeave = () => {
    targetX = 0;
    targetY = 0;
  };

  const resize = () => {
    const w = Math.max(container.clientWidth, 80);
    const h = Math.max(container.clientHeight, 64);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    hooks.onResize?.(w, h);
  };

  const ro =
    typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  ro?.observe(container);

  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          const hit = entries[0]?.isIntersecting ?? true;
          inViewport = hit;
          if (hit) ensureLoop();
          else stopLoop();
        })
      : null;
  io?.observe(container);

  const onVisibility = () => {
    tabVisible = document.visibilityState !== 'hidden';
    if (tabVisible) {
      startTime = performance.now() - (lastTime - startTime);
      ensureLoop();
    } else {
      stopLoop();
    }
  };

  const unsubscribeTheme = subscribeToThemeChange((next) => {
    palette = next;
    hooks.onThemeChange?.(next);
  });

  container.addEventListener('pointermove', onPointerMove, { passive: true });
  container.addEventListener('pointerleave', onPointerLeave, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  ensureLoop();

  return () => {
    stopLoop();
    ro?.disconnect();
    io?.disconnect();
    unsubscribeTheme();
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerleave', onPointerLeave);
    document.removeEventListener('visibilitychange', onVisibility);
    hooks.dispose?.();
    scene.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh ||
        obj instanceof THREE.LineSegments ||
        obj instanceof THREE.Points
      ) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];
        for (const mat of mats) mat?.dispose();
      }
    });
    renderer.dispose();
    if (renderer.domElement.parentNode === container) {
      container.removeChild(renderer.domElement);
    }
  };
}
