#!/usr/bin/env node
// Compuerta QA-01: el build real aísla three en un chunk asíncrono
// `three-<hash>.js` y su gzip (zlib nivel 9) no pasa de 160 KiB.
// Uso: node web/scripts/check-three-budget.mjs web/dist
// THREE_BUDGET_STRICT=1 también falla entre el objetivo (145 KiB) y el tope.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const NEEDLE = 'WebGLRenderer: Context Lost.';
const ENTRY_NEEDLE = 'WebGLRenderer';
const TARGET = 148480;
const HARD_CAP = 163840;
const NAME_RE = /^three-[A-Za-z0-9_-]+\.js$/;

/**
 * @param {string} root
 * @param {{ strict?: boolean }} [options]
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
export async function evaluateDist(root, options = {}) {
  const absRoot = path.resolve(root);
  const strict =
    typeof options.strict === 'boolean'
      ? options.strict
      : process.env.THREE_BUDGET_STRICT === '1';

  let jsFiles;
  try {
    jsFiles = await collectJs(absRoot);
  } catch (error) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `No se pudo leer ${absRoot}: ${errorMessage(error)}\n`,
    };
  }

  try {
    return await inspect(absRoot, jsFiles, strict);
  } catch (error) {
    const code = errorCode(error);
    if (
      code === 'ENOENT' ||
      code === 'ENOTDIR' ||
      code === 'EACCES' ||
      code === 'EPERM'
    ) {
      return {
        exitCode: 2,
        stdout: '',
        stderr: `No se pudo leer ${absRoot}: ${errorMessage(error)}\n`,
      };
    }
    throw error;
  }
}

/**
 * @param {string} absRoot
 * @param {string[]} jsFiles
 * @param {boolean} strict
 */
async function inspect(absRoot, jsFiles, strict) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  let success = '';

  /** @type {{ file: string, rel: string, buf: Buffer }[]} */
  const chunks = [];
  for (const file of jsFiles) {
    const buf = await readFile(file);
    if (buf.includes(NEEDLE)) {
      chunks.push({
        file,
        buf,
        rel: toPosix(path.relative(absRoot, file)),
      });
    }
  }
  chunks.sort((a, b) => a.rel.localeCompare(b.rel));

  const htmlPath = path.join(absRoot, 'index.html');
  let html = '';
  try {
    html = await readFile(htmlPath, 'utf8');
  } catch (error) {
    errors.push(`No se pudo leer index.html: ${errorMessage(error)}`);
  }

  if (chunks.length !== 1) {
    const listed = chunks.map((chunk) => chunk.rel).join(', ');
    const suffix = listed ? `: ${listed}` : '';
    errors.push(
      `Se esperaba exactamente 1 chunk de three y hay ${chunks.length}${suffix}.`,
    );
  } else {
    const chunk = chunks[0];
    const base = path.basename(chunk.file);
    if (!NAME_RE.test(base)) {
      errors.push(
        `El chunk ${chunk.rel} contiene three pero su nombre no coincide con three-<hash>.js.`,
      );
    }

    const size = gzipSync(chunk.buf, { level: 9 }).length;
    if (size > HARD_CAP) {
      errors.push(
        `three ${chunk.rel} gzip=${size} B supera el tope=${HARD_CAP}.`,
      );
    } else if (size > TARGET) {
      warnings.push(
        `warning: three ${chunk.rel} gzip=${size} B supera el objetivo ${TARGET} (tope=${HARD_CAP}).`,
      );
    }

    if (html) {
      for (const tag of tags(html, 'link')) {
        if (!relIncludes(tag, 'modulepreload')) continue;
        const href = attr(tag, 'href');
        if (!href || !hrefPointsAt(href, chunk.file, absRoot, htmlPath)) {
          continue;
        }
        errors.push(
          `index.html precarga ${base} con modulepreload (href=${href}).`,
        );
      }
    }

    success = `three ${chunk.rel} gzip=${size} B objetivo=${TARGET} tope=${HARD_CAP}\n`;
  }

  if (html.includes(ENTRY_NEEDLE)) {
    errors.push(`index.html contiene ${ENTRY_NEEDLE}.`);
  }

  if (html) {
    const seen = new Set();
    for (const tag of tags(html, 'script')) {
      if ((attr(tag, 'type') ?? '').toLowerCase() !== 'module') continue;
      const src = attr(tag, 'src');
      if (!src) continue;
      const resolved = resolveFromPage(src, absRoot, htmlPath);
      if (!resolved) {
        errors.push(`No se pudo resolver el entry ${src}.`);
        continue;
      }
      const abs = path.resolve(resolved);
      if (seen.has(abs)) continue;
      seen.add(abs);
      let text;
      try {
        text = await readFile(abs, 'utf8');
      } catch (error) {
        errors.push(`No se pudo leer el entry ${src}: ${errorMessage(error)}`);
        continue;
      }
      if (text.includes(ENTRY_NEEDLE)) {
        const rel = toPosix(path.relative(absRoot, abs));
        errors.push(`El entry ${rel} contiene ${ENTRY_NEEDLE}.`);
      }
    }
  }

  if (strict) {
    errors.push(...warnings.splice(0));
  }

  if (errors.length > 0) {
    const extra = warnings.length > 0 ? `${warnings.join('\n')}\n` : '';
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${errors.join('\n')}\n${extra}`,
    };
  }

  return {
    exitCode: 0,
    stdout: success ?? '',
    stderr: warnings.length > 0 ? `${warnings.join('\n')}\n` : '',
  };
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function collectJs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJs(full)));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * @param {string} html
 * @param {string} tagName
 * @returns {string[]}
 */
function tags(html, tagName) {
  const re = new RegExp(`<${tagName}\\b[\\s\\S]*?>`, 'gi');
  return html.match(re) ?? [];
}

/**
 * @param {string} tag
 * @param {string} name
 * @returns {string | undefined}
 */
function attr(tag, name) {
  const re = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`,
    'i',
  );
  const match = re.exec(tag);
  if (!match) return undefined;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

/**
 * @param {string} tag
 * @param {string} token
 */
function relIncludes(tag, token) {
  const value = attr(tag, 'rel');
  if (!value) return false;
  return value.toLowerCase().split(/\s+/).includes(token);
}

/**
 * @param {string} href
 * @param {string} chunkAbs
 * @param {string} root
 * @param {string} htmlPath
 */
function hrefPointsAt(href, chunkAbs, root, htmlPath) {
  const resolved = resolveFromPage(href, root, htmlPath);
  if (resolved && path.resolve(resolved) === path.resolve(chunkAbs))
    return true;
  return basenameOfHref(href) === path.basename(chunkAbs);
}

/**
 * @param {string} raw
 * @param {string} root
 * @param {string} htmlPath
 * @returns {string | null}
 */
function resolveFromPage(raw, root, htmlPath) {
  const clean = stripUrl(raw.trim());
  if (!clean) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) {
    try {
      const pathname = decodePath(new URL(clean).pathname);
      return path.join(root, pathname.replace(/^[/\\]+/, ''));
    } catch {
      return null;
    }
  }
  const decoded = decodePath(clean);
  if (decoded.startsWith('/') || decoded.startsWith('\\')) {
    return path.join(root, decoded.replace(/^[/\\]+/, ''));
  }
  return path.resolve(path.dirname(htmlPath), decoded);
}

/**
 * @param {string} raw
 */
function basenameOfHref(raw) {
  const clean = stripUrl(raw.trim());
  if (!clean) return '';
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) {
      return path.posix.basename(decodePath(new URL(clean).pathname));
    }
  } catch {
    return '';
  }
  return path.basename(decodePath(clean));
}

/**
 * @param {string} value
 */
function stripUrl(value) {
  return (value.split('#')[0] ?? '').split('?')[0] ?? '';
}

/**
 * @param {string} value
 */
function decodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * @param {string} value
 */
function toPosix(value) {
  return value.split(path.sep).join('/');
}

/**
 * @param {unknown} error
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function errorCode(error) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  const rootArg = process.argv[2];
  if (!rootArg) {
    process.stderr.write('Uso: node scripts/check-three-budget.mjs <dist>\n');
    process.exit(2);
  }
  const result = await evaluateDist(rootArg);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
