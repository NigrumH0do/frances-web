import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaOptions } from './src/sw/pwaConfig';

declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  base: process.env['VITE_BASE'] ?? '/',
  plugins: [react(), VitePWA(pwaOptions)],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8765' },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
