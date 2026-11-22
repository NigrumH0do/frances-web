// orbColorToken es puro: bandas de puntaje y acento al grabar, sin three.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { orbColorToken } from './orbShader';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'orbShader.ts'),
  'utf8',
);

describe('orbColorToken', () => {
  test('el módulo no importa three', () => {
    expect(source).not.toMatch(/from\s*['"]three['"]/);
    expect(source).not.toContain('import * as THREE');
    expect(source).not.toContain('three/addons');
    expect(source).not.toContain('three/examples');
  });

  test('92, 85, 76, 60 y 59 siguen la banda de puntaje', () => {
    expect(orbColorToken({ score: 92 })).toBe('--c-score-excelente');
    expect(orbColorToken({ score: 85 })).toBe('--c-score-bien');
    expect(orbColorToken({ score: 76 })).toBe('--c-score-bien');
    expect(orbColorToken({ score: 60 })).toBe('--c-score-mejorable');
    expect(orbColorToken({ score: 59 })).toBe('--c-score-repetir');
  });

  test('grabando, sin puntaje, devuelve el acento y nunca peligro ni grabar', () => {
    const recording = orbColorToken({ active: true });
    expect(recording).toBe('--c-accent');
    expect(recording).not.toBe('--c-danger');
    expect(recording).not.toBe('--c-record');
  });
});
