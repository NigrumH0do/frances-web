import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { mountThreeScene } from './createSceneHost';

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

    return mountThreeScene(el, ({ scene, camera, palette }) => {
      camera.position.set(0, 0, 4.1);

      const dir = new THREE.DirectionalLight(0xffffff, 1.5);
      dir.position.set(2.5, 3, 4);
      const hemi = new THREE.HemisphereLight(
        palette.accentSoft,
        palette.paper,
        0.95,
      );
      scene.add(dir, hemi);

      const medallion = new THREE.Group();
      scene.add(medallion);

      const bezelMat = new THREE.MeshStandardMaterial({
        color: palette.gold,
        metalness: 0.72,
        roughness: 0.26,
      });
      const dialMat = new THREE.MeshPhysicalMaterial({
        color: palette.paper,
        roughness: 0.35,
        metalness: 0.05,
        transparent: true,
        opacity: 0.94,
      });
      const northMat = new THREE.MeshStandardMaterial({
        color: palette.accent,
        metalness: 0.25,
        roughness: 0.35,
      });
      const southMat = new THREE.MeshStandardMaterial({
        color: palette.danger,
        metalness: 0.2,
        roughness: 0.4,
      });

      const bezel = new THREE.Mesh(
        new THREE.TorusGeometry(1.12, 0.09, 18, 64),
        bezelMat,
      );
      const dial = new THREE.Mesh(
        new THREE.CylinderGeometry(1.04, 1.04, 0.08, 48),
        dialMat,
      );
      dial.rotation.x = Math.PI / 2;

      const needleGroup = new THREE.Group();
      const northTip = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.72, 4),
        northMat,
      );
      northTip.position.y = 0.36;
      const southTip = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.72, 4),
        southMat,
      );
      southTip.rotation.z = Math.PI;
      southTip.position.y = -0.36;
      const pivot = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 16, 16),
        bezelMat,
      );
      needleGroup.position.z = 0.12;
      needleGroup.add(northTip, southTip, pivot);

      const innerRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.76, 0.018, 12, 48),
        northMat,
      );
      innerRing.position.z = 0.06;

      medallion.add(bezel, dial, innerRing, needleGroup);

      return {
        onThemeChange(next) {
          hemi.color.setHex(next.accentSoft);
          hemi.groundColor.setHex(next.paper);
          dialMat.color.setHex(next.paper);
          northMat.color.setHex(next.accent);
          southMat.color.setHex(next.danger);
          bezelMat.color.setHex(next.gold);
        },
        onFrame({ elapsed, pointerX, pointerY }) {
          const momentum = Math.min(streakRef.current, 21) / 21;
          medallion.rotation.y =
            pointerX * 0.32 + Math.sin(elapsed * 0.65) * 0.14;
          medallion.rotation.x =
            pointerY * 0.25 + Math.cos(elapsed * 0.55) * 0.08;
          needleGroup.rotation.z =
            Math.sin(elapsed * (1.2 + momentum * 1.4)) *
              (0.22 + momentum * 0.2) -
            0.35;
        },
      };
    });
  }, []);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
