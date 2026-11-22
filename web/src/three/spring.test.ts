import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { stepSpring } from './spring';

describe('stepSpring', () => {
  test('stepSpring(0, 0, 1, 2, 9, 0.86) se asienta en 2 s', () => {
    let position = 0;
    let velocity = 0;
    const frame = 1 / 60;
    const steps = Math.round(2 / frame);
    for (let i = 0; i < steps; i += 1) {
      [position, velocity] = stepSpring(position, velocity, 1, frame, 9, 0.86);
    }
    expect(Math.abs(position - 1)).toBeLessThan(0.02);
    expect(Math.abs(velocity)).toBeLessThan(0.05);
  });

  test('con ζ 0.62 y ω 7 pasa de largo y a los 3 s ya llegó', () => {
    let position = 0;
    let velocity = 0;
    let overshot = false;
    const frame = 1 / 60;
    const steps = Math.round(3 / frame);
    for (let i = 0; i < steps; i += 1) {
      [position, velocity] = stepSpring(position, velocity, 1, frame, 7, 0.62);
      if (position > 1) overshot = true;
    }
    expect(overshot).toBe(true);
    expect(Math.abs(position - 1)).toBeLessThan(0.02);
  });

  test('dt <= 0 devuelve la posición y la velocidad de entrada', () => {
    expect(stepSpring(0.4, -0.2, 1, 0, 9, 0.86)).toEqual([0.4, -0.2]);
    expect(stepSpring(0.4, -0.2, 1, -0.5, 9, 0.86)).toEqual([0.4, -0.2]);
  });

  test('dt = 0.2 no produce NaN', () => {
    const [position, velocity] = stepSpring(0.2, 0.1, 1, 0.2, 9, 0.86);
    expect(position).not.toBeNaN();
    expect(velocity).not.toBeNaN();
  });

  test('el fuente no importa three', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'spring.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"]three['"]/);
  });
});
