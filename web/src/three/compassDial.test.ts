import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { paintCompassDialPixels } from './compassDial';

const SIZE = 256;

/** 0° es el norte (arriba). El ángulo crece en sentido horario. */
function isInk(data: Uint8ClampedArray, x: number, y: number): boolean {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= SIZE || iy >= SIZE) return false;
  const offset = (iy * SIZE + ix) * 4;
  return data[offset + 3] > 200 && data[offset] < 80 && data[offset + 1] < 80;
}

function nearRay(
  data: Uint8ClampedArray,
  deg: number,
  radius: number,
): boolean {
  const rad = (deg * Math.PI) / 180;
  const x = SIZE / 2 + Math.sin(rad) * radius;
  const y = SIZE / 2 - Math.cos(rad) * radius;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (isInk(data, x + dx, y + dy)) return true;
    }
  }
  return false;
}

function tickSpan(data: Uint8ClampedArray, deg: number): number {
  let min = Infinity;
  let max = -1;
  for (let radius = SIZE * 0.3; radius < SIZE * 0.5; radius += 0.5) {
    if (!nearRay(data, deg, radius)) continue;
    min = Math.min(min, radius);
    max = Math.max(max, radius);
  }
  if (max < 0) return 0;
  return max - min;
}

function tickMinRadius(data: Uint8ClampedArray, deg: number): number {
  for (let radius = SIZE * 0.3; radius < SIZE * 0.5; radius += 0.5) {
    if (nearRay(data, deg, radius)) return radius;
  }
  return Infinity;
}

function northInterior(data: Uint8ClampedArray): {
  count: number;
  width: number;
  maxY: number;
  maxRadius: number;
} {
  let count = 0;
  let minX = Infinity;
  let maxX = -1;
  let maxY = -1;
  let maxRadius = 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (!isInk(data, x, y)) continue;
      const dx = x - SIZE / 2;
      const dy = y - SIZE / 2;
      const radius = Math.hypot(dx, dy);
      if (radius >= SIZE * 0.3 || y >= SIZE / 2) continue;
      count += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxRadius = Math.max(maxRadius, radius);
    }
  }
  return {
    count,
    width: count === 0 ? 0 : maxX - minX,
    maxY,
    maxRadius,
  };
}

describe('paintCompassDialPixels', () => {
  test('marca 0° y 10°, el norte sin glifo es el más largo y el interior queda vacío', () => {
    const pixels = paintCompassDialPixels(SIZE, false);
    const north = tickSpan(pixels, 0);
    const ten = tickSpan(pixels, 10);
    const strong = tickSpan(pixels, 30);

    expect(ten).toBeGreaterThan(4);
    expect(strong).toBeGreaterThan(ten);
    expect(north).toBeGreaterThan(strong);
    expect(northInterior(pixels).count).toBe(0);
  });

  test('withLetter pinta un bloque de tinta en el cuadrante norte, distinto del tick', () => {
    const pixels = paintCompassDialPixels(SIZE, true);
    const block = northInterior(pixels);

    expect(block.count).toBeGreaterThan(40);
    expect(block.width).toBeGreaterThanOrEqual(8);
    expect(block.maxY).toBeLessThan(SIZE / 2);
    expect(block.maxRadius).toBeLessThan(tickMinRadius(pixels, 0));
    expect(tickSpan(pixels, 0)).toBeGreaterThan(4);
    expect(tickSpan(pixels, 0)).toBeLessThan(
      tickSpan(paintCompassDialPixels(SIZE, false), 0),
    );
  });

  test('el fuente no importa three', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'compassDial.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"]three['"]/);
  });
});
