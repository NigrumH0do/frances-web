import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CircleGeometry,
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Scene,
  TorusGeometry,
  type Mesh,
} from 'three';
import { expect, test } from 'vitest';
import type { Palette } from './createSceneHost';
import {
  buildCompass,
  compassMastery,
  compassTremor,
  stepCompassShown,
} from './StreakCompassScene';

function palette(): Palette {
  const color = (hex: number) => new Color(hex);
  return {
    revision: 0,
    isDark: false,
    accent: color(0x2147a3),
    accentSoft: color(0xe6eeff),
    paper: color(0xfefcf8),
    ink: color(0x232430),
    ok: color(0x006150),
    danger: color(0xa4283a),
    gold3d: color(0xd3ac41),
    scoreExcelente: color(0x006150),
    scoreBien: color(0x2147a3),
    scoreMejorable: color(0x7c4607),
    scoreRepetir: color(0xa4283a),
  };
}

function materialOf(mesh: Mesh): MeshStandardMaterial {
  if (Array.isArray(mesh.material)) {
    throw new Error('material inesperado');
  }
  return mesh.material as MeshStandardMaterial;
}

test('el sur es tinta y ningún material usa el hex de danger', () => {
  const scene = new Scene();
  const colors = palette();
  const rig = buildCompass(scene, colors, 'full');
  const south = materialOf(rig.south);
  const bezel = materialOf(rig.bezel) as MeshPhysicalMaterial;

  expect(south.color.equals(colors.ink)).toBe(true);
  expect(south.color.getHex()).toBe(colors.ink.getHex());
  expect(bezel).toBeInstanceOf(MeshPhysicalMaterial);
  expect(bezel.clearcoat).toBe(0.3);
  expect(bezel.roughness).toBe(0.35);
  expect(bezel.color.getHex()).toBe(colors.gold3d.getHex());
  expect(bezel.emissive.getHex()).toBe(colors.gold3d.getHex());

  scene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh !== true) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      const colored = material as MeshStandardMaterial;
      expect(colored.color?.getHex()).not.toBe(colors.danger.getHex());
      expect(colored.emissive?.getHex()).not.toBe(colors.danger.getHex());
    }
  });
});

test('la maestría se satura en 30 días y ahí el tremor vale 0', () => {
  expect(compassMastery(0)).toBe(0);
  expect(compassMastery(30)).toBe(1);
  expect(compassMastery(45)).toBe(1);
  expect(compassMastery(-3)).toBe(0);

  const peak = Math.PI / (2 * 0.6);
  expect(compassTremor(peak, 0)).toBeCloseTo(0.04, 5);
  expect(compassTremor(peak, 30)).toBe(0);
  expect(compassTremor(1.7, 30)).toBe(0);
  expect(compassTremor(4.2, 45)).toBe(0);
  expect(compassTremor(peak, -3)).toBeCloseTo(0.04, 5);
});

test('shown persigue la racha con λ = 4', () => {
  const scene = new Scene();
  const rig = buildCompass(scene, palette(), 'full');
  const frame = 1 / 60;
  let pure = 0;
  let elapsed = 0;
  for (let i = 0; i < 60; i += 1) {
    rig.step(frame, elapsed, 0, 7);
    pure = stepCompassShown(pure, 7, frame);
    elapsed += frame;
  }
  const expected = 7 * (1 - Math.exp(-4));
  expect(rig.shown).toBe(pure);
  expect(Math.abs(pure - expected)).toBeLessThan(1e-3);
});

test('los hitos 3, 14 y 30 encienden anillos y el emisivo del bisel', () => {
  const scene = new Scene();
  const colors = palette();
  const rig = buildCompass(scene, colors, 'full');
  const bezel = materialOf(rig.bezel);
  const ring3 = materialOf(rig.ring3);
  const ring7 = materialOf(rig.ring7);
  const ring30 = materialOf(rig.ring30);

  expect(rig.ring7.geometry).toBeInstanceOf(TorusGeometry);
  expect((rig.ring7.geometry as TorusGeometry).parameters.radius).toBeLessThan(
    (rig.ring3.geometry as TorusGeometry).parameters.radius,
  );
  expect(ring3.color.getHex()).toBe(colors.accent.getHex());
  expect(ring30.color.getHex()).toBe(colors.gold3d.getHex());

  rig.syncShown(2.2);
  expect(ring3.opacity).toBe(0);
  expect(rig.ring3.visible).toBe(false);
  expect(ring3.transparent).toBe(false);

  rig.syncShown(3);
  expect(ring3.opacity).toBe(1);
  expect(rig.ring3.visible).toBe(true);
  expect(ring3.transparent).toBe(false);
  expect(ring7.opacity).toBe(0);
  expect(rig.ring7.visible).toBe(false);

  rig.syncShown(14);
  expect(bezel.emissiveIntensity).toBeCloseTo(0.12, 5);
  expect(bezel.emissive.getHex()).toBe(colors.gold3d.getHex());

  rig.syncShown(30);
  expect(rig.ring30.visible).toBe(true);
  expect(ring30.opacity).toBe(1);
  expect(bezel.emissiveIntensity).toBeCloseTo(0.18, 5);
});

test('el grafo cabe en 2000 vértices y 8 mallas', () => {
  const scene = new Scene();
  const rig = buildCompass(scene, palette(), 'full');
  let vertices = 0;
  let meshes = 0;
  scene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh !== true) return;
    meshes += 1;
    vertices += mesh.geometry.getAttribute('position').count;
  });

  expect(vertices).toBeLessThanOrEqual(2000);
  expect(meshes).toBeLessThanOrEqual(8);
  expect(rig.face.geometry).toBeInstanceOf(CircleGeometry);
  expect((rig.face.geometry as CircleGeometry).parameters.radius).toBe(1);
  expect((rig.face.geometry as CircleGeometry).parameters.segments).toBe(32);
  expect(rig.bezel.geometry).toBeInstanceOf(TorusGeometry);
  expect((rig.bezel.geometry as TorusGeometry).parameters.radialSegments).toBe(
    8,
  );
  expect((rig.bezel.geometry as TorusGeometry).parameters.tubularSegments).toBe(
    64,
  );
  for (const ring of [rig.ring3, rig.ring7, rig.ring30]) {
    const torus = ring.geometry as TorusGeometry;
    expect(torus.parameters.radialSegments).toBe(6);
    expect(torus.parameters.tubularSegments).toBe(48);
  }
});

test('el fuente suelta el tope 21, el danger del sur y el namespace de three', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'StreakCompassScene.tsx'),
    'utf8',
  );
  expect(source.includes('Math.min(streak')).toBe(false);
  expect(source.includes('21')).toBe(false);
  expect(source.includes('palette.danger')).toBe(false);
  expect(source.includes('import * as THREE')).toBe(false);
  expect(source.includes('mountThreeScene')).toBe(false);
  expect(source.includes('mountSceneHost')).toBe(true);
  expect(source.includes('addStudioLights')).toBe(true);
  expect(source.includes("orientation: 'hold'")).toBe(true);
  expect(source.includes('maxFps: 24')).toBe(true);
});

test('con racha 30 y el resorte quieto needsFrame es falso', () => {
  const scene = new Scene();
  const rig = buildCompass(scene, palette(), 'full');
  const frame = 1 / 60;
  let elapsed = 0;
  for (let i = 0; i < 240; i += 1) {
    rig.step(frame, elapsed, 0, 30);
    elapsed += frame;
  }
  expect(rig.needsFrame(30)).toBe(false);
  expect(rig.needle.rotation.z).toBe(0);

  elapsed = 0;
  for (let i = 0; i < 240; i += 1) {
    rig.step(frame, elapsed, 1, 30);
    elapsed += frame;
  }
  expect(rig.root.rotation.y).toBeCloseTo(0.35, 2);
  expect(rig.needsFrame(30)).toBe(false);
  expect(rig.needsFrame(0)).toBe(true);
});
