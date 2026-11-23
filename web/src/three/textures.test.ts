import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Color, SRGBColorSpace } from 'three';
import { describe, expect, test } from 'vitest';
import {
  createNotebookTextures,
  paintGrainPixels,
  paintSeyesPixels,
  paintStitchPixels,
} from './textures';

const here = dirname(fileURLToPath(import.meta.url));

function lum(
  data: Uint8ClampedArray,
  size: number,
  x: number,
  y: number,
): number {
  const i = (y * size + x) * 4;
  return data[i] + data[i + 1] + data[i + 2];
}

function lightRuns(data: Uint8ClampedArray, size: number): number {
  const x = Math.floor(size / 2);
  let runs = 0;
  let wasLight = false;
  for (let y = 0; y < size; y += 1) {
    const light = lum(data, size, x, y) >= 600;
    if (light && !wasLight) runs += 1;
    wasLight = light;
  }
  return runs;
}

describe('texturas del cuaderno', () => {
  test('Seyès: y=8 más oscura que y=4, y=32 más oscura que y=8, margen R>G', () => {
    const size = 128;
    const data = paintSeyesPixels(size);
    const x = Math.floor(size / 2);

    expect(data).toBeInstanceOf(Uint8ClampedArray);
    expect(data.length).toBe(size * size * 4);
    expect(lum(data, size, x, 8)).toBeLessThan(lum(data, size, x, 4));
    expect(lum(data, size, x, 32)).toBeLessThan(lum(data, size, x, 8));

    const margin = size * 0.08;
    for (const y of [0, 4, 8, 32, 100]) {
      for (let column = 0; column < margin; column += 1) {
        const i = (y * size + column) * 4;
        expect(data[i]).toBeGreaterThan(data[i + 1]);
      }
    }
  });

  test('el grano se queda a ±6 niveles del papel en todos los píxeles', () => {
    const paper: [number, number, number] = [128, 100, 80];
    const size = 64;
    const data = paintGrainPixels(size, paper);
    expect(data.length).toBe(size * size * 4);

    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = data[i + channel];
        expect(Math.abs(value - paper[channel])).toBeLessThanOrEqual(6);
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    expect(max - min).toBeGreaterThan(0);
  });

  test('la costura tiene seis tramos y lite mide 128', () => {
    const stitch = paintStitchPixels(128);
    expect(stitch.length).toBe(128 * 128 * 4);
    expect(lightRuns(stitch, 128)).toBe(6);

    const paper = new Color(0xfefcf8);
    const lite = createNotebookTextures('lite', paper);
    expect(lite.grain.image.width).toBe(128);
    expect(lite.seyes.image.width).toBe(128);
    expect(lite.stitch.image.width).toBe(128);

    const full = createNotebookTextures('full', paper);
    expect(full.grain.image.width).toBe(256);
    expect(full.seyes.image.width).toBe(256);
    expect(full.stitch.image.width).toBe(128);
  });

  test('las tres texturas usan SRGBColorSpace, mipmaps y anisotropía 1', () => {
    const paper = new Color(0xfefcf8);
    const textures = createNotebookTextures('full', paper);
    for (const texture of [textures.stitch, textures.grain, textures.seyes]) {
      expect(texture.colorSpace).toBe(SRGBColorSpace);
      expect(texture.generateMipmaps).toBe(true);
      expect(texture.anisotropy).toBe(1);
    }

    const source = readFileSync(join(here, 'textures.ts'), 'utf8');
    expect(source).not.toContain('import * as THREE');
    expect(source).not.toContain('three/addons');
    expect(source).not.toContain('three/examples');
  });
});
