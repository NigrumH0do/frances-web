import { getMotion3dPref, prefersReducedMotion } from './motionPref';

export type Tier = 'full' | 'lite' | 'css';

export interface Watchdog {
  frames: number;
  over: number;
  badWindows: number;
  dprCap: number;
  tier: 'full' | 'lite';
  skipNext: boolean;
}

const SOFTWARE_RENDERER =
  /swiftshader|llvmpipe|softpipe|microsoft basic render|virtualbox|vmware/i;

let cached: Tier | null = null;
let runtime: Tier | null = null;
let override: Tier | null = null;

function isTier(value: unknown): value is Tier {
  return value === 'full' || value === 'lite' || value === 'css';
}

export function unmasked(
  gl: WebGL2RenderingContext | WebGLRenderingContext | null,
): string {
  if (gl === null) return '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const value = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      if (typeof value === 'string' && value.length > 0) return value;
    }
    const fallback = gl.getParameter(gl.RENDERER);
    return typeof fallback === 'string' ? fallback : '';
  } catch {
    return '';
  }
}

function deviceMemory(): number | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const memory = (navigator as Navigator & { deviceMemory?: unknown })
    .deviceMemory;
  return typeof memory === 'number' ? memory : undefined;
}

function detectTier(): Tier {
  // El inyector de tests gana incluso en jsdom, para poder montar escenas.
  if (override !== null) return override;
  if (getMotion3dPref() === 'off' || prefersReducedMotion()) return 'css';
  if (typeof document === 'undefined') return 'css';
  if (
    typeof navigator !== 'undefined' &&
    /jsdom/i.test(navigator.userAgent ?? '')
  ) {
    return 'css';
  }
  // Muerto en el build de producción: Vite sustituye la comparación.
  // motion-off y reduced-motion ya ganaron arriba.
  if (import.meta.env.VITE_E2E === '1' && typeof window !== 'undefined') {
    const forced = (window as { __francesTier?: unknown }).__francesTier;
    if (isTier(forced)) return forced;
  }
  let gl: WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl2', {
      powerPreference: 'low-power',
      failIfMajorPerformanceCaveat: true,
    });
  } catch {
    return 'css';
  }
  if (gl === null) return 'css';
  const name = unmasked(gl);
  try {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // La sonda no puede dejar el contexto de prueba vivo.
  }
  if (SOFTWARE_RENDERER.test(name)) return 'css';
  const memory = deviceMemory();
  if (memory !== undefined && memory <= 2) return 'lite';
  return 'full';
}

export function probeTier(): Tier {
  if (cached !== null) return cached;
  cached = detectTier();
  if (runtime === null || cached === 'css') runtime = cached;
  else if (runtime === 'full' && cached === 'lite') runtime = 'lite';
  return cached;
}

export function getSessionTier(): Tier {
  return probeTier();
}

export function noteRuntimeLite(): void {
  if (getSessionTier() === 'css') {
    runtime = 'css';
    return;
  }
  runtime = 'lite';
}

/** El watchdog o una pérdida repetida fijan css para el resto de la visita. */
export function noteSessionCss(): void {
  cached = 'css';
  runtime = 'css';
}

export function getRuntimeTier(): Tier {
  if (runtime === null) return probeTier();
  return runtime;
}

export function initialDprCap(
  tier: Tier,
  width: number,
  cores: number,
): number {
  if (tier !== 'full') return 1;
  const resolved = Number.isFinite(cores) ? cores : 8;
  if (width < 768 && resolved <= 4) return 1.5;
  return 2;
}

export function stepWatchdog(
  state: Watchdog,
  frameSec: number,
  mobile: boolean,
): { state: Watchdog; resize: boolean; degraded: boolean } {
  if (state.skipNext) {
    return {
      state: { ...state, skipNext: false },
      resize: false,
      degraded: false,
    };
  }
  const frames = state.frames + 1;
  const over = state.over + (frameSec > 0.02 ? 1 : 0);
  if (frames < 45) {
    return {
      state: { ...state, frames, over },
      resize: false,
      degraded: false,
    };
  }
  const bad = over / 45 > 0.05;
  if (!bad) {
    return {
      state: { ...state, frames: 0, over: 0, badWindows: 0 },
      resize: false,
      degraded: false,
    };
  }
  const badWindows = state.badWindows + 1;
  if (badWindows < 2) {
    return {
      state: { ...state, frames: 0, over: 0, badWindows },
      resize: false,
      degraded: false,
    };
  }
  let dprCap = state.dprCap;
  let tier = state.tier;
  let degraded = false;
  if (dprCap > 1.75 && mobile) {
    dprCap = 1.75;
  } else if (dprCap > 1.25) {
    dprCap = 1.25;
    tier = 'lite';
  } else {
    degraded = true;
  }
  const resize = !degraded && dprCap !== state.dprCap;
  return {
    state: {
      frames: 0,
      over: 0,
      badWindows: 0,
      dprCap: degraded ? state.dprCap : dprCap,
      tier,
      skipNext: false,
    },
    resize,
    degraded,
  };
}

export function __resetTierForTests(): void {
  cached = null;
  runtime = null;
  override = null;
}

export function __setProbeResultForTests(tier: Tier | null): void {
  override = tier;
  cached = null;
  runtime = null;
}
