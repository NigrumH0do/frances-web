import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import {
  Color,
  LineSegments,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  type Material,
  type WebGLRenderer,
} from 'three';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import AuthNotebookScene, {
  buildNotebook,
  notebookGroupTarget,
  type NotebookRig,
} from './AuthNotebookScene';
import {
  __resetSceneHostForTests,
  __setRendererFactoryForTests,
  type HostHooks,
  type Palette,
} from './createSceneHost';
import { __resetTierForTests, __setProbeResultForTests } from './tier';

const calls = vi.hoisted(() => [] as unknown[][]);

vi.mock('./createSceneHost', async () => {
  const actual =
    await vi.importActual<typeof import('./createSceneHost')>(
      './createSceneHost',
    );
  return {
    ...actual,
    mountSceneHost: (...args: Parameters<typeof actual.mountSceneHost>) => {
      calls.push(args);
      return actual.mountSceneHost(...args);
    },
  };
});

const here = dirname(fileURLToPath(import.meta.url));

function palette(): Palette {
  const color = (hex: number) => new Color(hex);
  return {
    revision: 1,
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

function fakeRenderer(): WebGLRenderer {
  const canvas = document.createElement('canvas');
  return {
    domElement: canvas,
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
    renderLists: { dispose: vi.fn() },
    setClearColor: vi.fn(),
    outputColorSpace: '',
    toneMapping: 0,
    toneMappingExposure: 1,
  } as unknown as WebGLRenderer;
}

function makeRig(tier: 'full' | 'lite' = 'full'): {
  scene: Scene;
  rig: NotebookRig;
  colors: Palette;
} {
  const scene = new Scene();
  const colors = palette();
  const rig = buildNotebook(scene, colors, tier);
  return { scene, rig, colors };
}

function materialsOf(scene: Scene): Material[] {
  const found: Material[] = [];
  scene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || mesh.material === undefined) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    found.push(...list);
  });
  return found;
}

function sheenOf(material: Material): number {
  return (material as MeshPhysicalMaterial).sheen ?? 0;
}

describe('AuthNotebookScene', () => {
  beforeEach(() => {
    calls.length = 0;
    __resetSceneHostForTests();
    __resetTierForTests();
    __setProbeResultForTests('full');
    __setRendererFactoryForTests(fakeRenderer);
  });

  afterEach(() => {
    cleanup();
    __resetSceneHostForTests();
    __resetTierForTests();
  });

  test('monta el host v2 y el grafo no tiene LineSegments', () => {
    render(<AuthNotebookScene />);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toBe('full');
    expect(calls[0]?.[3]).toEqual({
      fov: 36,
      cameraZ: 6.4,
      orientation: 'rest',
    });
    expect(document.querySelector('canvas')).not.toBeNull();

    const setup = calls[0]?.[2] as (
      scene: Scene,
      camera: PerspectiveCamera,
      palette: Palette,
    ) => HostHooks;
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const hooks = setup(scene, camera, palette());
    expect(camera.fov).toBe(36);
    expect(camera.position.x).toBe(0);
    expect(camera.position.y).toBeCloseTo(0.35);
    expect(camera.position.z).toBeCloseTo(6.4);
    expect(hooks.needsFrame()).toBe(false);

    let lines = 0;
    scene.traverse((obj) => {
      if ((obj as LineSegments).isLineSegments) lines += 1;
    });
    expect(lines).toBe(0);

    const built = makeRig();
    built.scene.traverse((obj) => {
      expect((obj as LineSegments).isLineSegments).not.toBe(true);
    });

    const source = readFileSync(join(here, 'AuthNotebookScene.tsx'), 'utf8');
    expect(source).not.toContain('import * as THREE');
    expect(source).not.toContain('three/addons');
    expect(source).not.toContain('three/examples');
    expect(source).not.toContain('mountThreeScene');
    expect(source).toContain('mountSceneHost');
    expect(source).toContain('addStudioLights');
  });

  test('un solo sheen, en la cinta, y el terminal es oro metálico', () => {
    const { rig, colors } = makeRig('full');
    const sheenMeshes: Mesh[] = [];
    rig.group.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      if (list.some((material) => sheenOf(material) > 0))
        sheenMeshes.push(mesh);
    });

    expect(sheenMeshes).toHaveLength(1);
    expect(sheenMeshes[0]).toBe(rig.ribbon);
    const ribbonMat = rig.ribbon.material as MeshPhysicalMaterial;
    expect(ribbonMat.sheen).toBe(0.55);
    expect(ribbonMat.sheenRoughness).toBe(0.7);
    expect(ribbonMat.roughness).toBe(0.85);
    expect(ribbonMat.sheenColor.r).toBe(colors.accent.r);
    expect(ribbonMat.sheenColor.g).toBe(colors.accent.g);
    expect(ribbonMat.sheenColor.b).toBe(colors.accent.b);

    const terminalMat = rig.terminal.material as MeshPhysicalMaterial;
    expect(terminalMat.metalness).toBe(1);
    expect(terminalMat.roughness).toBe(0.32);
    expect(terminalMat.clearcoat).toBe(0.35);
    expect(terminalMat.clearcoatRoughness).toBe(0.45);
    expect(terminalMat.color.r).toBe(colors.gold3d.r);
    expect(terminalMat.color.g).toBe(colors.gold3d.g);
    expect(terminalMat.color.b).toBe(colors.gold3d.b);

    const inkBefore = (rig.spine.material as MeshStandardMaterial).color.r;
    colors.ink.r = 0.2;
    rig.syncTheme(colors);
    expect((rig.spine.material as MeshStandardMaterial).color.r).toBe(
      inkBefore,
    );
    colors.revision += 1;
    rig.syncTheme(colors);
    expect((rig.spine.material as MeshStandardMaterial).color.r).toBe(0.2);

    rig.applyLite();
    rig.applyLite();
    const liteMat = rig.terminal.material as MeshStandardMaterial;
    expect(liteMat.isMeshStandardMaterial).toBe(true);
    expect((liteMat as MeshPhysicalMaterial).isMeshPhysicalMaterial).not.toBe(
      true,
    );
    expect(liteMat.metalness).toBe(1);
    expect((liteMat as MeshPhysicalMaterial).clearcoat).toBeUndefined();
    expect(liteMat.color.r).toBe(colors.gold3d.r);

    const lite = makeRig('lite');
    const born = lite.rig.terminal.material as MeshStandardMaterial;
    expect(born.isMeshStandardMaterial).toBe(true);
    expect((born as MeshPhysicalMaterial).isMeshPhysicalMaterial).not.toBe(
      true,
    );
    expect(born.metalness).toBe(1);
    expect(born.color.r).toBe(lite.colors.gold3d.r);
  });

  test('ningún material nace con transparent: true', () => {
    for (const tier of ['full', 'lite'] as const) {
      const { scene } = makeRig(tier);
      for (const material of materialsOf(scene)) {
        expect(material.transparent).toBe(false);
      }
    }
  });

  test('con el puntero en 0 durante 2 s los resortes se asientan', () => {
    const { rig } = makeRig();
    const frame = 1 / 60;
    for (let i = 0; i < 120; i += 1) rig.step(frame, 0);
    const springs = rig.springs();
    expect(Math.abs(springs.group.p - springs.group.target)).toBeLessThan(1e-3);
    expect(Math.abs(springs.group.v)).toBeLessThan(1e-3);
    expect(Math.abs(springs.ribbon.p - springs.ribbon.target)).toBeLessThan(
      1e-3,
    );
    expect(Math.abs(springs.ribbon.v)).toBeLessThan(1e-3);
    expect(rig.needsFrame()).toBe(false);
  });

  test('el target del grupo se clampea a 0.18 y 0.22', () => {
    expect(notebookGroupTarget(1)).toBeCloseTo(0.18, 5);
    expect(notebookGroupTarget(5)).toBeCloseTo(0.22, 5);
    expect(notebookGroupTarget(-5)).toBeCloseTo(-0.22, 5);

    const { rig } = makeRig();
    rig.step(1 / 60, 1);
    const first = rig.springs();
    expect(first.group.target).toBeCloseTo(0.18, 5);
    expect(first.group.p).toBeGreaterThan(0);
    expect(first.ribbon.target).toBeLessThan(first.group.p);

    for (let i = 0; i < 60; i += 1) rig.step(1 / 60, 1);
    expect(rig.springs().group.target).toBeCloseTo(0.18, 5);
    expect(rig.springs().group.p).toBeCloseTo(0.18, 2);

    rig.step(1 / 60, 5);
    expect(rig.springs().group.target).toBeCloseTo(0.22, 5);
  });

  test('el grafo cabe en 2500 vértices y 8 mallas', () => {
    const { scene, rig } = makeRig();
    let meshes = 0;
    let vertices = 0;
    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      meshes += 1;
      vertices += mesh.geometry.getAttribute('position')?.count ?? 0;
      expect(mesh.geometry.type).not.toBe('TorusGeometry');
    });
    expect(meshes).toBeLessThanOrEqual(8);
    expect(vertices).toBeLessThanOrEqual(2500);
    expect(meshes).toBeGreaterThan(0);

    expect(rig.group.rotation.x).toBeCloseTo((16 * Math.PI) / 180, 5);
    expect(rig.group.rotation.y).toBeCloseTo((-22 * Math.PI) / 180, 5);
    expect(rig.rightCover.rotation.y).toBeCloseTo((28 * Math.PI) / 180, 5);

    const cover = rig.leftCover.material as MeshStandardMaterial;
    const pages = rig.pages.material as MeshStandardMaterial;
    const spine = rig.spine.material as MeshStandardMaterial;
    const pageLum = pages.color.r + pages.color.g + pages.color.b;
    const coverLum = cover.color.r + cover.color.g + cover.color.b;
    expect(pageLum).toBeGreaterThan(coverLum);
    expect(cover.roughness).toBe(0.92);
    expect(cover.metalness).toBe(0);
    expect(cover.roughnessMap).toBeTruthy();
    expect(spine.roughness).toBe(0.9);
    expect(spine.metalness).toBe(0);
    expect(spine.map).toBeTruthy();
    expect((rig.sheet.material as MeshStandardMaterial).map).toBeTruthy();
    expect(rig.sheet.geometry.type).toBe('PlaneGeometry');
  });
});
