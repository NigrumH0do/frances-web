// Consola limpia (QA-03). Los listeners se enganchan al crear la página, antes
// de que el test navegue. Falla en `error`, `warning` y `pageerror`. `log`,
// `info` y `debug` no fallan: el `console.log` de three al perder el contexto
// es un log. La allowlist nace vacía. La única excepción, y solo si icon.svg
// respondió 200, es el 404 de /favicon.ico: el HTML ya declara el SVG.

import {
  expect,
  test as base,
  type ConsoleMessage,
  type Page,
} from '@playwright/test';

export { expect };
export type { Page };

const FAVICON = /\/favicon\.ico(?:[?#]|$)/;

function isFavicon(msg: ConsoleMessage): boolean {
  return FAVICON.test(msg.location().url) || /favicon\.ico/i.test(msg.text());
}

// No son console.warn de la aplicación: Playwright avisa cuando un spec bloquea
// el service worker a propósito, y WebKit avisa del modulepreload del entry
// aunque el módulo sí se ejecute.
function isHarnessNoise(msg: ConsoleMessage): boolean {
  const text = msg.text();
  if (text === 'Service Worker registration blocked by Playwright') return true;
  return /was preloaded using link preload but not used/.test(text);
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const issues: string[] = [];
    let sawFavicon = false;
    let iconSvgOk = false;

    page.on('console', (msg: ConsoleMessage) => {
      const type = msg.type();
      if (type !== 'error' && type !== 'warning') return;
      if (isFavicon(msg)) {
        sawFavicon = true;
        return;
      }
      if (isHarnessNoise(msg)) return;
      const where = msg.location().url;
      issues.push(`${type}: ${msg.text()}${where ? ` (${where})` : ''}`);
    });
    page.on('pageerror', (error: Error) => {
      issues.push(`pageerror: ${error.message}`);
    });
    page.on('response', (response) => {
      try {
        const path = new URL(response.url()).pathname;
        if (path.endsWith('/icon.svg') && response.status() === 200) {
          iconSvgOk = true;
        }
      } catch {
        // Una URL no parseable no es icon.svg.
      }
    });

    await use(page);

    if (sawFavicon && !iconSvgOk) {
      issues.push('error: 404 de /favicon.ico sin icon.svg en 200');
    }
    expect(issues, `Consola sucia:\n${issues.join('\n')}`).toEqual([]);
  },
});
