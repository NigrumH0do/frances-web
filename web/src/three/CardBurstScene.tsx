import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { mountThreeScene } from './createSceneHost';

export default function CardBurstScene({
  trigger = 0,
  className = 'three-host burst-three',
}: {
  trigger: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef({ count: trigger, clockStart: -10 });

  useEffect(() => {
    if (trigger > triggerRef.current.count) {
      triggerRef.current = {
        count: trigger,
        clockStart: performance.now() / 1000,
      };
    }
  }, [trigger]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;

    return mountThreeScene(el, ({ scene, camera, palette }) => {
      camera.position.set(0, 0, 4.8);

      const dir = new THREE.DirectionalLight(0xffffff, 1.3);
      dir.position.set(2, 3, 4);
      scene.add(dir, new THREE.AmbientLight(0xffffff, 0.7));

      const shardGeo = new THREE.OctahedronGeometry(0.11, 0);
      const count = 20;
      const shards: Array<{
        mesh: THREE.Mesh;
        mat: THREE.MeshStandardMaterial;
        vx: number;
        vy: number;
        vz: number;
      }> = [];

      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const speed = 1.6 + (i % 3) * 0.55;
        const mat = new THREE.MeshStandardMaterial({
          color: i % 2 === 0 ? palette.gold : palette.ok,
          metalness: 0.4,
          roughness: 0.3,
          transparent: true,
          opacity: 0,
        });
        const mesh = new THREE.Mesh(shardGeo, mat);
        scene.add(mesh);
        shards.push({
          mesh,
          mat,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed * 0.85,
          vz: ((i % 5) - 2) * 0.28,
        });
      }

      return {
        onThemeChange(next) {
          shards.forEach((shard, index) => {
            shard.mat.color.setHex(index % 2 === 0 ? next.gold : next.ok);
          });
        },
        onFrame() {
          const t = performance.now() / 1000 - triggerRef.current.clockStart;
          const active = t >= 0 && t <= 1.05;
          for (const shard of shards) {
            if (!active) {
              shard.mat.opacity = 0;
              shard.mesh.visible = false;
              continue;
            }
            const progress = t / 1.05;
            shard.mesh.visible = true;
            shard.mesh.position.set(
              shard.vx * progress * 1.45,
              shard.vy * progress * 1.45 - progress * progress * 0.4,
              shard.vz * progress,
            );
            shard.mesh.rotation.x = t * 4.5;
            shard.mesh.rotation.y = t * 3.8;
            shard.mat.opacity = Math.max(0, 1 - progress);
          }
        },
      };
    });
  }, []);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
