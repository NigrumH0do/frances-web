import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { mountThreeScene } from './createSceneHost';

export default function VoiceOrbScene({
  active = false,
  level = 0,
  score,
  className = 'three-host orb-three',
}: {
  active?: boolean;
  level?: number;
  score?: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef({ active, level, score });
  stateRef.current = { active, level, score };

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;

    return mountThreeScene(el, ({ scene, camera, palette }) => {
      camera.position.set(0, 0, 4.4);

      const dir = new THREE.DirectionalLight(0xffffff, 1.4);
      dir.position.set(2, 3, 4);
      const hemi = new THREE.HemisphereLight(
        palette.accentSoft,
        palette.paper,
        0.9,
      );
      scene.add(dir, hemi);

      const coreMat = new THREE.MeshPhysicalMaterial({
        color: palette.accent,
        roughness: 0.22,
        metalness: 0.18,
        flatShading: true,
        transparent: true,
        opacity: 0.9,
      });
      const wireMat = new THREE.MeshBasicMaterial({
        color: palette.gold,
        wireframe: true,
        transparent: true,
        opacity: 0.35,
      });
      const waveMat = new THREE.MeshStandardMaterial({
        color: palette.accent,
        metalness: 0.4,
        roughness: 0.35,
        transparent: true,
        opacity: 0.55,
      });

      const coreGeo = new THREE.IcosahedronGeometry(0.82, 1);
      const core = new THREE.Mesh(coreGeo, coreMat);
      const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.95, 1),
        wireMat,
      );
      const wave1 = new THREE.Mesh(
        new THREE.TorusGeometry(1.25, 0.02, 12, 64),
        waveMat,
      );
      const wave2 = new THREE.Mesh(
        new THREE.TorusGeometry(1.52, 0.015, 12, 64),
        waveMat,
      );
      wave1.rotation.x = 0.8;
      wave2.rotation.y = 0.95;

      const root = new THREE.Group();
      root.add(core, shell, wave1, wave2);
      scene.add(root);

      let smoothScale = 1;
      let currentPalette = palette;

      return {
        onThemeChange(next) {
          currentPalette = next;
          hemi.color.setHex(next.accentSoft);
          hemi.groundColor.setHex(next.paper);
          wireMat.color.setHex(next.gold);
        },
        onFrame({ elapsed, delta, pointerX, pointerY }) {
          const {
            active: isActive,
            level: micLevel,
            score: sc,
          } = stateRef.current;
          const targetHex =
            sc !== undefined
              ? sc >= 80
                ? currentPalette.ok
                : sc >= 60
                  ? currentPalette.gold
                  : currentPalette.danger
              : isActive
                ? currentPalette.danger
                : currentPalette.accent;
          coreMat.color.setHex(targetHex);
          waveMat.color.setHex(targetHex);

          const pulse = isActive
            ? 1.06 + Math.min(micLevel, 1) * 0.28 + Math.sin(elapsed * 8) * 0.05
            : 1 + Math.sin(elapsed * 2.1) * 0.04;
          smoothScale += (pulse - smoothScale) * Math.min(delta * 10, 1);

          core.scale.setScalar(smoothScale);
          shell.scale.setScalar(smoothScale * 1.12);
          root.rotation.y = pointerX * 0.25 + elapsed * (isActive ? 0.9 : 0.32);
          root.rotation.x = pointerY * 0.2 + elapsed * 0.16;
          wave1.rotation.z += delta * (isActive ? 1.4 : 0.4);
          wave2.rotation.z -= delta * (isActive ? 1.1 : 0.3);
        },
      };
    });
  }, []);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
