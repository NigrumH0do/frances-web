import { describe, expect, test } from 'vitest';
import {
  API_CACHE_NAMES,
  API_DATA_CACHE,
  API_MEDIA_CACHE,
  API_NEVER_PATTERN,
  DEMO_CACHE,
  DEMO_PATTERN,
  pwaOptions,
} from './pwaConfig';

type Matcher = {
  urlPattern: unknown;
  handler: string;
  options?: {
    expiration?: { maxEntries?: number; maxAgeSeconds?: number };
    cacheableResponse?: { statuses: number[] };
    networkTimeoutSeconds?: number;
    cacheName?: string;
  };
};
type RuleContext = {
  url: URL;
  request: Request;
};

const rule = (path: string, method = 'GET'): Matcher | undefined =>
  (pwaOptions.workbox!.runtimeCaching as unknown as Matcher[]).find((r) => {
    if (typeof r.urlPattern !== 'function') return false;
    const url = new URL(`https://x.test${path}`);
    const ctx: RuleContext = {
      url,
      request: new Request(url, { method }),
    };
    return (r.urlPattern as (c: RuleContext) => boolean)(ctx);
  });

describe('pwaOptions', () => {
  test('configura la PWA con prompt, clientsClaim y el fallback de navegación', () => {
    expect(
      pwaOptions.workbox!.navigateFallbackDenylist!.some((r) =>
        r.test('/repo/demo/'),
      ),
    ).toBe(true);
    expect(pwaOptions.manifest && pwaOptions.manifest.name).toBe(
      'Français — Estudio',
    );
    expect(pwaOptions.registerType).toBe('prompt');
    expect(pwaOptions.workbox!.clientsClaim).toBe(true);
  });

  test('CHG-16: no quedan reglas v1 de bins ni bundle.json', () => {
    const runtime = pwaOptions.workbox!.runtimeCaching as unknown as Matcher[];
    expect(runtime).toHaveLength(4);
    expect(rule(`/data/d/${'a'.repeat(32)}.bin`)).toBeUndefined();
    expect(rule('/data/bundle.json')).toBeUndefined();
    expect(pwaOptions.workbox!.globIgnores).not.toContain('**/data/**');
  });
});

describe('caché de la API v2 (CHG-15)', () => {
  test('api rules never cache private or unsafe routes', () => {
    // REVIEW FOCUS P09-5
    for (const p of [
      '/api/auth/me',
      '/api/admin/pipeline',
      '/api/chat/threads',
      '/api/speech/token',
      '/api/search?q=x',
      '/api/health',
    ]) {
      expect(rule(p), p).toBeUndefined();
    }
    expect(rule('/api/reviews', 'POST')).toBeUndefined();
    expect(rule('/api/plan/today')?.handler).toBe('NetworkFirst');
    expect(rule(`/api/files/${'a'.repeat(64)}`)?.handler).toBe('CacheFirst');
    expect(
      pwaOptions.workbox!.navigateFallbackDenylist!.some((re) =>
        re.test('/api/items'),
      ),
    ).toBe(true);
  });

  test('solo se guardan respuestas 200', () => {
    for (const p of [
      '/api/plan/today',
      `/api/files/${'b'.repeat(64)}`,
      '/demo-api/plan/today',
    ]) {
      expect(rule(p)?.options?.cacheableResponse).toEqual({ statuses: [200] });
    }
  });

  test('GET de quiz se guarda; POST de intentos nunca', () => {
    // REVIEW FOCUS P09-5
    expect(rule('/api/quizzes/q1')?.handler).toBe('NetworkFirst');
    expect(rule('/api/quizzes/q1/attempts', 'POST')).toBeUndefined();
  });

  test('datos: 4 s de tiempo de red, 400 entradas, 7 días', () => {
    const r = rule('/api/topics/t1');
    expect(r?.options?.cacheName).toBe(API_DATA_CACHE);
    expect(r?.options?.networkTimeoutSeconds).toBe(4);
  });

  test('medios: cache-first, 800 entradas', () => {
    const r = rule(`/api/files/${'c'.repeat(64)}`);
    expect(r?.options?.cacheName).toBe(API_MEDIA_CACHE);
    expect(r?.options?.expiration?.maxEntries).toBe(800);
  });

  test('la instantánea del demo es NetworkFirst y no se precachea', () => {
    const r = rule('/demo-api/plan/today');
    expect(r?.handler).toBe('NetworkFirst');
    expect(r?.options?.cacheName).toBe(DEMO_CACHE);
    expect(pwaOptions.workbox!.globIgnores).toContain('**/demo-api/**');
  });

  test('API_CACHE_NAMES lista las cachés de datos y medios', () => {
    expect([...API_CACHE_NAMES]).toEqual([API_DATA_CACHE, API_MEDIA_CACHE]);
  });

  test('rutas que ponen cookies quedan en API_NEVER_PATTERN y no se cachean', () => {
    for (const p of [
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/invite/accept',
    ]) {
      expect(API_NEVER_PATTERN.test(p), p).toBe(true);
      expect(rule(p, 'GET'), p).toBeUndefined();
      expect(rule(p, 'POST'), p).toBeUndefined();
    }
  });

  test('demo: patrón anclado al inicio de la ruta', () => {
    expect(DEMO_PATTERN.test('/demo-api/plan/today')).toBe(true);
    expect(DEMO_PATTERN.test('/frances/demo-api/plan/today')).toBe(true);
    expect(DEMO_PATTERN.test('/a/b/demo-api/plan/today')).toBe(false);
    expect(DEMO_PATTERN.test('/api/demo-api-notes')).toBe(false);
  });

  test('demo: excluye las rutas privadas igual que la API', () => {
    for (const p of [
      '/demo-api/auth/me',
      '/frances/demo-api/admin/pipeline',
      '/demo-api/chat/threads',
      '/demo-api/health',
    ]) {
      expect(rule(p), p).toBeUndefined();
    }
  });

  test('demo: 200 entradas, 7 días y solo 200', () => {
    const r = rule('/demo-api/plan/today');
    expect(r?.options?.expiration?.maxEntries).toBe(200);
    expect(r?.options?.expiration?.maxAgeSeconds).toBe(60 * 60 * 24 * 7);
    expect(r?.options?.cacheableResponse).toEqual({ statuses: [200] });
  });
});

describe('patrones de runtime autocontenidos (FIX-17)', () => {
  const runtime = (): Matcher[] =>
    pwaOptions.workbox!.runtimeCaching as unknown as Matcher[];

  // Identificadores del módulo que Workbox no copia al `sw.js` serializado.
  const MODULE_ONLY = [
    'API_DATA_PATTERN',
    'API_MEDIA_PATTERN',
    'API_NEVER_PATTERN',
    'DEMO_PATTERN',
    'ONE_DAY',
    'isCacheableApiGet',
    'pwaOptions',
  ];

  test('la serialización no referencia constantes externas', () => {
    runtime().forEach((entry, index) => {
      expect(typeof entry.urlPattern, `regla ${index}`).toBe('function');
      const source = String(entry.urlPattern);
      for (const identifier of MODULE_ONLY) {
        expect(source, `regla ${index} usa ${identifier}`).not.toMatch(
          new RegExp(`\\b${identifier}\\b`),
        );
      }
    });
  });

  test('las funciones serializadas se ejecutan sin el ámbito del módulo', () => {
    const evaluate = (index: number, path: string, method = 'GET'): boolean => {
      const source = String(runtime()[index]!.urlPattern);
      // `new Function` no hereda el ámbito del módulo: si el patrón cerrara
      // sobre una constante, aquí saltaría ReferenceError.
      const select = new Function('ctx', `return (${source})(ctx);`) as (
        ctx: RuleContext,
      ) => boolean;
      const url = new URL(`https://x.test${path}`);
      return select({
        url,
        request: new Request(url, { method }),
      });
    };

    expect(evaluate(0, '/api/plan/today')).toBe(true);
    expect(evaluate(0, '/api/plan/today', 'POST')).toBe(false);
    expect(evaluate(0, '/api/auth/me')).toBe(false);

    expect(evaluate(1, `/api/files/${'b'.repeat(64)}`)).toBe(true);
    expect(evaluate(1, `/api/files/${'b'.repeat(64)}`, 'POST')).toBe(false);
    expect(evaluate(1, '/api/admin/pipeline')).toBe(false);

    expect(evaluate(2, '/demo-api/plan/today')).toBe(true);
    expect(evaluate(2, '/frances/demo-api/plan/today')).toBe(true);
    expect(evaluate(2, '/demo-api/auth/me')).toBe(false);
    expect(evaluate(2, '/demo-api/plan/today', 'POST')).toBe(false);

    expect(evaluate(3, '/assets/three-abc123.js')).toBe(true);
    expect(evaluate(3, '/assets/three-abc123.js', 'POST')).toBe(false);
    expect(evaluate(3, '/assets/index-abc.js')).toBe(false);
    expect(evaluate(3, '/api/plan/today')).toBe(false);
  });
});

describe('chunk three fuera del precache (GL-07)', () => {
  const threeRule = (): Matcher => {
    const runtime = pwaOptions.workbox!.runtimeCaching as unknown as Matcher[];
    const found = runtime.find(
      (entry) => entry.options?.cacheName === 'frances-three',
    );
    expect(found).toBeDefined();
    return found as Matcher;
  };

  const matches = (path: string, method = 'GET'): boolean => {
    const entry = threeRule();
    if (typeof entry.urlPattern !== 'function') return false;
    const url = new URL(`https://x.test${path}`);
    return (entry.urlPattern as (ctx: RuleContext) => boolean)({
      url,
      request: new Request(url, { method }),
    });
  };

  test('globIgnores excluye el chunk three y sigue excluyendo el demo', () => {
    expect(pwaOptions.workbox!.globIgnores).toContain('**/three-*.js');
    expect(pwaOptions.workbox!.globIgnores).toContain('**/demo-api/**');
  });

  test('GET /assets/three-*.js es CacheFirst en frances-three', () => {
    const entry = threeRule();
    expect(matches('/assets/three-abc123.js')).toBe(true);
    expect(entry.handler).toBe('CacheFirst');
    expect(entry.options?.cacheName).toBe('frances-three');
    expect(entry.options?.cacheableResponse).toEqual({ statuses: [200] });
    expect(entry.options?.expiration).toEqual({
      maxEntries: 2,
      maxAgeSeconds: 60 * 60 * 24 * 30,
    });
  });

  test('no hace match con el entry, la API ni un POST del chunk', () => {
    expect(matches('/assets/index-abc.js')).toBe(false);
    expect(matches('/api/plan/today')).toBe(false);
    expect(matches('/assets/three-abc123.js', 'POST')).toBe(false);
  });

  test('el urlPattern serializado lleva el regex literal inline', () => {
    const source = String(threeRule().urlPattern);
    expect(source).toContain('three-');
    expect(source).toMatch(/three-\[\^\/\]\+\\\.js/);
    for (const name of [
      'THREE_CHUNK',
      'THREE_ASSET',
      'THREE_PATTERN',
      'ONE_DAY',
      'API_DATA_PATTERN',
      'API_MEDIA_PATTERN',
      'API_NEVER_PATTERN',
      'DEMO_PATTERN',
    ]) {
      expect(source, name).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});

describe('compuerta del chunk three (QA-01)', () => {
  const MODULE_ONLY = [
    'API_DATA_PATTERN',
    'API_MEDIA_PATTERN',
    'API_NEVER_PATTERN',
    'DEMO_PATTERN',
    'ONE_DAY',
    'isCacheableApiGet',
    'pwaOptions',
  ];

  test('globIgnores excluye three y sigue excluyendo el demo', () => {
    expect(pwaOptions.workbox!.globIgnores).toContain('**/three-*.js');
    expect(pwaOptions.workbox!.globIgnores).toContain('**/demo-api/**');
  });

  test('CacheFirst de three no cierra sobre constantes del módulo', () => {
    const runtime = pwaOptions.workbox!.runtimeCaching as unknown as Matcher[];
    const entry = runtime.find(
      (item) =>
        item.handler === 'CacheFirst' &&
        String(item.urlPattern).includes('three-'),
    );
    expect(entry).toBeDefined();
    const source = String(entry?.urlPattern);
    expect(source).toContain('three-');
    expect(source).not.toContain('API_MEDIA_PATTERN');
    for (const identifier of MODULE_ONLY) {
      expect(source, identifier).not.toMatch(new RegExp(`\\b${identifier}\\b`));
    }

    const three = rule('/assets/three-abc123.js');
    expect(three?.handler).toBe('CacheFirst');
    expect(rule('/assets/index-abc123.js')).not.toBe(three);
    expect(rule('/assets/three-abc123.js', 'POST')).toBeUndefined();
  });
});
