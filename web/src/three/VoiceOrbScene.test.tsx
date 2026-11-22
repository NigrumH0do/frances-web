import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Color,
  IcosahedronGeometry,
  Mesh,
  Scene,
  ShaderMaterial,
  TorusGeometry,
} from 'three';
import { describe, expect, test, vi } from 'vitest';
import type { Palette } from './createSceneHost';
import { buildOrb, orbColors, orbDetail, type OrbDrive } from './VoiceOrbScene';

const sceneFile = join(
  dirname(fileURLToPath(import.meta.url)),
  'VoiceOrbScene.tsx',
);

function palette(): Palette {
  const color = (hex: number) => new Color(hex);
  return {
    revision: 1,
    isDark: false,
    accent: color(0x111111),
    accentSoft: color(0x222222),
    paper: color(0xeeeeee),
    ink: color(0x010101),
    ok: color(0x00aa00),
    danger: color(0xff0000),
    gold3d: color(0xd3ac41),
    scoreExcelente: color(0x006150),
    scoreBien: color(0x2147a3),
    scoreMejorable: color(0x7c4607),
    scoreRepetir: color(0xa4283a),
  };
}

function drive(patch: Partial<OrbDrive> = {}): OrbDrive {
  return {
    active: false,
    read: () => ({ rms: 0, low: 0, mid: 0, high: 0, source: 'live' }),
    ...patch,
  };
}

describe('VoiceOrbScene', () => {
  test('los puntajes siguen scoreBand, no el corte viejo 80/60', () => {
    const colors = palette();
    const cases: Array<[number, Color]> = [
      [90, colors.scoreExcelente],
      [89.9, colors.scoreBien],
      [75, colors.scoreBien],
      [74.9, colors.scoreMejorable],
      [60, colors.scoreMejorable],
      [59.9, colors.scoreRepetir],
      [85, colors.scoreBien],
      [76, colors.scoreBien],
    ];
    for (const [score, body] of cases) {
      const pair = orbColors(colors, { score });
      expect(pair.body.getHex()).toBe(body.getHex());
      expect(pair.rim.getHex()).toBe(colors.paper.getHex());
    }
    expect(orbColors(colors, { score: 85 }).body.getHex()).not.toBe(
      colors.ok.getHex(),
    );
    expect(orbColors(colors, { score: 76 }).body.getHex()).not.toBe(
      colors.gold3d.getHex(),
    );
  });

  test('grabar sin puntaje usa accent y nunca danger', () => {
    const colors = palette();
    const recording = orbColors(colors, { active: true });
    const rim = colors.accent.clone().lerp(colors.paper, 0.35);
    expect(recording.body.getHex()).toBe(colors.accent.getHex());
    expect(recording.body.getHex()).not.toBe(colors.danger.getHex());
    expect(recording.rim.r).toBeCloseTo(rim.r, 5);
    expect(recording.rim.g).toBeCloseTo(rim.g, 5);
    expect(recording.rim.b).toBeCloseTo(rim.b, 5);
    expect(recording.rim.getHex()).not.toBe(colors.danger.getHex());

    const rest = orbColors(colors, {});
    expect(rest.body.getHex()).toBe(colors.accent.getHex());
    expect(rest.rim.getHex()).toBe(colors.paper.getHex());
  });

  test('un solo icosaedro, detail 4 en full y 3 en lite, sin malla de demo', () => {
    expect(orbDetail('full')).toBe(4);
    expect(orbDetail('lite')).toBe(3);

    const scene = new Scene();
    const orb = buildOrb(scene, palette(), 'full', drive());
    const meshes = scene.children.filter(
      (child): child is Mesh => (child as Mesh).isMesh === true,
    );
    expect(meshes).toHaveLength(1);
    expect(orb.mesh.geometry).toBeInstanceOf(IcosahedronGeometry);
    expect((orb.mesh.geometry as IcosahedronGeometry).parameters.detail).toBe(
      4,
    );
    expect(orb.mesh.geometry).not.toBeInstanceOf(TorusGeometry);
    const material = orb.mesh.material as ShaderMaterial;
    expect(material.wireframe).toBe(false);

    const previous = orb.mesh.geometry;
    const dispose = vi.spyOn(previous, 'dispose');
    orb.onTier('lite');
    expect((orb.mesh.geometry as IcosahedronGeometry).parameters.detail).toBe(
      3,
    );
    expect(dispose).toHaveBeenCalledTimes(1);
    orb.onTier('lite');
    expect(dispose).toHaveBeenCalledTimes(1);

    const liteScene = new Scene();
    const lite = buildOrb(liteScene, palette(), 'lite', drive());
    expect((lite.mesh.geometry as IcosahedronGeometry).parameters.detail).toBe(
      3,
    );
    const liteDispose = vi.spyOn(lite.mesh.geometry, 'dispose');
    lite.onTier('lite');
    expect(lite.mesh.geometry).toBeInstanceOf(IcosahedronGeometry);
    expect(liteDispose).not.toHaveBeenCalled();

    const source = readFileSync(sceneFile, 'utf8');
    expect(source).not.toMatch(/import \* as /);
    expect(source).not.toContain('mountThreeScene');
    expect(source).not.toContain('TorusGeometry');
    expect(source).not.toContain('wireframe');
    expect(source).not.toContain('setState');
    expect(source).toContain('mountSceneHost');
  });

  test('el material nace opaco y escribe profundidad', () => {
    const orb = buildOrb(new Scene(), palette(), 'full', drive());
    const material = orb.material;
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.toneMapped).toBe(true);
    expect(material.precision).toBe('mediump');
  });

  test('el EMA de speaking no llega a 1 en el primer frame', () => {
    const orb = buildOrb(
      new Scene(),
      palette(),
      'full',
      drive({
        active: true,
        read: () => ({
          rms: 0.5,
          low: 0,
          mid: 0.2,
          high: 0.1,
          source: 'live',
        }),
      }),
    );
    const frame = 1 / 60;
    orb.onFrame(frame, frame, 0, 0);
    const first = orb.material.uniforms.uSpeaking!.value as number;
    expect(first).toBeLessThan(0.3);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1);
    for (let i = 0; i < 59; i += 1) {
      orb.onFrame(frame, frame * (i + 2), 0, 0);
    }
    const afterSecond = orb.material.uniforms.uSpeaking!.value as number;
    expect(afterSecond).toBeGreaterThan(0.9);
    expect(afterSecond).toBeLessThan(1);
  });

  test('un medidor mudo con active lleva uAudio a 0.12', () => {
    const orb = buildOrb(
      new Scene(),
      palette(),
      'full',
      drive({
        active: true,
        read: () => ({
          rms: 0,
          low: 0,
          mid: 0.4,
          high: 0.25,
          source: 'silent',
        }),
      }),
    );
    orb.onFrame(1 / 60, 1 / 60, 0, 0);
    const audio = orb.material.uniforms.uAudio!.value as number;
    expect(audio).toBeCloseTo(0.12, 5);
    expect(audio).not.toBe(0);
    expect(orb.material.uniforms.uMid!.value).toBeCloseTo(0.4, 5);
    expect(orb.material.uniforms.uHigh!.value).toBeCloseTo(0.25, 5);
  });

  test('needsFrame es falso en reposo con sample en cero', () => {
    const input = drive({
      active: false,
      read: () => ({ rms: 0, low: 0, mid: 0, high: 0, source: 'silent' }),
    });
    const orb = buildOrb(new Scene(), palette(), 'full', input);
    orb.onFrame(1 / 60, 1 / 60, 0, 0);
    expect(input.active).toBe(false);
    expect(orb.material.uniforms.uAudio!.value as number).toBeLessThanOrEqual(
      0.01,
    );
    expect(
      orb.material.uniforms.uSpeaking!.value as number,
    ).toBeLessThanOrEqual(0.01);
    expect(orb.needsFrame()).toBe(false);
  });
});
