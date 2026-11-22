import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { closeV2DbForTests } from '../offline/db';
import { contentClass, Layout } from './Layout';
import { renderScreen } from './testing';

// `useMatches` solo existe dentro de un data router. El harness monta
// `MemoryRouter`, así que el test aporta el handle de la ruta.
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useMatches: () =>
      [
        {
          id: 'shell',
          pathname: '/',
          params: {},
          loaderData: undefined,
          handle: { title: 'Hoy', tab: 'hoy' },
        },
      ] as ReturnType<typeof actual.useMatches>,
  };
});

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));

const shellCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'shell.css'),
  'utf8',
);

// Cuerpo de las reglas que declaran `selector` (incluye los quiebres: para el
// contrato del marco basta con que la propiedad esté declarada una vez).
function ruleFor(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let body = '';
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] as string)
      .split(',')
      .map((item) => item.trim());
    if (selectors.includes(selector)) body += match[2] as string;
  }
  return body;
}

const CONTENT_CLASS: ReadonlyArray<readonly [string, string]> = [
  ['/', 'content content-split'],
  ['/repasar', 'content content-repasar'],
  ['/repasar/texto', 'content content-split'],
  ['/repasar/pronunciacion', 'content'],
  ['/temas', 'content'],
  ['/quiz/q1', 'content'],
  ['/mas', 'content'],
  ['/publicaciones/x', 'content content-split'],
  ['/chat', 'content content-split'],
  ['/chat/t1', 'content content-split'],
  ['/mas/admin/azure', 'content content-split'],
];

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
});

test.each(CONTENT_CLASS)(
  'contentClass(%s) devuelve %s',
  (pathname, className) => {
    expect(contentClass(pathname)).toBe(className);
  },
);

test('Layout monta un único announcer', async () => {
  renderScreen(<Layout />, {
    path: '/',
    pattern: '/',
    routes: {
      'GET /api/me/stats': {
        cards_learned: 0,
        due_now: 7,
        reviews_today: 0,
        retention_30d: null,
        streak_days: 0,
        week: [],
        quiz_best: [],
      },
    },
  });

  await screen.findByLabelText('7 por repasar');

  const live = document.querySelectorAll<HTMLParagraphElement>(
    'p.sr-only[aria-live="polite"]',
  );
  expect(live).toHaveLength(1);
  expect(live[0]).toHaveAttribute('aria-atomic', 'true');
  expect(live[0]?.textContent).toBe('');
  expect(document.getElementById('main')).toHaveAttribute(
    'class',
    'content content-split',
  );
});

test('shell.css quiebra en 960px y no reserva la barra dos veces', () => {
  expect(shellCss).toContain('@media (min-width: 960px)');
  expect(shellCss).not.toContain('900px');

  const wideAt = shellCss.indexOf('@media (min-width: 960px)');
  const base = shellCss.slice(0, wideAt);
  const wide = shellCss.slice(wideAt);
  expect(base).toMatch(/\.shell-tabbar\s*\{[^}]*height:\s*0\s*;/);
  expect(base).toMatch(/\.shell-tabbar\s*\{[^}]*overflow:\s*visible\s*;/);
  expect(wide).toMatch(/\.shell-tabbar\s*\{[^}]*height:\s*auto\s*;/);
});

test('el shell acota su alto para que .content sea el scroller real', () => {
  // Sin `height`, `<main class="content">` crece con el documento
  // (`clientHeight === scrollHeight`), `overscroll-behavior: contain` se traga
  // la rueda y el `position: sticky` de `.admin-subnav` y `.pub-split` no tiene
  // caja contra la que pegarse.
  const shell = ruleFor(shellCss, '.shell');
  expect(shell).toMatch(/(^|\n)\s*height:\s*100dvh\s*;/);
  expect(shell).toMatch(/min-height:\s*0\s*;/);

  const main = ruleFor(shellCss, '.shell-main');
  expect(main).toMatch(/min-height:\s*0\s*;/);
  expect(main).toMatch(/min-width:\s*0\s*;/);

  // El hijo flex debe poder encogerse por debajo de su alto de contenido.
  expect(ruleFor(shellCss, '.content')).toMatch(/min-height:\s*0\s*;/);
});
