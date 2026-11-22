// Configuración de la PWA offline (Task WEB-12, ampliada por CHG-15; CHG-16
// retiró las reglas del bundle cifrado de la web v1).
//
// El service worker usa la estrategia `generateSW` de Workbox: precachea el
// shell (JS/CSS/HTML/SVG). Los `urlPattern` son funciones sobre `url.pathname`,
// así valen igual cuando los datos vienen del mismo origen. El
// `navigateFallbackDenylist` deja fuera `data/` y el subdirectorio `demo/`.
//
// CHG-15 agrega las reglas de la API v2 (datos, medios y demo). Solo cachean
// `GET` con respuesta 200 y nunca tocan rutas privadas (`/api/auth`,
// `/api/admin`, `/api/chat`, `/api/speech`, `/api/search`, `/api/health`).
// Las rutas que ponen cookies (`/api/auth/*`, incluido `/api/auth/invite/accept`)
// quedan en `API_NEVER_PATTERN`. No se excluyen por `Set-Cookie`: el service
// worker no puede leer esa cabecera, que es prohibida para él.
//
// Workbox serializa cada `urlPattern` con `Function.prototype.toString()` y lo
// inyecta tal cual en `sw.js`: la función no puede cerrar sobre constantes del
// módulo porque en el service worker no existen y quedarían `undefined`. Por
// eso los patrones de runtime llevan sus regex y comprobaciones inline; las
// constantes exportadas solo documentan y prueban esos mismos patrones.

import type { VitePWAOptions } from 'vite-plugin-pwa';

export const API_DATA_CACHE = 'frances-api-data';
export const API_MEDIA_CACHE = 'frances-api-media';
export const DEMO_CACHE = 'frances-demo';
export const API_CACHE_NAMES = [API_DATA_CACHE, API_MEDIA_CACHE] as const;

export const API_DATA_PATTERN =
  /^\/api\/(plan\/(today|week)|review\/queue|cards(\/[^/]+)?|topics(\/[^/]+(\/cards)?)?|items(\/[^/]+)?|sheets\/[^/]+|voices|drills|courses(\/[^/]+\/classroom-topics)?|quizzes(\/[^/]+(\/attempts)?)?|study\/status|me\/(prefs|stats|topic-progress|upcoming))$/;
export const API_MEDIA_PATTERN = /^\/api\/(files\/[0-9a-f]{64}|audio\/[^/]+)$/;
export const API_NEVER_PATTERN =
  /^\/api\/(auth|admin|chat|speech|search|health)(\/|$)/;
// Anclado al inicio de la ruta. Acepta un solo segmento delante (el `base` de
// Vite, p. ej. `/<repo>/demo-api/`), porque el demo se publica bajo ese base.
export const DEMO_PATTERN = /^\/(?:[^/]+\/)?demo-api\//;

const ONE_DAY = 60 * 60 * 24;

type ApiUrlContext = {
  url: URL;
  request: Request;
};

export const pwaOptions: Partial<VitePWAOptions> = {
  strategies: 'generateSW',
  registerType: 'prompt',
  manifest: {
    name: 'Français — Estudio',
    short_name: 'Français',
    description: 'Estudio offline de francés con fichas, audio y repaso.',
    lang: 'es',
    start_url: '.',
    scope: '.',
    display: 'standalone',
    background_color: '#f8f6ed',
    theme_color: '#2147a3',
    icons: [
      {
        src: 'icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,mjs,woff2}'],
    globIgnores: ['**/demo-api/**'],
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [/\/data\//, /\/demo\//, /^\/api\//],
    clientsClaim: true,
    skipWaiting: false,
    runtimeCaching: [
      // CHG-15: reglas de la API v2 (datos, medios y demo).
      {
        urlPattern: ({ url, request }: ApiUrlContext) =>
          request.method === 'GET' &&
          !/^\/api\/(auth|admin|chat|speech|search|health)(\/|$)/.test(
            url.pathname,
          ) &&
          /^\/api\/(plan\/(today|week)|review\/queue|cards(\/[^/]+)?|topics(\/[^/]+(\/cards)?)?|items(\/[^/]+)?|sheets\/[^/]+|voices|drills|courses(\/[^/]+\/classroom-topics)?|quizzes(\/[^/]+(\/attempts)?)?|study\/status|me\/(prefs|stats|topic-progress|upcoming))$/.test(
            url.pathname,
          ),
        handler: 'NetworkFirst',
        options: {
          cacheName: API_DATA_CACHE,
          networkTimeoutSeconds: 4,
          expiration: {
            maxEntries: 400,
            maxAgeSeconds: ONE_DAY * 7,
          },
          cacheableResponse: { statuses: [200] },
        },
      },
      {
        urlPattern: ({ url, request }: ApiUrlContext) =>
          request.method === 'GET' &&
          !/^\/api\/(auth|admin|chat|speech|search|health)(\/|$)/.test(
            url.pathname,
          ) &&
          /^\/api\/(files\/[0-9a-f]{64}|audio\/[^/]+)$/.test(url.pathname),
        handler: 'CacheFirst',
        options: {
          cacheName: API_MEDIA_CACHE,
          expiration: {
            maxEntries: 800,
            maxAgeSeconds: ONE_DAY * 30,
            purgeOnQuotaError: true,
          },
          cacheableResponse: { statuses: [200] },
        },
      },
      {
        // El demo se mira como si fuera la API real: `/<base>/demo-api/x` se
        // compara contra `/api/x`, así las rutas privadas también quedan fuera.
        urlPattern: ({ url, request }: ApiUrlContext) =>
          request.method === 'GET' &&
          /^\/(?:[^/]+\/)?demo-api\//.test(url.pathname) &&
          !/^\/api\/(auth|admin|chat|speech|search|health)(\/|$)/.test(
            url.pathname.replace(/^\/(?:[^/]+\/)?demo-api\//, '/api/'),
          ),
        handler: 'NetworkFirst',
        options: {
          cacheName: DEMO_CACHE,
          networkTimeoutSeconds: 4,
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: ONE_DAY * 7,
          },
          cacheableResponse: { statuses: [200] },
        },
      },
    ],
  },
};
