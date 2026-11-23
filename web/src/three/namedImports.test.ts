// Contratos de frontera: three entra por imports con nombre, nunca por
// namespace, addons o el montaje viejo de una escena.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const threeDir = dirname(fileURLToPath(import.meta.url));

const PURE = [
  'tier.ts',
  'spring.ts',
  'sceneGate.ts',
  'burstPhysics.ts',
  'orbShader.ts',
  'burstShader.ts',
  'compassDial.ts',
] as const;

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(path));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
      found.push(path);
    }
  }
  return found;
}

describe('imports con nombre de three', () => {
  test('ningún módulo usa import * as THREE, three/addons ni three/examples', () => {
    const files = sources(threeDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const rel = file.slice(threeDir.length + 1);
      expect(source, rel).not.toContain('import * as THREE');
      expect(source, rel).not.toContain('three/addons');
      expect(source, rel).not.toContain('three/examples');
    }
  });

  test('los módulos puros no importan three', () => {
    for (const name of PURE) {
      const source = readFileSync(join(threeDir, name), 'utf8');
      expect(source, name).not.toMatch(/from\s*['"]three['"]/);
    }
  });

  test('ninguna *Scene.tsx llama a mountThreeScene', () => {
    const scenes = sources(threeDir).filter((file) =>
      file.endsWith('Scene.tsx'),
    );
    expect(scenes.length).toBeGreaterThan(0);
    for (const file of scenes) {
      const source = readFileSync(file, 'utf8');
      expect(source, file.slice(threeDir.length + 1)).not.toContain(
        'mountThreeScene',
      );
    }
  });
});
