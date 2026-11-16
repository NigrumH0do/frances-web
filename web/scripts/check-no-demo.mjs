#!/usr/bin/env node
// Guardián P09-6: el build real no puede contener el modo demo.
// Uso: node web/scripts/check-no-demo.mjs web/dist
//
// El demo se construye con `vite build --mode demo`; en el build real la
// condición `import.meta.env.MODE === 'demo'` es constante y Rollup elimina
// la rama y el chunk de `web/src/demo/`.

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const NEEDLES = ['demo-api', 'createDemoTransport', 'quiz_keys'];
// El service worker generado incluye la regla de caché de `/demo-api/` como
// configuración de rutas (UI-21/CHG-15), no como código del demo. Los demás
// needles (`createDemoTransport`, `quiz_keys`) sí se comprueban también ahí.
const GENERATED_SW = /^(?:sw\.js|workbox-.*\.js)$/;
const root = resolve(process.argv[2] ?? 'dist');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

let files;
try {
  files = await walk(root);
} catch (error) {
  console.error(`No se pudo leer ${root}: ${String(error)}`);
  process.exit(2);
}

const offenders = [];
for (const file of files) {
  const name = file.split('/').pop() ?? '';
  const content = await readFile(file, 'utf8');
  for (const needle of NEEDLES) {
    if (needle === 'demo-api' && GENERATED_SW.test(name)) {
      continue;
    }
    if (content.includes(needle)) {
      offenders.push({ file, needle });
      break;
    }
  }
}

if (offenders.length > 0) {
  console.error('El build real contiene código del modo demo:');
  for (const { file, needle } of offenders) {
    console.error(`  ${file}: ${needle}`);
  }
  process.exit(1);
}

console.log(`Sin código demo en ${files.length} archivos de ${root}.`);
