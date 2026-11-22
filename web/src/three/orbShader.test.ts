import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  ORB_FRAGMENT_SHADER,
  ORB_VERTEX_SHADER,
  orbColorToken,
} from './orbShader';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'orbShader.ts'),
  'utf8',
);

function snoiseCalls(shader: string): number {
  const withoutDefinition = shader.replace(/float\s+snoise\s*\(/, '');
  return withoutDefinition.match(/\bsnoise\s*\(/g)?.length ?? 0;
}

describe('orbShader', () => {
  test('el vértice capa a 0.12 después del ruido y no descarta', () => {
    expect(ORB_VERTEX_SHADER).toContain('min(0.12');
    expect(ORB_VERTEX_SHADER).toContain(
      'amp = min(0.12, amp * (0.7 + 0.3 * n));',
    );
    expect(snoiseCalls(ORB_VERTEX_SHADER)).toBe(1);
    expect(ORB_VERTEX_SHADER).not.toContain('discard');
    expect(ORB_FRAGMENT_SHADER).not.toContain('discard');
  });

  test('el fragmento cierra en gl_FragColor, tonemapping y colorspace', () => {
    const color = ORB_FRAGMENT_SHADER.indexOf('gl_FragColor');
    const tone = ORB_FRAGMENT_SHADER.indexOf('#include <tonemapping_fragment>');
    const space = ORB_FRAGMENT_SHADER.indexOf('#include <colorspace_fragment>');
    expect(color).toBeGreaterThanOrEqual(0);
    expect(tone).toBeGreaterThan(color);
    expect(space).toBeGreaterThan(tone);
    expect(ORB_FRAGMENT_SHADER).toContain('0.35 + 0.65 * uHigh');
  });

  test('el fuente no importa three ni three/addons', () => {
    expect(source).not.toMatch(/from\s+['"]three['"]/);
    expect(source).not.toMatch(/three\/addons/);
    expect(source).not.toMatch(/from\s+['"]three\//);
  });

  test('la cabecera cita a Ashima Arts y la licencia MIT', () => {
    const header = source.slice(0, source.indexOf('import '));
    expect(header).toMatch(/Ashima Arts/);
    expect(header).toMatch(/MIT/);
  });

  test('orbColorToken sigue scoreBand y el acento al grabar', () => {
    expect(orbColorToken({ score: 92 })).toBe('--c-score-excelente');
    expect(orbColorToken({ score: 85 })).toBe('--c-score-bien');
    expect(orbColorToken({ score: 76 })).toBe('--c-score-bien');
    expect(orbColorToken({ score: 60 })).toBe('--c-score-mejorable');
    expect(orbColorToken({ score: 59 })).toBe('--c-score-repetir');
    expect(orbColorToken({ active: true })).toBe('--c-accent');
    expect(orbColorToken({})).toBe('--c-accent');
    expect(orbColorToken({ active: true })).not.toBe('--c-danger');
    expect(orbColorToken({ active: true })).not.toBe('--c-record');
  });
});
