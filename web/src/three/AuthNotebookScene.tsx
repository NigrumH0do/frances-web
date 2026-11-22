import { useEffect, useRef } from 'react';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Material,
  type Scene,
  type Texture,
} from 'three';
import { mountSceneHost, type Palette } from './createSceneHost';
import { addStudioLights } from './lights';
import { stepSpring } from './spring';
import { createNotebookTextures } from './textures';
import { getSessionTier } from './tier';

const REST_X = (16 * Math.PI) / 180;
const REST_Y = (-22 * Math.PI) / 180;
const OPEN_Y = (28 * Math.PI) / 180;
const GROUP_OMEGA = 9;
const GROUP_ZETA = 0.86;
const RIBBON_OMEGA = 7;
const RIBBON_ZETA = 0.62;
const RIBBON_DELAY = 0.04;
const SAMPLE_CAP = 24;
/** 1 unidad = 100 mm: la hoja se separa 1 mm y el terminal mide unos 4 mm. */
const MM = 0.01;

export function notebookGroupTarget(pointer: number): number {
  const raw = pointer * 0.18;
  if (raw > 0.22) return 0.22;
  if (raw < -0.22) return -0.22;
  return raw;
}

export interface NotebookSpring {
  p: number;
  v: number;
  target: number;
}

export interface NotebookRig {
  group: Group;
  spine: Mesh;
  leftCover: Mesh;
  rightCover: Mesh;
  pages: Mesh;
  sheet: Mesh;
  ribbon: Mesh;
  terminal: Mesh;
  step(dt: number, pointer: number): void;
  needsFrame(): boolean;
  springs(): { group: NotebookSpring; ribbon: NotebookSpring };
  syncTheme(next: Palette): void;
  applyLite(): void;
  dispose(): void;
}

function coverColor(paper: Palette['paper']): MeshStandardMaterial['color'] {
  return paper.clone().multiplyScalar(0.92);
}

function terminalMaterial(
  palette: Palette,
  lite: boolean,
): MeshPhysicalMaterial | MeshStandardMaterial {
  if (lite) {
    const material = new MeshStandardMaterial({
      metalness: 1,
      roughness: 0.32,
      transparent: false,
    });
    material.color.copy(palette.gold3d);
    return material;
  }
  const material = new MeshPhysicalMaterial({
    metalness: 1,
    roughness: 0.32,
    clearcoat: 0.35,
    clearcoatRoughness: 0.45,
    sheen: 0,
    transparent: false,
  });
  material.color.copy(palette.gold3d);
  return material;
}

export function buildNotebook(
  scene: Scene,
  palette: Palette,
  tier: 'full' | 'lite',
): NotebookRig {
  const textures = createNotebookTextures(tier, palette.paper);

  const spineMat = new MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0,
    map: textures.stitch,
    transparent: false,
  });
  spineMat.color.copy(palette.ink);

  const coverMat = new MeshStandardMaterial({
    roughness: 0.92,
    metalness: 0,
    roughnessMap: textures.grain,
    transparent: false,
  });
  coverMat.color.copy(coverColor(palette.paper));

  const pageMat = new MeshStandardMaterial({
    roughness: 0.96,
    metalness: 0,
    transparent: false,
  });
  pageMat.color.copy(palette.paper);

  const sheetMat = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0,
    map: textures.seyes,
    transparent: false,
  });

  const ribbonMat = new MeshPhysicalMaterial({
    roughness: 0.85,
    metalness: 0,
    sheen: 0.55,
    sheenRoughness: 0.7,
    transparent: false,
  });
  ribbonMat.color.copy(palette.accent);
  ribbonMat.sheenColor.copy(palette.accent);

  let downgraded = tier === 'lite';
  let terminalMat = terminalMaterial(palette, downgraded);

  const blockDepth = 0.18;
  const blockX = -0.08;
  const hingeX = blockX - 1.56 / 2;

  const spine = new Mesh(new BoxGeometry(0.14, 2.28, 0.24), spineMat);
  spine.name = 'spine';
  spine.position.set(hingeX - 0.07, 0, 0);

  const pages = new Mesh(new BoxGeometry(1.56, 2.1, blockDepth), pageMat);
  pages.name = 'pages';
  pages.position.set(blockX, 0, 0);

  const leftCover = new Mesh(new BoxGeometry(0.82, 2.2, 0.03), coverMat);
  leftCover.name = 'leftCover';
  leftCover.position.set(-0.42, 0, blockDepth / 2 + 0.015 + MM * 0.4);
  leftCover.rotation.y = 0;

  const rightGeo = new BoxGeometry(1.58, 2.22, 0.03);
  rightGeo.translate(0.79, 0, 0);
  const rightCover = new Mesh(rightGeo, coverMat);
  rightCover.name = 'rightCover';
  rightCover.position.set(hingeX, 0, 0);
  rightCover.rotation.y = OPEN_Y;

  const sheet = new Mesh(new PlaneGeometry(0.72, 1.98), sheetMat);
  sheet.name = 'sheet';
  sheet.position.set(0.32, 0, blockDepth / 2 + MM);

  const ribbon = new Mesh(new BoxGeometry(1.15, 0.036, 0.01), ribbonMat);
  ribbon.name = 'ribbon';
  ribbon.position.set(hingeX + 0.62, -0.72, blockDepth / 2 + 0.03);

  const terminal = new Mesh(new BoxGeometry(0.04, 0.055, 0.016), terminalMat);
  terminal.name = 'terminal';
  terminal.position.set(hingeX + 1.2, -0.8, blockDepth / 2 + 0.03);

  const ribbonHinge = new Group();
  ribbonHinge.name = 'ribbonHinge';
  ribbonHinge.add(ribbon, terminal);

  const group = new Group();
  group.name = 'notebook';
  group.rotation.x = REST_X;
  group.rotation.y = REST_Y;
  group.add(spine, pages, leftCover, rightCover, sheet, ribbonHinge);
  scene.add(group);

  let pointer = 0;
  let groupP = 0;
  let groupV = 0;
  let ribbonP = 0;
  let ribbonV = 0;
  let ribbonTarget = 0;
  let time = 0;
  let revision = palette.revision;
  const sampleT = new Float64Array(SAMPLE_CAP);
  const sampleR = new Float64Array(SAMPLE_CAP);
  let write = 0;
  let filled = 0;

  // La cinta no copia el giro al instante: guarda la rotación del grupo
  // y el resorte lee la muestra de hace 40 ms.
  const remember = (at: number, rotation: number): void => {
    sampleT[write] = at;
    sampleR[write] = rotation;
    write = (write + 1) % SAMPLE_CAP;
    if (filled < SAMPLE_CAP) filled += 1;
  };

  const delayed = (at: number): number => {
    const want = at - RIBBON_DELAY;
    let bestT = Number.NEGATIVE_INFINITY;
    let bestR = 0;
    let found = false;
    const start = filled < SAMPLE_CAP ? 0 : write;
    for (let i = 0; i < filled; i += 1) {
      const index = (start + i) % SAMPLE_CAP;
      const stamp = sampleT[index] ?? 0;
      if (stamp <= want && stamp >= bestT) {
        bestT = stamp;
        bestR = sampleR[index] ?? 0;
        found = true;
      }
    }
    return found ? bestR : 0;
  };

  remember(-RIBBON_DELAY, 0);

  const settled = (
    position: number,
    velocity: number,
    target: number,
  ): boolean => Math.abs(position - target) < 1e-3 && Math.abs(velocity) < 1e-3;

  const rig: NotebookRig = {
    group,
    spine,
    leftCover,
    rightCover,
    pages,
    sheet,
    ribbon,
    terminal,
    step(dt, nextPointer) {
      if (dt <= 0) return;
      pointer = nextPointer;
      const target = notebookGroupTarget(pointer);
      [groupP, groupV] = stepSpring(
        groupP,
        groupV,
        target,
        dt,
        GROUP_OMEGA,
        GROUP_ZETA,
      );
      time += dt;
      remember(time, groupP);
      ribbonTarget = delayed(time);
      [ribbonP, ribbonV] = stepSpring(
        ribbonP,
        ribbonV,
        ribbonTarget,
        dt,
        RIBBON_OMEGA,
        RIBBON_ZETA,
      );
      group.rotation.x = REST_X;
      group.rotation.y = REST_Y + groupP;
      ribbonHinge.rotation.y = ribbonP - groupP;
    },
    needsFrame() {
      return !(
        settled(groupP, groupV, notebookGroupTarget(pointer)) &&
        settled(ribbonP, ribbonV, ribbonTarget)
      );
    },
    springs() {
      return {
        group: {
          p: groupP,
          v: groupV,
          target: notebookGroupTarget(pointer),
        },
        ribbon: { p: ribbonP, v: ribbonV, target: ribbonTarget },
      };
    },
    syncTheme(next) {
      if (next.revision === revision) return;
      revision = next.revision;
      spineMat.color.copy(next.ink);
      coverMat.color.copy(coverColor(next.paper));
      pageMat.color.copy(next.paper);
      ribbonMat.color.copy(next.accent);
      ribbonMat.sheenColor.copy(next.accent);
      terminalMat.color.copy(next.gold3d);
    },
    applyLite() {
      if (downgraded) return;
      downgraded = true;
      const next = new MeshStandardMaterial({
        metalness: 1,
        roughness: 0.32,
        transparent: false,
      });
      next.color.copy(terminalMat.color);
      terminal.material = next;
      terminalMat.dispose();
      terminalMat = next;
    },
    dispose() {
      const geometries = new Set<BufferGeometry>();
      const materials = new Set<Material>();
      const maps = new Set<Texture>();
      group.traverse((obj) => {
        const mesh = obj as Mesh;
        if (!mesh.isMesh) return;
        geometries.add(mesh.geometry);
        const list = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const material of list) materials.add(material);
      });
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (
            typeof value === 'object' &&
            value !== null &&
            (value as Texture).isTexture === true
          ) {
            maps.add(value as Texture);
          }
        }
        material.dispose();
      }
      for (const texture of maps) texture.dispose();
      for (const geometry of geometries) geometry.dispose();
      scene.remove(group);
    },
  };

  return rig;
}

export default function AuthNotebookScene({
  className = 'three-host auth-three',
}: {
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const tier = getSessionTier();
    return mountSceneHost(
      el,
      tier,
      (scene, camera, palette) => {
        camera.fov = 36;
        camera.position.set(0, 0.35, 6.4);
        camera.updateProjectionMatrix();
        const lights = addStudioLights(scene, palette);
        const notebook = buildNotebook(
          scene,
          palette,
          tier === 'lite' ? 'lite' : 'full',
        );
        return {
          onFrame(dt, _elapsed, pointerX) {
            notebook.step(dt, pointerX);
          },
          needsFrame() {
            return notebook.needsFrame();
          },
          onTheme(next) {
            lights.sync(next);
            notebook.syncTheme(next);
          },
          onTier() {
            notebook.applyLite();
          },
          dispose() {
            lights.dispose();
            notebook.dispose();
          },
        };
      },
      { fov: 36, cameraZ: 6.4, orientation: 'rest' },
    );
  }, []);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
