import { Color, type WebGLRenderer } from 'three';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { __resetSceneGateForTests, getSceneAvailability } from './sceneGate';
import { __resetTierForTests, __setProbeResultForTests } from './tier';
import {
  __glCreateCountForTests,
  __resetSceneHostForTests,
  __setHostClockForTests,
  __setRendererFactoryForTests,
  dampMix,
  disposeSceneGraph,
  mountSceneHost,
  mountThreeScene,
  readPaletteTarget,
  readThemePalette,
  subscribeToThemeChange,
  type Palette,
} from './createSceneHost';
import { BufferGeometry, Mesh, MeshBasicMaterial, Scene, Texture } from 'three';

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

interface FakeRenderer {
  renderer: WebGLRenderer;
  render: ReturnType<typeof vi.fn>;
  forceContextLoss: ReturnType<typeof vi.fn>;
  canvas: HTMLCanvasElement;
}

function fakeRenderer(): FakeRenderer {
  const canvas = document.createElement('canvas');
  const render = vi.fn();
  const forceContextLoss = vi.fn();
  const renderer = {
    domElement: canvas,
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    render,
    dispose: vi.fn(),
    forceContextLoss,
    renderLists: { dispose: vi.fn() },
    setClearColor: vi.fn(),
    outputColorSpace: '',
    toneMapping: 0,
    toneMappingExposure: 1,
  } as unknown as WebGLRenderer;
  return { renderer, render, forceContextLoss, canvas };
}

function idleHooks(): {
  onFrame: () => void;
  needsFrame: () => boolean;
} {
  return { onFrame: () => {}, needsFrame: () => false };
}

function manualClock() {
  let now = 0;
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  return {
    now: () => now,
    schedule(fn: () => void, ms: number) {
      const timer = { at: now + ms, fn, cancelled: false };
      timers.push(timer);
      return {
        cancel() {
          timer.cancelled = true;
        },
      };
    },
    advance(ms: number) {
      now += ms;
      for (const timer of timers) {
        if (!timer.cancelled && timer.at <= now) {
          timer.cancelled = true;
          timer.fn();
        }
      }
    },
  };
}

function rafQueue() {
  let nextId = 1;
  const queue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    queue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue.delete(id);
  });
  return {
    flush(time: number) {
      const batch = [...queue.values()];
      queue.clear();
      for (const cb of batch) cb(time);
    },
    get pending() {
      return queue.size;
    },
  };
}

function mountPaletteSession(systemDark: boolean) {
  const system = stubSystemDark(systemDark);
  const frames = rafQueue();
  __setRendererFactoryForTests(() => fakeRenderer().renderer);
  const container = document.createElement('div');
  let palette: Palette | null = null;
  const cleanup = mountSceneHost(container, 'full', (_scene, _camera, live) => {
    palette = live;
    return idleHooks();
  });
  return {
    system,
    frames,
    cleanup,
    getPalette: () => palette,
  };
}

async function drainThemeFrame(
  frames: ReturnType<typeof rafQueue>,
): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  frames.flush(16);
}

beforeEach(() => {
  document.documentElement.className = '';
  delete document.documentElement.dataset.palette;
  localStorage.removeItem('frances.motion3d');
  __resetTierForTests();
  __resetSceneGateForTests();
  __resetSceneHostForTests();
});

afterEach(() => {
  document.documentElement.className = '';
  delete document.documentElement.dataset.palette;
  __resetSceneHostForTests();
  __resetSceneGateForTests();
  __resetTierForTests();
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
    expect(palette.gold).toBe(0xd9b65e);
    expect(palette.ok).toBe(0x86d2c1);
  });

  test('el modo claro forzado gana al tema oscuro del sistema', () => {
    stubSystemDark(true);
    document.documentElement.classList.add('theme-light');

    const palette = readThemePalette();

    expect(palette.isDark).toBe(false);
    expect(palette.gold).toBe(0xd3ac41);
    expect(palette.ok).toBe(0x006150);
  });

  test('el modo oscuro forzado gana al tema claro del sistema', () => {
    stubSystemDark(false);
    document.documentElement.classList.add('theme-dark');

    expect(readThemePalette()).toMatchObject({
      isDark: true,
      gold: 0xd9b65e,
    });
  });

  test('lee --c-gold-3d y no el oro de texto', () => {
    stubSystemDark(false);
    const values: Record<string, string> = {
      '--c-gold-3d': '#123456',
      '--c-gold': '#abcdef',
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

describe('readPaletteTarget', () => {
  test('en sistema oscuro copia el acento y el metal de fallback', () => {
    stubSystemDark(true);
    const target = readPaletteTarget();
    expect(target.isDark).toBe(true);
    expect(target.colors.accent.getHex()).toBe(0x98b9fa);
    expect(target.colors.gold3d.getHex()).toBe(0xd9b65e);
  });
});

describe('dampMix', () => {
  test('sigue la exponencial y cierra en 1 por encima de 0.999', () => {
    expect(dampMix(0, 0.03, 10)).toBeCloseTo(1 - Math.exp(-0.3), 9);
    expect(dampMix(0.999, 1, 10)).toBe(1);
  });

  test('el snap copia el color destino y un lerp a 0.999 no', () => {
    const from = new Color(0xff0000);
    const to = new Color(0x00ff00);
    const mix = dampMix(0.999, 1, 10);
    const snapped = new Color().copy(from);
    if (mix === 1) snapped.copy(to);
    expect(snapped.r).toBe(to.r);
    expect(snapped.g).toBe(to.g);
    expect(snapped.b).toBe(to.b);
    const lerped = new Color().copy(from).lerp(to, 0.999);
    expect(lerped.r).not.toBe(to.r);
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
      gold: 0xd9b65e,
    });

    unsubscribe();
    expect(system.listenerCount()).toBe(0);

    system.setDark(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('mutar data-palette de light a dark notifica', async () => {
    document.documentElement.dataset.palette = 'light';
    const onChange = vi.fn();
    const unsubscribe = subscribeToThemeChange(onChange);

    document.documentElement.dataset.palette = 'dark';
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ isDark: true });

    unsubscribe();
  });
});

describe('disposeSceneGraph', () => {
  test('dispone una geometría compartida y una textura repetida una sola vez', () => {
    const geometry = new BufferGeometry();
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const scene = new Scene();
    scene.add(
      new Mesh(geometry, new MeshBasicMaterial()),
      new Mesh(geometry, new MeshBasicMaterial()),
    );

    const texture = new Texture();
    const textureDispose = vi.spyOn(texture, 'dispose');
    const material = new MeshBasicMaterial({ map: texture });
    (
      material as MeshBasicMaterial & {
        uniforms: { uMap: { value: Texture } };
      }
    ).uniforms = { uMap: { value: texture } };
    const materialDispose = vi.spyOn(material, 'dispose');
    scene.add(new Mesh(new BufferGeometry(), material));

    disposeSceneGraph(scene);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose.mock.invocationCallOrder[0]).toBeLessThan(
      textureDispose.mock.invocationCallOrder[0] ?? 0,
    );
    expect(textureDispose.mock.invocationCallOrder[0]).toBeLessThan(
      geometryDispose.mock.invocationCallOrder[0] ?? 0,
    );
  });
});

describe('mountSceneHost', () => {
  test('reutiliza el renderer hasta que el reloj cumple 30 s', () => {
    const clock = manualClock();
    const first = fakeRenderer();
    let creates = 0;
    __setHostClockForTests(clock);
    __setRendererFactoryForTests(() => {
      creates += 1;
      return creates === 1 ? first.renderer : fakeRenderer().renderer;
    });

    const container = document.createElement('div');
    const stop = mountSceneHost(container, 'full', idleHooks);
    stop();
    const again = mountSceneHost(container, 'full', idleHooks);
    expect(creates).toBe(1);
    expect(first.forceContextLoss).not.toHaveBeenCalled();
    again();
    clock.advance(30_000);
    expect(first.forceContextLoss).toHaveBeenCalledTimes(1);
    mountSceneHost(container, 'full', idleHooks);
    expect(creates).toBe(2);
    expect(__glCreateCountForTests()).toBe(2);
  });

  test('un factory que lanza no propaga, vacía el contenedor y marca css', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    __setRendererFactoryForTests(() => {
      throw new Error('sin contexto');
    });
    const container = document.createElement('div');

    let cleanup: (() => void) | undefined;
    expect(() => {
      cleanup = mountSceneHost(container, 'full', idleHooks);
    }).not.toThrow();

    expect(container.childElementCount).toBe(0);
    expect(getSceneAvailability()).toBe('css');
    expect(error).not.toHaveBeenCalled();
    expect(() => cleanup?.()).not.toThrow();
  });

  test('el segundo montaje concurrente es un no-op y marca busy', () => {
    let creates = 0;
    __setRendererFactoryForTests(() => {
      creates += 1;
      return fakeRenderer().renderer;
    });
    const first = document.createElement('div');
    const second = document.createElement('div');
    const stopFirst = mountSceneHost(first, 'full', idleHooks);
    const stopSecond = mountSceneHost(second, 'full', idleHooks);

    expect(creates).toBe(1);
    expect(__glCreateCountForTests()).toBe(1);
    expect(second.dataset.webgl).toBe('busy');
    const canvas = first.querySelector('canvas');
    expect(canvas).not.toBeNull();
    stopSecond();
    expect(first.querySelector('canvas')).toBe(canvas);
    stopFirst();
    expect(first.querySelector('canvas')).toBeNull();
  });

  test('el puntero táctil no despierta y el ratón dentro del rect sí', () => {
    vi.stubEnv('VITE_E2E', '1');
    const frames = rafQueue();
    const fake = fakeRenderer();
    __setRendererFactoryForTests(() => fake.renderer);
    const host = window as Window & { __francesHostFrames?: number };
    host.__francesHostFrames = 0;

    const container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        toJSON() {
          return {};
        },
      }) as DOMRect;

    const seen: number[] = [];
    const cleanup = mountSceneHost(container, 'full', () => ({
      needsFrame: () => false,
      onFrame: (_dt, _elapsed, pointerX) => {
        seen.push(pointerX);
      },
    }));

    frames.flush(16);
    const afterMount = fake.render.mock.calls.length;
    const framesAfterMount = host.__francesHostFrames ?? 0;

    window.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerType: 'touch',
        clientX: 160,
        clientY: 40,
      }),
    );
    frames.flush(32);
    expect(fake.render.mock.calls.length).toBe(afterMount);
    expect(host.__francesHostFrames).toBe(framesAfterMount);
    expect(seen).toEqual([]);

    window.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerType: 'mouse',
        clientX: 160,
        clientY: 40,
      }),
    );
    frames.flush(48);
    expect(fake.render.mock.calls.length).toBe(afterMount + 1);
    expect(host.__francesHostFrames).toBe(framesAfterMount + 1);
    expect(seen.at(-1)).toBeCloseTo(0.6, 5);
    cleanup();
  });

  test('al cerrar la mezcla el acento copia el destino bit a bit', async () => {
    const system = stubSystemDark(false);
    let accent = '';
    vi.stubGlobal(
      'getComputedStyle',
      () =>
        ({
          getPropertyValue: (name: string) =>
            name === '--c-accent' ? accent : '',
        }) as CSSStyleDeclaration,
    );
    const frames = rafQueue();
    __setRendererFactoryForTests(() => fakeRenderer().renderer);
    __setProbeResultForTests('full');

    const container = document.createElement('div');
    let palette: Palette | null = null;
    const cleanup = mountSceneHost(
      container,
      'full',
      (_scene, _camera, live) => {
        palette = live;
        return { onFrame: () => {}, needsFrame: () => false };
      },
    );

    frames.flush(16);
    await Promise.resolve();
    accent = '#ff0000';
    system.setDark(true);
    let stamp = 16;
    for (let i = 0; i < 80 && frames.pending > 0; i += 1) {
      stamp += 16;
      frames.flush(stamp);
      await Promise.resolve();
    }

    const target = new Color('#ff0000');
    expect(palette).not.toBeNull();
    const live = palette as Palette | null;
    expect(live?.accent.r).toBe(target.r);
    expect(live?.accent.g).toBe(target.g);
    expect(live?.accent.b).toBe(target.b);
    cleanup();
  });

  test('theme-light sustituye el data-palette oscuro publicado en modo sistema', async () => {
    const { frames, cleanup, getPalette } = mountPaletteSession(true);

    expect(document.documentElement.dataset.palette).toBe('dark');
    expect(getPalette()?.isDark).toBe(true);

    document.documentElement.classList.add('theme-light');
    await drainThemeFrame(frames);

    expect(document.documentElement.dataset.palette).toBe('light');
    expect(getPalette()?.isDark).toBe(false);
    cleanup();
  });

  test('quitar theme-light devuelve el data-palette al sistema oscuro', async () => {
    const { frames, cleanup, getPalette } = mountPaletteSession(true);

    document.documentElement.classList.add('theme-light');
    await drainThemeFrame(frames);
    expect(document.documentElement.dataset.palette).toBe('light');
    expect(getPalette()?.isDark).toBe(false);

    document.documentElement.classList.remove('theme-light');
    await drainThemeFrame(frames);

    expect(document.documentElement.dataset.palette).toBe('dark');
    expect(getPalette()?.isDark).toBe(true);
    cleanup();
  });

  test('cambiar prefers-color-scheme actualiza data-palette sin quedarse en la escritura propia', async () => {
    const { system, frames, cleanup, getPalette } = mountPaletteSession(true);

    expect(document.documentElement.dataset.palette).toBe('dark');
    expect(getPalette()?.isDark).toBe(true);

    system.setDark(false);
    await drainThemeFrame(frames);

    expect(document.documentElement.dataset.palette).toBe('light');
    expect(getPalette()?.isDark).toBe(false);
    cleanup();
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
