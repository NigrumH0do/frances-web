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

export function readThemePalette(): ScenePalette {
  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('theme-dark');
  return {
    accent: cssColorToHex('--c-accent', isDark ? 0x7ea3ff : 0x2346b8),
    accentSoft: cssColorToHex('--c-accent-soft', isDark ? 0x223052 : 0xe4ebff),
    gold: isDark ? 0xe6be53 : 0xc99a1e,
    ok: cssColorToHex('--c-ok', isDark ? 0x52c48c : 0x167a52),
    danger: cssColorToHex('--c-danger', isDark ? 0xf27966 : 0xb93822),
    paper: cssColorToHex('--c-card', isDark ? 0x1b202c : 0xfffcf6),
    ink: cssColorToHex('--c-text', isDark ? 0xecf0f8 : 0x191c24),
    isDark,
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

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
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

  const themeObserver =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          palette = readThemePalette();
          hooks.onThemeChange?.(palette);
        })
      : null;
  themeObserver?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  container.addEventListener('pointermove', onPointerMove, { passive: true });
  container.addEventListener('pointerleave', onPointerLeave, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  ensureLoop();

  return () => {
    stopLoop();
    ro?.disconnect();
    io?.disconnect();
    themeObserver?.disconnect();
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
