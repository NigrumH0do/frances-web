import {
  Color,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { getMotion3dPref, prefersReducedMotion } from './motionPref';
import { setSceneAvailability } from './sceneGate';
import {
  initialDprCap,
  noteRuntimeLite,
  noteSessionCss,
  stepWatchdog,
  getSessionTier,
  type Tier,
  type Watchdog,
} from './tier';

const CHANNELS = [
  'accent',
  'accentSoft',
  'paper',
  'ink',
  'ok',
  'danger',
  'gold3d',
  'scoreExcelente',
  'scoreBien',
  'scoreMejorable',
  'scoreRepetir',
] as const;

type Channel = (typeof CHANNELS)[number];

const CHANNEL_CSS: Record<Channel, string> = {
  accent: '--c-accent',
  accentSoft: '--c-accent-soft',
  paper: '--c-card',
  ink: '--c-text',
  ok: '--c-success',
  danger: '--c-danger',
  gold3d: '--c-gold-3d',
  scoreExcelente: '--c-score-excelente',
  scoreBien: '--c-score-bien',
  scoreMejorable: '--c-score-mejorable',
  scoreRepetir: '--c-score-repetir',
};

const FALLBACK: Record<Channel, { light: number; dark: number }> = {
  accent: { light: 0x2147a3, dark: 0x98b9fa },
  accentSoft: { light: 0xe6eeff, dark: 0x212d46 },
  paper: { light: 0xfefcf8, dark: 0x1e242c },
  ink: { light: 0x232430, dark: 0xe8e6df },
  ok: { light: 0x006150, dark: 0x86d2c1 },
  danger: { light: 0xa4283a, dark: 0xf18790 },
  gold3d: { light: 0xd3ac41, dark: 0xd9b65e },
  scoreExcelente: { light: 0x006150, dark: 0x86d2c1 },
  scoreBien: { light: 0x2147a3, dark: 0x98b9fa },
  scoreMejorable: { light: 0x7c4607, dark: 0xefaf6f },
  scoreRepetir: { light: 0xa4283a, dark: 0xf18790 },
};

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

export interface Palette {
  revision: number;
  isDark: boolean;
  accent: Color;
  accentSoft: Color;
  paper: Color;
  ink: Color;
  ok: Color;
  danger: Color;
  gold3d: Color;
  scoreExcelente: Color;
  scoreBien: Color;
  scoreMejorable: Color;
  scoreRepetir: Color;
}

export interface PaletteTarget {
  isDark: boolean;
  colors: Record<keyof Omit<Palette, 'revision' | 'isDark'>, Color>;
}

export interface SceneHostContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
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

export interface HostHooks {
  onFrame: (
    dt: number,
    elapsed: number,
    pointerX: number,
    pointerY: number,
  ) => void;
  needsFrame: () => boolean;
  onTheme?: (palette: Palette) => void;
  onResize?: (width: number, height: number) => void;
  onTier?: (tier: 'lite') => void;
  dispose?: () => void;
}

export interface MountOptions {
  fov?: number;
  cameraZ?: number;
  orientation?: 'rest' | 'hold';
  maxFps?: number;
}

interface HostClock {
  now: () => number;
  schedule: (fn: () => void, ms: number) => { cancel: () => void };
}

type ChannelColors = Record<Channel, Color>;

interface Session {
  container: HTMLElement;
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  hooks: HostHooks;
  palette: Palette;
  from: ChannelColors;
  to: ChannelColors;
  mix: number;
  targetX: number;
  targetY: number;
  pointerInside: boolean;
  orientation: 'rest' | 'hold';
  maxFps?: number;
  fpsAccum: number;
  raf: number;
  themeRaf: number;
  lastNow: number | null;
  elapsed: number;
  watchdog: Watchdog;
  forceFrame: boolean;
  alive: boolean;
  writingPalette: boolean;
  cleanups: Array<() => void>;
  rawTiltX: number;
  rawTiltY: number;
  tiltX: number;
  tiltY: number;
  gyroOn: boolean;
  gyroOff: (() => void) | null;
}

let shared: WebGLRenderer | null = null;
let active: Session | null = null;
let rendererFactory: (() => WebGLRenderer) | null = null;
let hostClock: HostClock | null = null;
let glCreateCount = 0;
let idleTimer: { cancel: () => void } | null = null;
let busyWarned = false;
let retired = false;
let restoredAt: number | null = null;
let publishedPalette: 'dark' | 'light' | null = null;

function cssColorToHex(varName: string, fallback: number): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return fallback;
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  if (!raw) return fallback;
  try {
    return new Color(raw).getHex();
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

function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  if (root.classList.contains('theme-dark')) return true;
  if (root.classList.contains('theme-light')) return false;
  const palette = root.dataset.palette;
  if (
    (palette === 'dark' || palette === 'light') &&
    palette !== publishedPalette
  ) {
    return palette === 'dark';
  }
  return systemPrefersDark();
}

function channelHex(key: Channel, isDark: boolean): number {
  const fallback = isDark ? FALLBACK[key].dark : FALLBACK[key].light;
  return cssColorToHex(CHANNEL_CSS[key], fallback);
}

export function readThemePalette(): ScenePalette {
  const isDark = isDarkTheme();
  return {
    accent: channelHex('accent', isDark),
    accentSoft: channelHex('accentSoft', isDark),
    gold: channelHex('gold3d', isDark),
    ok: channelHex('ok', isDark),
    danger: channelHex('danger', isDark),
    paper: channelHex('paper', isDark),
    ink: channelHex('ink', isDark),
    isDark,
  };
}

export function readPaletteTarget(): PaletteTarget {
  const isDark = isDarkTheme();
  const colors = {} as PaletteTarget['colors'];
  for (const key of CHANNELS) {
    colors[key] = new Color(channelHex(key, isDark));
  }
  return { isDark, colors };
}

export function dampMix(mix: number, dt: number, lambda = 10): number {
  const next = 1 - (1 - mix) * Math.exp(-lambda * dt);
  return next > 0.999 ? 1 : next;
}

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
      attributeFilter: ['class', 'data-palette'],
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

function isTexture(value: unknown): value is Texture {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isTexture?: boolean }).isTexture === true
  );
}

function collectTextures(material: Material, into: Set<Texture>): void {
  for (const value of Object.values(material)) {
    if (isTexture(value)) into.add(value);
  }
  const uniforms = (
    material as { uniforms?: Record<string, { value?: unknown }> }
  ).uniforms;
  if (!uniforms) return;
  for (const uniform of Object.values(uniforms)) {
    if (uniform && isTexture(uniform.value)) into.add(uniform.value);
  }
}

export function disposeSceneGraph(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((obj) => {
    const node = obj as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    if (node.geometry?.isBufferGeometry) geometries.add(node.geometry);
    if (!node.material) return;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of list) {
      if (mat) materials.add(mat);
    }
  });
  for (const mat of materials) collectTextures(mat, textures);
  for (const mat of materials) mat.dispose();
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function blankChannels(): ChannelColors {
  const colors = {} as ChannelColors;
  for (const key of CHANNELS) colors[key] = new Color();
  return colors;
}

function createPalette(): Palette {
  return {
    revision: 0,
    isDark: false,
    ...blankChannels(),
  };
}

function sameColor(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

function clockNow(): number {
  if (hostClock) return hostClock.now();
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function scheduleLater(fn: () => void, ms: number): { cancel: () => void } {
  if (hostClock) return hostClock.schedule(fn, ms);
  const id = setTimeout(fn, ms);
  return { cancel: () => clearTimeout(id) };
}

function cancelIdle(): void {
  idleTimer?.cancel();
  idleTimer = null;
}

function noteGlCreate(): void {
  glCreateCount += 1;
  if (import.meta.env.VITE_E2E === '1' && typeof window !== 'undefined') {
    const host = window as Window & { __francesGlCreates?: number };
    host.__francesGlCreates = (host.__francesGlCreates ?? 0) + 1;
  }
}

function noteHostFrame(): void {
  if (import.meta.env.VITE_E2E !== '1' || typeof window === 'undefined') return;
  const host = window as Window & { __francesHostFrames?: number };
  host.__francesHostFrames = (host.__francesHostFrames ?? 0) + 1;
}

function warnBusy(): void {
  if (!import.meta.env.DEV || busyWarned) return;
  busyWarned = true;
  console.warn('SceneHost: ya hay un renderer WebGL en uso.');
}

function createDefaultRenderer(): WebGLRenderer {
  const renderer = new WebGLRenderer({
    alpha: true,
    antialias: false,
    powerPreference: 'low-power',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

function onContextLost(ev: Event): void {
  ev.preventDefault();
  const now = clockNow();
  if (restoredAt !== null && now - restoredAt < 2000) {
    retired = true;
    noteSessionCss();
    setSceneAvailability('css');
    destroySharedRenderer();
    return;
  }
  setSceneAvailability('lost');
  if (active) {
    cancelSessionRaf(active);
    detachGyro(active);
  }
}

function onContextRestored(): void {
  if (retired || !shared) return;
  restoredAt = clockNow();
  setSceneAvailability('ok');
  if (active) {
    applySize(active);
    ensureLoop(active, true);
  }
}

function bindCanvas(renderer: WebGLRenderer): void {
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  renderer.domElement.addEventListener(
    'webglcontextrestored',
    onContextRestored,
  );
}

function unbindCanvas(renderer: WebGLRenderer): void {
  renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
  renderer.domElement.removeEventListener(
    'webglcontextrestored',
    onContextRestored,
  );
}

function acquireRenderer(): WebGLRenderer {
  if (shared) {
    cancelIdle();
    return shared;
  }
  const factory = rendererFactory ?? createDefaultRenderer;
  const renderer = factory();
  noteGlCreate();
  bindCanvas(renderer);
  shared = renderer;
  return renderer;
}

function readDprCap(tier: Tier, width: number): number {
  if (import.meta.env.VITE_E2E === '1' && typeof window !== 'undefined') {
    const cap = (window as { __francesDprCap?: unknown }).__francesDprCap;
    if (typeof cap === 'number' && Number.isFinite(cap) && cap > 0) return cap;
  }
  const cores =
    typeof navigator === 'undefined'
      ? Number.NaN
      : navigator.hardwareConcurrency;
  return initialDprCap(
    tier,
    width,
    typeof cores === 'number' ? cores : Number.NaN,
  );
}

function styleCanvas(canvas: HTMLCanvasElement): void {
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.pointerEvents = 'none';
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
}

function publishDataset(session: Session, isDark: boolean): void {
  if (typeof document === 'undefined') return;
  const next = isDark ? 'dark' : 'light';
  const root = document.documentElement;
  if (root.dataset.palette === next) return;
  session.writingPalette = true;
  root.dataset.palette = next;
  publishedPalette = next;
  queueMicrotask(() => {
    session.writingPalette = false;
  });
}

function beginMix(session: Session, target: PaletteTarget): void {
  session.palette.isDark = target.isDark;
  let differ = false;
  for (const key of CHANNELS) {
    if (!sameColor(session.palette[key], target.colors[key])) differ = true;
  }
  if (!differ) return;
  for (const key of CHANNELS) {
    session.from[key].copy(session.palette[key]);
    session.to[key].copy(target.colors[key]);
  }
  session.mix = 0;
  ensureLoop(session, true);
}

function scheduleTheme(session: Session): void {
  if (!session.alive) return;
  if (session.themeRaf !== 0) return;
  session.themeRaf = requestAnimationFrame(() => {
    session.themeRaf = 0;
    if (!session.alive) return;
    const target = readPaletteTarget();
    publishDataset(session, target.isDark);
    beginMix(session, target);
  });
}

function applyMix(session: Session, dt: number): void {
  if (session.mix === 1) return;
  const next = dampMix(session.mix, dt);
  if (next === 1) {
    session.mix = 1;
    for (const key of CHANNELS) session.palette[key].copy(session.to[key]);
  } else {
    session.mix = next;
    for (const key of CHANNELS) {
      session.palette[key].copy(session.from[key]).lerp(session.to[key], next);
    }
  }
  session.palette.revision += 1;
}

function applySize(session: Session): void {
  const width = Math.max(session.container.clientWidth || 0, 1);
  const height = Math.max(session.container.clientHeight || 0, 1);
  session.camera.aspect = width / height;
  session.camera.updateProjectionMatrix();
  const dpr = Math.min(window.devicePixelRatio || 1, session.watchdog.dprCap);
  session.renderer.setPixelRatio(dpr);
  session.renderer.setSize(width, height, false);
  session.hooks.onResize?.(width, height);
}

function deadzone(value: number): number {
  return Math.abs(value) < 0.02 ? 0 : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function orientationNeedsPermission(): boolean {
  const ctor = (
    globalThis as { DeviceOrientationEvent?: { requestPermission?: unknown } }
  ).DeviceOrientationEvent;
  return typeof ctor?.requestPermission === 'function';
}

function armGyro(session: Session): void {
  if (session.gyroOn || orientationNeedsPermission()) return;
  const onOrientation = (ev: Event) => {
    const e = ev as DeviceOrientationEvent;
    const gamma = ((e.gamma ?? 0) * Math.PI) / 180;
    const beta = ((e.beta ?? 0) * Math.PI) / 180;
    session.rawTiltX = clamp(gamma * 0.12, -0.35, 0.35);
    session.rawTiltY = clamp(beta * 0.12, -0.35, 0.35);
  };
  window.addEventListener('deviceorientation', onOrientation);
  session.gyroOn = true;
  session.gyroOff = () => {
    window.removeEventListener('deviceorientation', onOrientation);
    session.gyroOn = false;
    session.gyroOff = null;
  };
}

function detachGyro(session: Session): void {
  session.gyroOff?.();
}

function filterTilt(session: Session, dt: number): void {
  if (dt <= 0) return;
  const k = 1 - Math.exp(-dt / 0.25);
  session.tiltX += (session.rawTiltX - session.tiltX) * k;
  session.tiltY += (session.rawTiltY - session.tiltY) * k;
}

function frameDt(session: Session, now: number): number {
  const previous = session.lastNow;
  session.lastNow = now;
  if (previous === null) return 0;
  const dt = (now - previous) / 1000;
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(dt, 0.08);
}

function shouldRender(session: Session, dt: number, force: boolean): boolean {
  if (!session.maxFps || force) return true;
  const budget = 1 / session.maxFps;
  session.fpsAccum += dt;
  if (session.fpsAccum < budget) return false;
  session.fpsAccum -= budget;
  return true;
}

function degrade(session: Session): void {
  retired = true;
  noteSessionCss();
  setSceneAvailability('css');
  try {
    session.container.replaceChildren();
  } catch {
    // El contenedor puede haberse desmontado.
  }
  destroySharedRenderer();
}

function tick(session: Session, now: number): void {
  session.raf = 0;
  if (!session.alive) return;
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'hidden'
  ) {
    return;
  }
  const dt = frameDt(session, now);
  const integrate =
    session.forceFrame || session.hooks.needsFrame() || session.mix < 1;
  session.forceFrame = false;
  if (integrate) {
    session.elapsed += dt;
    filterTilt(session, dt);
    if (!session.pointerInside && session.orientation === 'hold') {
      session.targetX = session.tiltX;
      session.targetY = session.tiltY;
    }
    const revisionBefore = session.palette.revision;
    applyMix(session, dt);
    if (session.palette.revision !== revisionBefore) {
      session.hooks.onTheme?.(session.palette);
    }
    const stepped = stepWatchdog(
      session.watchdog,
      dt,
      session.container.clientWidth < 768,
    );
    const previousTier = session.watchdog.tier;
    session.watchdog = stepped.state;
    if (stepped.degraded) {
      degrade(session);
      return;
    }
    if (stepped.resize) {
      if (session.watchdog.tier === 'lite' && previousTier !== 'lite') {
        noteRuntimeLite();
        session.hooks.onTier?.('lite');
      }
      applySize(session);
    }
    session.hooks.onFrame(
      dt,
      session.elapsed,
      deadzone(session.targetX),
      deadzone(session.targetY),
    );
  }
  const stopping = !session.hooks.needsFrame() && session.mix === 1;
  if (shouldRender(session, dt, stopping)) {
    try {
      session.renderer.render(session.scene, session.camera);
      noteHostFrame();
    } catch {
      // Un frame fallido no llega a la UI.
    }
  }
  if (stopping) {
    detachGyro(session);
    return;
  }
  armGyro(session);
  session.raf = requestAnimationFrame((stamp) => {
    tick(session, hostClock ? hostClock.now() : stamp);
  });
}

function ensureLoop(session: Session, integrate: boolean): void {
  if (!session.alive) return;
  if (integrate) session.forceFrame = true;
  if (session.raf !== 0) return;
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'hidden'
  ) {
    return;
  }
  armGyro(session);
  session.raf = requestAnimationFrame((stamp) => {
    tick(session, hostClock ? hostClock.now() : stamp);
  });
}

function cancelSessionRaf(session: Session): void {
  if (session.raf !== 0) {
    cancelAnimationFrame(session.raf);
    session.raf = 0;
  }
  if (session.themeRaf !== 0) {
    cancelAnimationFrame(session.themeRaf);
    session.themeRaf = 0;
  }
}

function teardown(session: Session): void {
  session.alive = false;
  cancelSessionRaf(session);
  detachGyro(session);
  for (const off of session.cleanups) {
    try {
      off();
    } catch {
      // El listener ya no está.
    }
  }
  session.cleanups.length = 0;
  try {
    session.hooks.dispose?.();
  } catch {
    // El dispose de la escena no puede romper el park.
  }
  try {
    disposeSceneGraph(session.scene);
  } catch {
    // El grafo puede estar ya dispuesto.
  }
  const canvas = session.renderer.domElement;
  if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  try {
    session.renderer.setSize(1, 1, false);
  } catch {
    // El renderer puede estar ya destruido.
  }
  if (active === session) active = null;
}

function scheduleIdle(): void {
  cancelIdle();
  idleTimer = scheduleLater(() => {
    idleTimer = null;
    if (active || !shared) return;
    destroySharedRenderer();
  }, 30_000);
}

export function destroySharedRenderer(): void {
  cancelIdle();
  if (active) teardown(active);
  if (!shared) return;
  const renderer = shared;
  shared = null;
  restoredAt = null;
  unbindCanvas(renderer);
  try {
    renderer.forceContextLoss();
  } catch {
    // El contexto de test puede no implementar la pérdida.
  }
  try {
    renderer.renderLists.dispose();
  } catch {
    // Las listas pueden no existir en un renderer falso.
  }
  try {
    renderer.dispose();
  } catch {
    // dispose defensivo.
  }
}

function park(): void {
  if (active) teardown(active);
  if (!shared) return;
  if (retired || getMotion3dPref() === 'off' || prefersReducedMotion()) {
    destroySharedRenderer();
    return;
  }
  scheduleIdle();
}

function attachSession(
  container: HTMLElement,
  renderer: WebGLRenderer,
  tier: Tier,
  setup: (
    scene: Scene,
    camera: PerspectiveCamera,
    palette: Palette,
  ) => HostHooks,
  options?: MountOptions,
): Session {
  styleCanvas(renderer.domElement);
  container.appendChild(renderer.domElement);
  const scene = new Scene();
  const camera = new PerspectiveCamera(options?.fov ?? 36, 1, 0.1, 40);
  camera.position.set(0, 0, options?.cameraZ ?? 5.2);
  const palette = createPalette();
  const target = readPaletteTarget();
  for (const key of CHANNELS) palette[key].copy(target.colors[key]);
  palette.isDark = target.isDark;
  const from = blankChannels();
  const to = blankChannels();
  for (const key of CHANNELS) {
    from[key].copy(palette[key]);
    to[key].copy(palette[key]);
  }
  const width = container.clientWidth || 0;
  const session: Session = {
    container,
    renderer,
    scene,
    camera,
    hooks: { onFrame: () => {}, needsFrame: () => false },
    palette,
    from,
    to,
    mix: 1,
    targetX: 0,
    targetY: 0,
    pointerInside: false,
    orientation: options?.orientation ?? 'rest',
    maxFps: options?.maxFps,
    fpsAccum: 0,
    raf: 0,
    themeRaf: 0,
    lastNow: null,
    elapsed: 0,
    watchdog: {
      frames: 0,
      over: 0,
      badWindows: 0,
      dprCap: readDprCap(tier === 'lite' ? 'lite' : 'full', width),
      tier: tier === 'lite' ? 'lite' : 'full',
      skipNext: false,
    },
    forceFrame: false,
    alive: true,
    writingPalette: false,
    cleanups: [],
    rawTiltX: 0,
    rawTiltY: 0,
    tiltX: 0,
    tiltY: 0,
    gyroOn: false,
    gyroOff: null,
  };
  publishDataset(session, target.isDark);
  session.hooks = setup(scene, camera, palette);
  active = session;

  const onPointer = (ev: PointerEvent) => {
    if (!session.alive || ev.pointerType !== 'mouse') return;
    const rect = session.container.getBoundingClientRect();
    const inside =
      rect.width > 0 &&
      rect.height > 0 &&
      ev.clientX >= rect.left &&
      ev.clientX <= rect.right &&
      ev.clientY >= rect.top &&
      ev.clientY <= rect.bottom;
    if (!inside) {
      if (!session.pointerInside) return;
      session.pointerInside = false;
      if (session.orientation === 'hold') {
        session.targetX = session.tiltX;
        session.targetY = session.tiltY;
      } else {
        session.targetX = 0;
        session.targetY = 0;
      }
      ensureLoop(session, true);
      return;
    }
    session.pointerInside = true;
    const nx = ((ev.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = -((ev.clientY - rect.top) / rect.height - 0.5) * 2;
    session.targetX = deadzone(nx);
    session.targetY = deadzone(ny);
    ensureLoop(session, true);
  };
  window.addEventListener('pointermove', onPointer, { passive: true });
  session.cleanups.push(() => {
    window.removeEventListener('pointermove', onPointer);
  });

  const onVisibility = () => {
    if (!session.alive) return;
    if (document.visibilityState === 'hidden') {
      try {
        session.renderer.setSize(1, 1, false);
      } catch {
        // El renderer ya no acepta tamaño.
      }
      cancelSessionRaf(session);
      detachGyro(session);
      return;
    }
    session.watchdog = { ...session.watchdog, skipNext: true };
    applySize(session);
    ensureLoop(session, true);
  };
  document.addEventListener('visibilitychange', onVisibility);
  session.cleanups.push(() => {
    document.removeEventListener('visibilitychange', onVisibility);
  });

  const onPageHide = () => {
    if (!session.alive) return;
    try {
      session.renderer.setSize(1, 1, false);
    } catch {
      // pagehide con renderer ya destruido.
    }
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('freeze', onPageHide);
  session.cleanups.push(() => {
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('freeze', onPageHide);
  });

  if (
    typeof MutationObserver === 'function' &&
    typeof document !== 'undefined'
  ) {
    const observer = new MutationObserver((records) => {
      if (
        session.writingPalette &&
        records.every((record) => record.attributeName === 'data-palette')
      ) {
        return;
      }
      scheduleTheme(session);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-palette'],
    });
    session.cleanups.push(() => observer.disconnect());
  }
  if (typeof window.matchMedia === 'function') {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => scheduleTheme(session);
    mql.addEventListener('change', onChange);
    session.cleanups.push(() => mql.removeEventListener('change', onChange));
  }
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (!session.alive) return;
      applySize(session);
    });
    observer.observe(container);
    session.cleanups.push(() => observer.disconnect());
  }

  applySize(session);
  ensureLoop(session, false);
  return session;
}

export function mountSceneHost(
  container: HTMLElement,
  tier: Tier,
  setup: (
    scene: Scene,
    camera: PerspectiveCamera,
    palette: Palette,
  ) => HostHooks,
  options?: MountOptions,
): () => void {
  if (tier === 'css' || retired) {
    if (retired) setSceneAvailability('css');
    return () => {};
  }
  if (active) {
    container.dataset.webgl = 'busy';
    warnBusy();
    return () => {};
  }
  let renderer: WebGLRenderer;
  try {
    renderer = acquireRenderer();
  } catch {
    retired = true;
    noteSessionCss();
    setSceneAvailability('css');
    return () => {};
  }
  const session = attachSession(container, renderer, tier, setup, options);
  return () => {
    if (active !== session) return;
    park();
  };
}

function legacyFrom(palette: Palette): ScenePalette {
  return {
    accent: palette.accent.getHex(),
    accentSoft: palette.accentSoft.getHex(),
    gold: palette.gold3d.getHex(),
    ok: palette.ok.getHex(),
    danger: palette.danger.getHex(),
    paper: palette.paper.getHex(),
    ink: palette.ink.getHex(),
    isDark: palette.isDark,
  };
}

export function mountThreeScene(
  container: HTMLElement,
  setup: (ctx: SceneHostContext) => SceneSetupResult,
): () => void {
  let easedX = 0;
  let easedY = 0;
  let legacy = readThemePalette();
  let lastRevision = -1;
  let result: SceneSetupResult | null = null;
  return mountSceneHost(
    container,
    getSessionTier(),
    (scene, camera, palette) => {
      const renderer = shared;
      if (!renderer) {
        throw new Error('SceneHost sin renderer');
      }
      legacy = legacyFrom(palette);
      lastRevision = palette.revision;
      result = setup({ scene, camera, renderer, palette: legacy });
      return {
        needsFrame: () => true,
        onFrame: (dt, elapsed, pointerX, pointerY) => {
          const gain = Math.min(dt * 6, 1);
          easedX += (pointerX - easedX) * gain;
          easedY += (pointerY - easedY) * gain;
          if (palette.revision !== lastRevision) {
            lastRevision = palette.revision;
            legacy = legacyFrom(palette);
            result?.onThemeChange?.(legacy);
          }
          result?.onFrame({
            elapsed,
            delta: dt,
            pointerX: easedX,
            pointerY: easedY,
            palette: legacy,
          });
        },
        onResize: (width, height) => result?.onResize?.(width, height),
        dispose: () => result?.dispose?.(),
      };
    },
    { fov: 36, cameraZ: 5.2 },
  );
}

export function __setRendererFactoryForTests(
  factory: (() => WebGLRenderer) | null,
): void {
  rendererFactory = factory;
}

export function __setHostClockForTests(clock: HostClock | null): void {
  hostClock = clock;
}

export function __resetSceneHostForTests(): void {
  retired = false;
  restoredAt = null;
  busyWarned = false;
  rendererFactory = null;
  hostClock = null;
  glCreateCount = 0;
  publishedPalette = null;
  destroySharedRenderer();
}

export function __glCreateCountForTests(): number {
  return glCreateCount;
}
