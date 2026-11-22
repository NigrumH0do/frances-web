import { DirectionalLight, HemisphereLight, type Scene } from 'three';
import type { Palette } from './createSceneHost';

export interface StudioLights {
  sync(palette: Palette): void;
  dispose(): void;
}

export function addStudioLights(scene: Scene, palette: Palette): StudioLights {
  const hemisphere = new HemisphereLight(palette.accentSoft, palette.ink, 0.45);
  const key = new DirectionalLight(0xfff6ea, 2.2);
  key.position.set(-4, 6, 3);
  const rim = new DirectionalLight(palette.accent, 0.55);
  rim.position.set(4, 2.5, -3);
  hemisphere.castShadow = false;
  key.castShadow = false;
  rim.castShadow = false;
  scene.add(hemisphere, key, rim);

  return {
    sync(next) {
      hemisphere.color.copy(next.accentSoft);
      hemisphere.groundColor.copy(next.ink);
      rim.color.copy(next.accent);
    },
    dispose() {
      scene.remove(hemisphere, key, rim);
      hemisphere.dispose();
      key.dispose();
      rim.dispose();
    },
  };
}
