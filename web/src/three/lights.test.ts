import { Color, Scene, type DirectionalLight, type Light } from 'three';
import { expect, test } from 'vitest';
import type { Palette } from './createSceneHost';
import { addStudioLights } from './lights';

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

test('añade hemisferio 0.45, clave cálida 2.2 y ninguna sombra', () => {
  const scene = new Scene();
  addStudioLights(scene, palette());

  expect(scene.children).toHaveLength(3);
  const lights = scene.children.filter(
    (child): child is Light => (child as Light).isLight === true,
  );
  expect(lights).toHaveLength(3);

  const hemisphere = lights.find(
    (light) => (light as { isHemisphereLight?: boolean }).isHemisphereLight,
  );
  expect(hemisphere?.intensity).toBe(0.45);

  const key = lights.find(
    (light): light is DirectionalLight =>
      (light as DirectionalLight).isDirectionalLight === true &&
      light.intensity === 2.2,
  );
  expect(key?.color.getHex()).toBe(0xfff6ea);
  for (const light of lights) {
    expect(light.castShadow).toBe(false);
  }
});
