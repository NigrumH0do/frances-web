import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, test } from 'vitest';
import { evaluateDist } from './check-three-budget.mjs';

const NEEDLE = 'WebGLRenderer: Context Lost.';
const TARGET = 148480;
const HARD_CAP = 163840;
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeDist(
  files: Record<string, string | Buffer>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'three-budget-'));
  dirs.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const full = join(root, relative);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

function page(options?: { modulePreload?: string; entrySrc?: string }): string {
  const entrySrc = options?.entrySrc ?? '/assets/index-abc.js';
  const preload = options?.modulePreload
    ? `    <link rel="modulepreload" crossorigin href="${options.modulePreload}">\n`
    : '';
  return `<!doctype html>
<html>
  <head>
${preload}  </head>
  <body>
    <script type="module" src="${entrySrc}"></script>
  </body>
</html>
`;
}

const cleanEntry = 'console.log("boot");\n';

function successLine(file: string, gzip: number): string {
  return `three ${file} gzip=${gzip} B objetivo=${TARGET} tope=${HARD_CAP}\n`;
}

describe('check-three-budget', () => {
  test('pasa con three-abc.js pequeño y un entry sin WebGLRenderer', async () => {
    const source = `/* ${NEEDLE} */\nexport {};\n`;
    const gzip = gzipSync(Buffer.from(source), { level: 9 }).length;
    const root = await makeDist({
      'index.html': page(),
      'assets/index-abc.js': cleanEntry,
      'assets/three-abc.js': source,
    });

    const result = await evaluateDist(root, { strict: false });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(successLine('assets/three-abc.js', gzip));

    const strict = await evaluateDist(root, { strict: true });
    expect(strict.exitCode).toBe(0);
    expect(strict.stdout).toBe(successLine('assets/three-abc.js', gzip));
  });

  test('falla si no hay ningún chunk de three', async () => {
    const root = await makeDist({
      'index.html': page(),
      'assets/index-abc.js': cleanEntry,
    });
    const result = await evaluateDist(root);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/exactamente 1/);
    expect(result.stderr).toMatch(/\b0\b/);
  });

  test('falla si el chunk de three está duplicado', async () => {
    const root = await makeDist({
      'index.html': page(),
      'assets/index-abc.js': cleanEntry,
      'assets/three-abc.js': NEEDLE,
      'assets/three-def.js': NEEDLE,
    });
    const result = await evaluateDist(root);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/exactamente 1/);
    expect(result.stderr).toMatch(/\b2\b/);
  });

  test('falla si el archivo con la aguja no se llama three-*.js', async () => {
    const root = await makeDist({
      'index.html': page(),
      'assets/index-abc.js': cleanEntry,
      'assets/vendor-abc.js': NEEDLE,
    });
    const result = await evaluateDist(root);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/vendor-abc\.js/);
    expect(result.stderr).toMatch(/three-/);
  });

  test('falla si el gzip supera 160 KiB', async () => {
    const body = Buffer.concat([Buffer.from(NEEDLE), randomBytes(180_000)]);
    const gzip = gzipSync(body, { level: 9 }).length;
    expect(gzip).toBeGreaterThan(HARD_CAP);
    const root = await makeDist({
      'index.html': page(),
      'assets/index-abc.js': cleanEntry,
      'assets/three-big.js': body,
    });
    const result = await evaluateDist(root);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`gzip=${gzip} B`);
    expect(result.stderr).toContain(`tope=${HARD_CAP}`);
  });

  test('falla si index.html precarga three con modulepreload', async () => {
    const root = await makeDist({
      'index.html': page({ modulePreload: '/assets/three-abc.js' }),
      'assets/index-abc.js': cleanEntry,
      'assets/three-abc.js': NEEDLE,
    });
    const result = await evaluateDist(root);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/modulepreload/);
    expect(result.stderr).toMatch(/three-abc\.js/);
    expect(result.stderr).not.toMatch(/contiene WebGLRenderer/);
  });

  test('falla si el entry contiene WebGLRenderer', async () => {
    const root = await makeDist({
      'index.html': page(),
      'assets/index-abc.js': 'export const label = "WebGLRenderer";\n',
      'assets/three-abc.js': NEEDLE,
    });
    const result = await evaluateDist(root);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/index-abc\.js/);
    expect(result.stderr).toMatch(/WebGLRenderer/);
  });

  test('falla si index.html contiene WebGLRenderer', async () => {
    const html = page().replace('<head>', '<head><!-- WebGLRenderer -->');
    const root = await makeDist({
      'index.html': html,
      'assets/index-abc.js': cleanEntry,
      'assets/three-abc.js': NEEDLE,
    });
    const result = await evaluateDist(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/index\.html/);
    expect(result.stderr).toMatch(/WebGLRenderer/);
  });

  test('entre 145 y 160 KiB avisa y, con strict, falla', async () => {
    let size = 155_000;
    let body = Buffer.alloc(0);
    let gzip = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      body = Buffer.concat([Buffer.from(`${NEEDLE}\n`), randomBytes(size)]);
      gzip = gzipSync(body, { level: 9 }).length;
      if (gzip > TARGET && gzip <= HARD_CAP) break;
      size = Math.max(1, Math.round((size * (TARGET + 8_000)) / gzip));
    }
    expect(gzip).toBeGreaterThan(TARGET);
    expect(gzip).toBeLessThanOrEqual(HARD_CAP);

    const root = await makeDist({
      'index.html': page(),
      'assets/index-abc.js': cleanEntry,
      'assets/three-abc.js': body,
    });

    const loose = await evaluateDist(root, { strict: false });
    expect(loose.exitCode).toBe(0);
    expect(loose.stdout).toBe(successLine('assets/three-abc.js', gzip));
    expect(loose.stderr).toMatch(/warning/i);
    expect(loose.stderr).toContain(String(TARGET));

    const strict = await evaluateDist(root, { strict: true });
    expect(strict.exitCode).toBe(1);
    expect(strict.stdout).toBe('');
    expect(strict.stderr).toContain(String(TARGET));
    expect(strict.stderr).toContain(`gzip=${gzip} B`);
  });

  test('sale 2 si el directorio no se puede leer', async () => {
    const missing = join(tmpdir(), 'three-budget-missing-dir');
    const result = await evaluateDist(missing);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/No se pudo leer/);
  });
});
