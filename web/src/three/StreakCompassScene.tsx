import { useEffect, useRef } from 'react';
import {
  CanvasTexture,
  CircleGeometry,
  ExtrudeGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Scene,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  type Color,
} from 'three';
import { drawCompassDialCanvas, type DialColors } from './compassDial';
import { mountSceneHost, type Palette } from './createSceneHost';
import { addStudioLights } from './lights';
import { stepSpring } from './spring';
import { getRuntimeTier } from './tier';

const DIAL_SIZE = 256;
const SPRING_OMEGA = 16;
const SPRING_ZETA = 0.72;
const SHOWN_LAMBDA = 4;
const SHOWN_EPSILON = 0.01;
const SPRING_EPSILON = 1e-3;
const OPACITY_FLOOR = 0.02;

export function compassMastery(streak: number): number {
  return Math.min(1, Math.max(0, streak / 30));
}

export function compassTremor(elapsed: number, streak: number): number {
  const mastery = compassMastery(streak);
  if (mastery >= 1) return 0;
  return Math.sin(elapsed * 0.6) * 0.04 * (1 - mastery);
}

export function stepCompassShown(
  shown: number,
  streak: number,
  dt: number,
): number {
  if (dt <= 0) return shown;
  return shown + (streak - shown) * (1 - Math.exp(-SHOWN_LAMBDA * dt));
}

export interface CompassRig {
  root: Group;
  face: Mesh;
  bezel: Mesh;
  north: Mesh;
  south: Mesh;
  pivot: Mesh;
  ring3: Mesh;
  ring7: Mesh;
  ring30: Mesh;
  needle: Group;
  readonly shown: number;
  step(dt: number, elapsed: number, pointerX: number, streak: number): void;
  syncShown(value: number): void;
  needsFrame(streak: number): boolean;
  onTheme(palette: Palette): void;
  onTier(tier: 'lite'): void;
  dispose(): void;
}

function colorBytes(color: Color): [number, number, number] {
  const hex = color.getHex();
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function dialColors(palette: Palette): DialColors {
  return {
    ink: colorBytes(palette.ink),
    paper: colorBytes(palette.paper),
  };
}

function materialOf(mesh: Mesh): MeshStandardMaterial {
  const material = mesh.material;
  if (Array.isArray(material)) return material[0] as MeshStandardMaterial;
  return material as MeshStandardMaterial;
}

function createBezelMaterial(
  palette: Palette,
  tier: 'full' | 'lite',
): MeshStandardMaterial {
  const shared = {
    color: palette.gold3d,
    emissive: palette.gold3d,
    emissiveIntensity: 0,
    roughness: 0.35,
    metalness: 0.84,
  };
  if (tier === 'lite') return new MeshStandardMaterial(shared);
  return new MeshPhysicalMaterial({
    ...shared,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
  });
}

function arrowGeometry(
  length: number,
  halfWidth: number,
  upward: boolean,
): ExtrudeGeometry {
  const shape = new Shape();
  const tip = upward ? length : -length;
  shape.moveTo(0, tip);
  shape.lineTo(halfWidth, 0);
  shape.lineTo(-halfWidth, 0);
  shape.closePath();
  return new ExtrudeGeometry(shape, {
    depth: 0.02,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
}

function applyRing(mesh: Mesh, opacity: number): void {
  const material = materialOf(mesh);
  material.opacity = opacity;
  if (opacity < OPACITY_FLOOR) {
    mesh.visible = false;
    if (material.transparent) {
      material.transparent = false;
      material.needsUpdate = true;
    }
    material.depthWrite = true;
    return;
  }
  mesh.visible = true;
  const transparent = opacity < 1;
  if (material.transparent !== transparent) {
    material.transparent = transparent;
    material.needsUpdate = true;
  }
  material.depthWrite = !transparent;
}

function ringMesh(radius: number, color: Color): Mesh {
  const mesh = new Mesh(
    new TorusGeometry(radius, 0.014, 6, 48),
    new MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.15,
      opacity: 0,
      transparent: false,
    }),
  );
  mesh.visible = false;
  mesh.position.z = 0.02;
  return mesh;
}

export function buildCompass(
  scene: Scene,
  palette: Palette,
  tier: 'full' | 'lite',
): CompassRig {
  let current = palette;
  let tierNow = tier;
  let withLetter = false;
  let shown = 0;
  let angle = 0;
  let velocity = 0;
  let pointerX = 0;
  let alive = true;
  let fontsPending = false;
  let pendingFrame = false;

  const canvas = document.createElement('canvas');
  canvas.width = DIAL_SIZE;
  canvas.height = DIAL_SIZE;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 1;

  const repaint = (): void => {
    drawCompassDialCanvas(canvas, withLetter, dialColors(current));
    texture.needsUpdate = true;
  };
  repaint();

  const face = new Mesh(
    new CircleGeometry(1, 32),
    new MeshStandardMaterial({
      color: 0xffffff,
      map: texture,
      roughness: 0.92,
      metalness: 0,
    }),
  );
  const bezel = new Mesh(
    new TorusGeometry(1.04, 0.055, 8, 64),
    createBezelMaterial(palette, tier),
  );
  const ring3 = ringMesh(0.8, palette.accent);
  const ring7 = ringMesh(0.66, palette.accent);
  const ring30 = ringMesh(0.52, palette.gold3d);

  const north = new Mesh(
    arrowGeometry(0.68, 0.12, true),
    new MeshStandardMaterial({
      color: palette.accent,
      roughness: 0.35,
      metalness: 0.2,
    }),
  );
  north.position.y = 0.08;
  const south = new Mesh(
    arrowGeometry(0.4, 0.09, false),
    new MeshStandardMaterial({
      color: palette.ink,
      roughness: 0.42,
      metalness: 0.16,
    }),
  );
  south.position.y = -0.05;
  const pivot = new Mesh(
    new SphereGeometry(0.07, 8, 6),
    new MeshStandardMaterial({
      color: palette.gold3d,
      roughness: 0.32,
      metalness: 0.9,
    }),
  );
  pivot.position.z = 0.04;

  const needle = new Group();
  needle.position.z = 0.05;
  needle.add(north, south);
  const root = new Group();
  root.add(face, bezel, ring3, ring7, ring30, pivot, needle);
  scene.add(root);

  const paintShown = (value: number): void => {
    applyRing(ring3, MathUtils.smoothstep(value, 2.2, 3));
    applyRing(ring7, MathUtils.smoothstep(value, 6.2, 7));
    applyRing(ring30, MathUtils.smoothstep(value, 29.2, 30));
    const glow14 = MathUtils.smoothstep(value, 13.2, 14);
    const glow30 = MathUtils.smoothstep(value, 29.2, 30);
    materialOf(bezel).emissiveIntensity = 0.12 * glow14 + 0.06 * glow30;
  };
  paintShown(0);

  const fonts = document.fonts;
  if (fonts && typeof fonts.ready?.then === 'function') {
    fontsPending = true;
    void fonts.ready
      .then(() => {
        if (!alive) return;
        if (typeof fonts.check === 'function' && fonts.check('16px Spectral')) {
          withLetter = true;
          repaint();
        }
        fontsPending = false;
        pendingFrame = true;
      })
      .catch(() => {
        if (!alive) return;
        fontsPending = false;
        pendingFrame = true;
      });
  }

  return {
    root,
    face,
    bezel,
    north,
    south,
    pivot,
    ring3,
    ring7,
    ring30,
    needle,
    get shown() {
      return shown;
    },
    step(dt, elapsed, pointer, streak) {
      pointerX = pointer;
      const target = pointer * 0.35;
      [angle, velocity] = stepSpring(
        angle,
        velocity,
        target,
        dt,
        SPRING_OMEGA,
        SPRING_ZETA,
      );
      shown = stepCompassShown(shown, streak, dt);
      root.rotation.y = angle;
      needle.rotation.z = compassTremor(elapsed, streak);
      paintShown(shown);
      pendingFrame = false;
    },
    syncShown(value) {
      shown = value;
      paintShown(value);
    },
    needsFrame(streak) {
      if (!alive) return false;
      if (fontsPending || pendingFrame) return true;
      const target = pointerX * 0.35;
      const settled =
        Math.abs(angle - target) < SPRING_EPSILON &&
        Math.abs(velocity) < SPRING_EPSILON;
      if (!settled) return true;
      if (Math.abs(shown - streak) >= SHOWN_EPSILON) return true;
      return compassMastery(streak) < 1;
    },
    onTheme(next) {
      current = next;
      const bezelMat = materialOf(bezel);
      bezelMat.color.copy(next.gold3d);
      bezelMat.emissive.copy(next.gold3d);
      materialOf(north).color.copy(next.accent);
      materialOf(south).color.copy(next.ink);
      materialOf(pivot).color.copy(next.gold3d);
      materialOf(ring3).color.copy(next.accent);
      materialOf(ring7).color.copy(next.accent);
      materialOf(ring30).color.copy(next.gold3d);
      repaint();
    },
    onTier(next) {
      if (next !== 'lite' || tierNow === 'lite') return;
      tierNow = 'lite';
      const previous = materialOf(bezel);
      bezel.material = new MeshStandardMaterial({
        color: previous.color.clone(),
        emissive: previous.emissive.clone(),
        emissiveIntensity: previous.emissiveIntensity,
        roughness: 0.35,
        metalness: previous.metalness,
      });
      previous.dispose();
    },
    dispose() {
      alive = false;
      texture.dispose();
    },
  };
}

export default function StreakCompassScene({
  streak = 0,
  className = 'three-host compass-three',
}: {
  streak?: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const streakRef = useRef(streak);
  streakRef.current = streak;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const tier = getRuntimeTier();
    return mountSceneHost(
      el,
      tier,
      (scene, camera, hostPalette) => {
        camera.position.set(0, 0, 4.4);
        const lights = addStudioLights(scene, hostPalette);
        const compass = buildCompass(
          scene,
          hostPalette,
          tier === 'lite' ? 'lite' : 'full',
        );
        return {
          onFrame(dt, elapsed, pointerX) {
            compass.step(dt, elapsed, pointerX, streakRef.current);
          },
          needsFrame() {
            return compass.needsFrame(streakRef.current);
          },
          onTheme(next) {
            lights.sync(next);
            compass.onTheme(next);
          },
          onTier(next) {
            compass.onTier(next);
          },
          dispose() {
            compass.dispose();
            lights.dispose();
          },
        };
      },
      { orientation: 'hold', maxFps: 24 },
    );
  }, []);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
