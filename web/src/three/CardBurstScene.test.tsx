import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Color,
  DynamicDrawUsage,
  Scene,
  ShaderMaterial,
  type PlaneGeometry,
} from 'three';
import { describe, expect, test } from 'vitest';
import { buildBurst } from './CardBurstScene';
import type { Palette } from './createSceneHost';

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

describe('CardBurstScene', () => {
  test('buildBurst crea un InstancedMesh de 80 con count 0 y un solo material', () => {
    const scene = new Scene();
    const rig = buildBurst(scene, palette());
    const material = rig.mesh.material;
    expect(Array.isArray(material)).toBe(false);
    const shader = material as ShaderMaterial;
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBe(rig.mesh);
    expect(rig.mesh.count).toBe(0);
    expect(rig.mesh.instanceMatrix.count).toBe(80);
    expect(rig.mesh.frustumCulled).toBe(false);
    expect(rig.mesh.instanceMatrix.usage).toBe(DynamicDrawUsage);
    expect(shader.transparent).toBe(true);
    expect(shader.depthWrite).toBe(false);

    const geometry = rig.mesh.geometry as PlaneGeometry;
    expect(geometry.parameters).toEqual({
      width: 1,
      height: 0.62,
      widthSegments: 1,
      heightSegments: 1,
    });
    expect(geometry.getAttribute('aAlpha').count).toBe(80);
    expect(geometry.getAttribute('aKind').count).toBe(80);

    expect(shader.fragmentShader).toContain(
      'smoothstep(0.5, 0.42, length(vUv - 0.5))',
    );
    expect(shader.fragmentShader).not.toContain('discard');
    expect(shader.fragmentShader).toContain('#include <tonemapping_fragment>');
    expect(shader.fragmentShader).toContain('#include <colorspace_fragment>');
    expect(shader.vertexShader).toContain('aAlpha');
    expect(shader.vertexShader).toContain('aKind');
    expect(shader.vertexShader).toContain('#ifdef USE_INSTANCING');
    expect(shader.vertexShader).toContain('instanceMatrix');

    const shaderSource = readFileSync(join(here, 'burstShader.ts'), 'utf8');
    const sceneSource = readFileSync(join(here, 'CardBurstScene.tsx'), 'utf8');
    expect(shaderSource).not.toMatch(/from ['"]three['"]/);
    expect(sceneSource).not.toContain('import * as THREE');
    expect(sceneSource).not.toContain('mountThreeScene');
    expect(sceneSource).toContain('mountSceneHost');
  });

  test('tras spawn y un frame el count sigue al pool y al morir el host puede dormir', () => {
    const rig = buildBurst(new Scene(), palette());
    rig.spawn('grade');
    rig.frame(1 / 60);
    expect(rig.pool.active).toBeGreaterThan(0);
    expect(rig.mesh.count).toBe(rig.pool.active);
    expect(rig.needsFrame()).toBe(true);

    for (let i = 0; i < 120 && rig.needsFrame(); i += 1) {
      rig.frame(1 / 60);
    }
    expect(rig.pool.active).toBe(0);
    expect(rig.needsFrame()).toBe(false);
    expect(rig.mesh.count).toBe(0);
  });

  test('uGold3d es el color de la paleta y no el hex de danger', () => {
    const colors = palette();
    const rig = buildBurst(new Scene(), colors);
    const material = rig.mesh.material as ShaderMaterial;
    const gold = material.uniforms.uGold3d.value as Color;
    expect(gold).toBe(colors.gold3d);
    expect(material.uniforms.uPaper.value).toBe(colors.paper);
    expect(material.uniforms.uInk.value).toBe(colors.ink);
    expect(gold.getHex()).toBe(0xd3ac41);
    expect(gold.getHex()).not.toBe(colors.danger.getHex());
    expect(gold.getHex()).not.toBe(0xa4283a);
    expect(gold.getHex()).not.toBe(0xf18790);
  });
});
