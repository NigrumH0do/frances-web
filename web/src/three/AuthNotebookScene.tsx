import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { mountThreeScene } from './createSceneHost';

export default function AuthNotebookScene({
  className = 'three-host auth-three',
}: {
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;

    return mountThreeScene(el, ({ scene, camera, palette }) => {
      camera.position.set(0, 0.25, 6.2);

      const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
      keyLight.position.set(3, 4, 5);
      const hemi = new THREE.HemisphereLight(
        palette.accentSoft,
        palette.paper,
        0.95,
      );
      scene.add(keyLight, hemi);

      const rig = new THREE.Group();
      scene.add(rig);

      const folioMaterials: THREE.MeshPhysicalMaterial[] = [];
      const edgeMaterials: THREE.LineBasicMaterial[] = [];
      const folios: Array<{
        mesh: THREE.Group;
        baseY: number;
        phase: number;
        tilt: number;
      }> = [];

      const folioColors = [palette.paper, palette.accentSoft, palette.paper];
      const boxGeo = new THREE.BoxGeometry(1.55, 2.05, 0.045);
      const edgesGeo = new THREE.EdgesGeometry(boxGeo);

      for (let i = 0; i < 3; i++) {
        const card = new THREE.Group();
        const mat = new THREE.MeshPhysicalMaterial({
          color: folioColors[i],
          roughness: 0.35,
          metalness: 0.05,
          transparent: true,
          opacity: i === 0 ? 0.92 : 0.72,
        });
        folioMaterials.push(mat);
        const body = new THREE.Mesh(boxGeo, mat);
        const lineMat = new THREE.LineBasicMaterial({
          color: i === 1 ? palette.accent : palette.gold,
          transparent: true,
          opacity: 0.55,
        });
        edgeMaterials.push(lineMat);
        const wire = new THREE.LineSegments(edgesGeo, lineMat);
        card.add(body, wire);
        card.position.set((i - 1) * 0.68, (1 - i) * 0.16, -i * 0.42);
        card.rotation.set(0.18, -0.3 + i * 0.18, (i - 1) * 0.11);
        rig.add(card);
        folios.push({
          mesh: card,
          baseY: card.position.y,
          phase: i * 1.4,
          tilt: (i - 1) * 0.11,
        });
      }

      const ringGeo = new THREE.TorusGeometry(2.05, 0.022, 16, 72);
      const ringMat = new THREE.MeshStandardMaterial({
        color: palette.gold,
        metalness: 0.65,
        roughness: 0.25,
        transparent: true,
        opacity: 0.72,
      });
      const outerRing = new THREE.Mesh(ringGeo, ringMat);
      outerRing.rotation.set(1.1, 0.3, 0);
      rig.add(outerRing);

      const accentRingGeo = new THREE.TorusGeometry(1.45, 0.016, 12, 64);
      const accentRingMat = new THREE.MeshStandardMaterial({
        color: palette.accent,
        metalness: 0.35,
        roughness: 0.4,
        transparent: true,
        opacity: 0.52,
      });
      const innerRing = new THREE.Mesh(accentRingGeo, accentRingMat);
      innerRing.rotation.set(-0.85, 0.5, 0.2);
      rig.add(innerRing);

      return {
        onThemeChange(next) {
          hemi.color.setHex(next.accentSoft);
          hemi.groundColor.setHex(next.paper);
          folioMaterials[0]?.color.setHex(next.paper);
          folioMaterials[1]?.color.setHex(next.accentSoft);
          folioMaterials[2]?.color.setHex(next.paper);
          edgeMaterials[0]?.color.setHex(next.gold);
          edgeMaterials[1]?.color.setHex(next.accent);
          edgeMaterials[2]?.color.setHex(next.gold);
          ringMat.color.setHex(next.gold);
          accentRingMat.color.setHex(next.accent);
        },
        onFrame({ elapsed, pointerX, pointerY }) {
          rig.rotation.y = pointerX * 0.22 + Math.sin(elapsed * 0.35) * 0.08;
          rig.rotation.x = pointerY * 0.14 + Math.cos(elapsed * 0.28) * 0.04;
          for (const item of folios) {
            item.mesh.position.y =
              item.baseY + Math.sin(elapsed * 0.9 + item.phase) * 0.08;
            item.mesh.rotation.z =
              item.tilt + Math.sin(elapsed * 0.6 + item.phase) * 0.03;
          }
          outerRing.rotation.z = elapsed * 0.18;
          innerRing.rotation.z = -elapsed * 0.24;
        },
      };
    });
  }, []);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
