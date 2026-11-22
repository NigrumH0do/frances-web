import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const DIRECTORIES = [
  'screens/quiz',
  'screens/chat',
  'screens/publicacion',
  'screens/temas',
  'screens/mas',
  'admin',
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || entry.includes('.test.')) continue;
    found.push(full);
  }
  return found;
}

test('quiz, chat, publicación, temas, más y admin no importan LazyScenes ni three', () => {
  for (const relative of DIRECTORIES) {
    const files = sourceFiles(join(srcRoot, relative));
    expect(files.length, relative).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text.includes('LazyScenes'), file).toBe(false);
      expect(text.includes("from 'three'"), file).toBe(false);
      expect(text.includes('from "three"'), file).toBe(false);
    }
  }
});
