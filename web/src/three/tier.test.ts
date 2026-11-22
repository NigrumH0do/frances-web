import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { setMotion3dPref } from './motionPref';
import {
  __resetTierForTests,
  __setProbeResultForTests,
  getRuntimeTier,
  getSessionTier,
  initialDprCap,
  noteRuntimeLite,
  probeTier,
  stepWatchdog,
  unmasked,
  type Watchdog,
} from './tier';

type ContextCall = { type: string; attrs?: WebGLContextAttributes };

const originalUserAgent = navigator.userAgent;
const originalMatchMedia = window.matchMedia;

function setReducedMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: matches && query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  });
}

function setUserAgent(value: string): void {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value,
  });
}

function setDeviceMemory(value: number | undefined): void {
  Object.defineProperty(navigator, 'deviceMemory', {
    configurable: true,
    value,
  });
}

function mockGl(rendererName: string): {
  gl: WebGL2RenderingContext;
  loseContext: ReturnType<typeof vi.fn>;
} {
  const loseContext = vi.fn();
  const gl = {
    RENDERER: 0x1f01,
    getExtension(name: string) {
      if (name === 'WEBGL_debug_renderer_info') {
        return { UNMASKED_RENDERER_WEBGL: 0x9246 };
      }
      if (name === 'WEBGL_lose_context') return { loseContext };
      return null;
    },
    getParameter() {
      return rendererName;
    },
  };
  return { gl: gl as unknown as WebGL2RenderingContext, loseContext };
}

function spyContext(gl: WebGL2RenderingContext | null): ContextCall[] {
  const calls: ContextCall[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((
    type: string,
    attrs?: WebGLContextAttributes,
  ) => {
    calls.push({ type, attrs });
    return gl;
  }) as unknown as HTMLCanvasElement['getContext']);
  return calls;
}

function freshWatchdog(dprCap = 2): Watchdog {
  return {
    frames: 0,
    over: 0,
    badWindows: 0,
    dprCap,
    tier: 'full',
    skipNext: false,
  };
}

function runWindow(
  state: Watchdog,
  slowFrames: number,
  mobile: boolean,
): { state: Watchdog; resize: boolean; degraded: boolean } {
  let current = state;
  let last = { state, resize: false, degraded: false };
  for (let i = 0; i < 45; i += 1) {
    const frame = i < slowFrames ? 0.03 : 0.01;
    last = stepWatchdog(current, frame, mobile);
    current = last.state;
  }
  return last;
}

afterEach(() => {
  __resetTierForTests();
  setUserAgent(originalUserAgent);
  setDeviceMemory(undefined);
  setMotion3dPref('auto');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  vi.restoreAllMocks();
});

describe('probeTier', () => {
  test('en jsdom devuelve css sin llamar a getContext', () => {
    const calls = spyContext(mockGl('Apple GPU').gl);
    expect(probeTier()).toBe('css');
    expect(calls).toHaveLength(0);
  });

  test('motion3d off devuelve css', () => {
    setUserAgent('Mozilla/5.0');
    setReducedMotion(false);
    setMotion3dPref('off');
    const calls = spyContext(mockGl('Apple GPU').gl);
    expect(probeTier()).toBe('css');
    expect(calls).toHaveLength(0);
  });

  test('matchMedia(reduce) devuelve css', () => {
    setUserAgent('Mozilla/5.0');
    setMotion3dPref('auto');
    setReducedMotion(true);
    const calls = spyContext(mockGl('Apple GPU').gl);
    expect(probeTier()).toBe('css');
    expect(calls).toHaveLength(0);
  });

  test('getContext null devuelve css y no intenta webgl', () => {
    setUserAgent('Mozilla/5.0');
    const calls = spyContext(null);
    expect(probeTier()).toBe('css');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.type).toBe('webgl2');
    expect(calls.some((call) => call.type === 'webgl')).toBe(false);
  });

  test('un renderer llvmpipe devuelve css y pierde el contexto', () => {
    setUserAgent('Mozilla/5.0');
    const { gl, loseContext } = mockGl('ANGLE (llvmpipe, OpenGL 4.5)');
    spyContext(gl);
    expect(probeTier()).toBe('css');
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  test('Apple GPU sin deviceMemory es full y pierde el contexto de sonda', () => {
    setUserAgent('Mozilla/5.0');
    setDeviceMemory(undefined);
    const { gl, loseContext } = mockGl('Apple GPU');
    spyContext(gl);
    expect(probeTier()).toBe('full');
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  test('deviceMemory <= 2 es lite y 4 es full', () => {
    setUserAgent('Mozilla/5.0');
    setDeviceMemory(2);
    spyContext(mockGl('Apple GPU').gl);
    expect(probeTier()).toBe('lite');

    __resetTierForTests();
    setDeviceMemory(4);
    spyContext(mockGl('Apple GPU').gl);
    expect(probeTier()).toBe('full');
  });

  test('la sonda pide low-power y failIfMajorPerformanceCaveat', () => {
    setUserAgent('Mozilla/5.0');
    const calls = spyContext(mockGl('Apple GPU').gl);
    probeTier();
    expect(calls[0]?.attrs).toMatchObject({
      powerPreference: 'low-power',
      failIfMajorPerformanceCaveat: true,
    });
  });

  test('el fuente no importa three', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'tier.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"]three['"]/);
  });
});

describe('stepWatchdog', () => {
  test('en móvil baja 2 → 1.75 → 1.25 lite y luego degrada', () => {
    let state = freshWatchdog(2);
    let last = runWindow(state, 3, true);
    state = last.state;
    expect(last.resize).toBe(false);
    expect(state.dprCap).toBe(2);

    last = runWindow(state, 3, true);
    state = last.state;
    expect(last.resize).toBe(true);
    expect(state.dprCap).toBe(1.75);

    last = runWindow(state, 0, true);
    state = last.state;
    expect(last.resize).toBe(false);
    expect(state.dprCap).toBe(1.75);

    last = runWindow(state, 3, true);
    state = last.state;
    last = runWindow(state, 3, true);
    state = last.state;
    expect(last.resize).toBe(true);
    expect(state.dprCap).toBe(1.25);
    expect(state.tier).toBe('lite');

    last = runWindow(state, 3, true);
    state = last.state;
    last = runWindow(state, 3, true);
    expect(last.degraded).toBe(true);
    expect(last.resize).toBe(false);
  });

  test('una ventana mala seguida de una buena no baja el techo', () => {
    let state = freshWatchdog(2);
    state = runWindow(state, 3, true).state;
    expect(state.badWindows).toBe(1);
    const last = runWindow(state, 0, true);
    expect(last.state.badWindows).toBe(0);
    expect(last.state.dprCap).toBe(2);
    expect(last.resize).toBe(false);
  });

  test('en escritorio dos ventanas malas pasan de 2 a 1.25', () => {
    let state = freshWatchdog(2);
    state = runWindow(state, 3, false).state;
    const last = runWindow(state, 3, false);
    expect(last.resize).toBe(true);
    expect(last.state.dprCap).toBe(1.25);
    expect(last.degraded).toBe(false);
  });
});

describe('initialDprCap', () => {
  test('full estrecho con pocos núcleos arranca en 1.5; el resto en 2; lite en 1', () => {
    expect(initialDprCap('full', 390, 4)).toBe(1.5);
    expect(initialDprCap('full', 1280, 4)).toBe(2);
    expect(initialDprCap('lite', 390, 8)).toBe(1);
    expect(initialDprCap('full', 390, Number.NaN)).toBe(2);
  });
});

describe('unmasked', () => {
  test('null devuelve cadena vacía y la firma acepta los tres tipos', () => {
    expect(unmasked(null)).toBe('');
    const sample: WebGLRenderingContext | null = null;
    expect(unmasked(sample)).toBe('');
  });
});

describe('runtime', () => {
  test('la sesión cachea el sondeo y lite no vuelve a full', () => {
    __setProbeResultForTests('full');
    expect(getSessionTier()).toBe('full');
    noteRuntimeLite();
    expect(probeTier()).toBe('full');
    expect(getRuntimeTier()).toBe('lite');
  });
});
