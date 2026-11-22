import { useEffect, useRef } from 'react';
import {
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  type Scene,
} from 'three';
import {
  createPool,
  createRng,
  spawnBurst,
  stepBurst,
  type BurstPool,
  type BurstRequest,
  type BurstVariant,
} from './burstPhysics';
import { burstFragmentShader, burstVertexShader } from './burstShader';
import { mountSceneHost, type Palette } from './createSceneHost';
import { getRuntimeTier } from './tier';

const CAPACITY = 80;
const LITE_LIMIT = 36;

export interface CardBurstSceneProps {
  request?: BurstRequest | null;
  trigger?: number; // compatibilidad temporal G4–G5
}

export interface BurstRig {
  mesh: InstancedMesh;
  pool: BurstPool;
  needsFrame: () => boolean;
  spawn: (variant: BurstVariant, limit?: number) => void;
  frame: (dt: number) => void;
  sync: (palette: Palette) => void;
  dispose: () => void;
}

export function buildBurst(scene: Scene, palette: Palette): BurstRig {
  const pool = createPool(CAPACITY);
  const geometry = new PlaneGeometry(1, 0.62, 1, 1);
  const alpha = new Float32Array(CAPACITY);
  const kinds = new Float32Array(CAPACITY);
  const alphaAttr = new InstancedBufferAttribute(alpha, 1);
  const kindAttr = new InstancedBufferAttribute(kinds, 1);
  geometry.setAttribute('aAlpha', alphaAttr);
  geometry.setAttribute('aKind', kindAttr);

  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uPaper: { value: palette.paper },
      uGold3d: { value: palette.gold3d },
      uInk: { value: palette.ink },
    },
    vertexShader: burstVertexShader,
    fragmentShader: burstFragmentShader,
  });

  const mesh = new InstancedMesh(geometry, material, CAPACITY);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  scene.add(mesh);

  const dummy = new Object3D();
  const euler = new Euler();
  const quaternion = new Quaternion();

  const write = (): void => {
    const active = pool.active;
    mesh.count = active;
    if (active === 0) return;
    for (let i = 0; i < active; i += 1) {
      const shard = pool.items[i];
      dummy.position.set(shard.px, shard.py, shard.pz);
      euler.set(shard.rx, shard.ry, shard.rz);
      quaternion.setFromEuler(euler);
      dummy.quaternion.copy(quaternion);
      dummy.scale.set(shard.scale, shard.scale, shard.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      alpha[i] = Math.min(1, shard.life / 0.35);
      kinds[i] = shard.kind;
    }
    mesh.instanceMatrix.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    kindAttr.needsUpdate = true;
  };

  return {
    mesh,
    pool,
    needsFrame: () => pool.active > 0,
    spawn(variant, limit) {
      const seed = (Math.random() * 0x100000000) >>> 0;
      spawnBurst(pool, variant, createRng(seed), limit);
      write();
    },
    frame(dt) {
      stepBurst(pool, dt);
      write();
    },
    sync(next) {
      material.uniforms.uPaper.value = next.paper;
      material.uniforms.uGold3d.value = next.gold3d;
      material.uniforms.uInk.value = next.ink;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}

// El host duerme cuando needsFrame es falso y no exporta wake(). Un
// pointermove de ratón dentro del slot es el reanudador público.
function wakeHost(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  let restore: (() => void) | null = null;
  if (rect.width <= 0 || rect.height <= 0) {
    const width = el.style.width;
    const height = el.style.height;
    el.style.width = '8px';
    el.style.height = '8px';
    restore = () => {
      el.style.width = width;
      el.style.height = height;
    };
  }
  const box = el.getBoundingClientRect();
  window.dispatchEvent(
    new PointerEvent('pointermove', {
      pointerType: 'mouse',
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }),
  );
  restore?.();
}

export default function CardBurstScene({
  request = null,
  trigger = 0,
  className = 'three-host burst-three',
}: CardBurstSceneProps & { className?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(request);
  const triggerRef = useRef(trigger);
  const pollRef = useRef<() => boolean>(() => false);
  requestRef.current = request;
  triggerRef.current = trigger;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    if (el.getAttribute('data-burst-fires') === null) {
      el.setAttribute('data-burst-fires', '0');
    }

    const tier = getRuntimeTier();
    let limit: number | undefined = tier === 'lite' ? LITE_LIMIT : undefined;
    let seenId: number | null = null;
    let seenTrigger = 0;
    let rig: BurstRig | null = null;

    const poll = (): boolean => {
      if (rig === null) return false;
      const req = requestRef.current;
      const trig = triggerRef.current;
      const idNew = req !== null && req.id !== seenId;
      const trigNew = trig > 0 && trig !== seenTrigger;
      if (!idNew && !trigNew) return false;
      const variant: BurstVariant =
        idNew && req !== null ? req.variant : 'grade';
      if (req !== null) seenId = req.id;
      if (trig > 0) seenTrigger = trig;
      const fires = Number(el.getAttribute('data-burst-fires') ?? '0') + 1;
      el.setAttribute('data-burst-fires', String(fires));
      rig.spawn(variant, limit);
      return true;
    };
    pollRef.current = poll;

    const stop = mountSceneHost(
      el,
      tier,
      (scene, camera, palette) => {
        camera.position.set(0, 0, 4.8);
        rig = buildBurst(scene, palette);
        poll();
        return {
          needsFrame: () => rig?.needsFrame() ?? false,
          onFrame: (dt) => {
            poll();
            rig?.frame(dt);
          },
          onTheme: (next) => {
            rig?.sync(next);
          },
          onTier: () => {
            limit = LITE_LIMIT;
          },
          dispose: () => {
            rig?.dispose();
            rig = null;
          },
        };
      },
      { cameraZ: 4.8 },
    );

    return () => {
      pollRef.current = () => false;
      stop();
    };
  }, []);

  useEffect(() => {
    const fired = pollRef.current();
    const el = hostRef.current;
    if (fired && el) wakeHost(el);
  }, [request, trigger]);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
