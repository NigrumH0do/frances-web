// Configuración e2e v2 (Task UI-22): corre los flujos de la web v2 sobre el
// build demo (`--mode demo`) con la instantánea generada por la API real
// (UI-20) y el recognizer falso de CHG-13 (`VITE_E2E=1`). Los dos proyectos
// usan viewport móvil, Chromium y WebKit.
//
// La preparación vive en `webServer.command`: build demo, instantánea y
// `vite preview` en el 4174. No hay servidor Python en tiempo de test.

import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
const BASE_URL = `http://localhost:${PORT}/`;

export default defineConfig({
  testDir: './e2e-v2',
  testMatch: /.*\.e2e\.ts$/,
  outputDir: '../.cache/playwright-v2',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['dot'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: BASE_URL, trace: 'on-first-retry' },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command:
      'VITE_E2E=1 VITE_BASE=/ npm run build -- --mode demo --outDir dist-e2e && uv run --project .. python ../scripts/demo_api_snapshot.py --out dist-e2e/demo-api && npm run preview -- --outDir dist-e2e --port 4174 --strictPort',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
