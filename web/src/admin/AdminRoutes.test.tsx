import 'fake-indexeddb/auto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';
import '@testing-library/jest-dom/vitest';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { closeV2DbForTests } from '../offline/db';
import { ME_ADMIN, ME_USER, renderScreen } from '../shell/testing';
import AdminRoutes from './AdminRoutes';
import { ADMIN_SCREENS, adminModules, type AdminModules } from './adminNav';

const adminDir = dirname(fileURLToPath(import.meta.url));

const CHILD_TITLES = [
  'Pipeline',
  'Audio',
  'Usuarios',
  'Invitaciones',
  'Temas',
  'Tarjetas',
  'Azure',
] as const;

function PipelineStub() {
  return <h1>Pipeline de prueba</h1>;
}

const ONLY_PIPELINE: AdminModules = {
  './screens/AdminPipeline.tsx': async () => ({ default: PipelineStub }),
};

beforeEach(async () => {
  indexedDB = new IDBFactory();
  await closeV2DbForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('user_never_sees_admin_routes', async () => {
  renderScreen(<AdminRoutes modules={ONLY_PIPELINE} />, {
    user: ME_USER,
    path: '/mas/admin/pipeline',
    pattern: '/mas/admin/*',
  });

  expect(
    await screen.findByRole('heading', { name: 'Página no encontrada' }),
  ).toBeVisible();
  expect(screen.queryByText('Pipeline de prueba')).not.toBeInTheDocument();
});

test('admin en el índice ve la navegación de administración', async () => {
  renderScreen(<AdminRoutes modules={ONLY_PIPELINE} />, {
    user: ME_ADMIN,
    path: '/mas/admin',
    pattern: '/mas/admin/*',
  });

  expect(
    await screen.findByRole('heading', { name: 'Administración' }),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: 'Pipeline' })).toHaveAttribute(
    'href',
    '/mas/admin/pipeline',
  );
  expect(screen.getByRole('link', { name: 'Más' })).toHaveAttribute(
    'href',
    '/mas',
  );
  expect(document.querySelector('.admin-subnav')).not.toBeInTheDocument();
});

test('admin monta la pantalla existente de forma perezosa', async () => {
  renderScreen(<AdminRoutes modules={ONLY_PIPELINE} />, {
    user: ME_ADMIN,
    path: '/mas/admin/pipeline',
    pattern: '/mas/admin/*',
  });

  expect(
    await screen.findByRole('heading', { name: 'Pipeline de prueba' }),
  ).toBeVisible();
});

test('una pantalla sin módulo cae en 404', async () => {
  renderScreen(<AdminRoutes modules={ONLY_PIPELINE} />, {
    user: ME_ADMIN,
    path: '/mas/admin/users',
    pattern: '/mas/admin/*',
  });

  expect(
    await screen.findByRole('heading', { name: 'Página no encontrada' }),
  ).toBeVisible();
});

test('una ruta hija muestra la subnav con la pantalla activa', async () => {
  renderScreen(<AdminRoutes modules={ONLY_PIPELINE} />, {
    user: ME_ADMIN,
    path: '/mas/admin/pipeline',
    pattern: '/mas/admin/*',
  });

  const nav = await screen.findByRole('navigation', { name: 'Administración' });
  expect(nav).toHaveClass('admin-subnav');
  const links = within(nav).getAllByRole('link');
  expect(links.map((link) => link.textContent)).toEqual([...CHILD_TITLES]);
  expect(CHILD_TITLES).toEqual(ADMIN_SCREENS.map((screen) => screen.title));
  expect(within(nav).getByRole('link', { name: 'Pipeline' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  for (const title of CHILD_TITLES) {
    if (title === 'Pipeline') continue;
    expect(within(nav).getByRole('link', { name: title })).not.toHaveAttribute(
      'aria-current',
    );
  }
  expect(screen.queryByRole('link', { name: 'Más' })).not.toBeInTheDocument();
});

function walkSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSources(full));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function importedSpecs(source: string): string[] {
  const specs: string[] = [];
  for (const match of source.matchAll(
    /(?:import|export)\s[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/g,
  )) {
    specs.push(match[1] ?? '');
  }
  for (const match of source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specs.push(match[1] ?? '');
  }
  return specs;
}

function importsThreeOrScenes(spec: string): boolean {
  return (
    spec === 'three' ||
    spec.startsWith('three/') ||
    spec.includes('/three/') ||
    spec.endsWith('/three') ||
    spec.includes('LazyScenes')
  );
}

test('admin.css no tiene papel Seyès y el admin no importa three', () => {
  const css = readFileSync(join(adminDir, 'admin.css'), 'utf8');
  expect(css).not.toMatch(/\.paper\b/);
  expect(css.toLowerCase()).not.toContain('sey');
  expect(css).toMatch(/\.admin-dense \.list-item\s*\{[^}]*min-height:\s*48px/);
  expect(css).toMatch(
    /\.admin-dense \.section-title\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*background:\s*var\(--c-bg\)[^}]*z-index:\s*1/,
  );
  expect(css).toMatch(/\.nums\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  expect(css).toMatch(/\.admin-subnav\s*\{[^}]*overflow-x:\s*auto/);
  const desktop =
    /@media\s*\(\s*min-width:\s*960px\s*\)\s*\{([\s\S]*)\}\s*$/.exec(css)?.[1];
  expect(desktop).toBeDefined();
  expect(desktop).toMatch(/\.admin-subnav\s*\{[^}]*position:\s*sticky/);
  expect(desktop).toMatch(/\.admin-subnav\s*\{[^}]*width:\s*240px/);

  const screens = [
    'AdminPipeline.tsx',
    'AdminAudio.tsx',
    'AdminUsers.tsx',
    'AdminInvites.tsx',
    'AdminTopics.tsx',
    'AdminCards.tsx',
    'AdminAzure.tsx',
  ];
  for (const file of screens) {
    const source = readFileSync(join(adminDir, 'screens', file), 'utf8');
    expect(source, file).toMatch(/to:\s*'\/mas\/admin'/);
    expect(source, file).toMatch(/label:\s*'Administración'/);
    expect(source, file).not.toMatch(/to:\s*'\/mas'/);
  }
  const routes = readFileSync(join(adminDir, 'AdminRoutes.tsx'), 'utf8');
  expect(routes).toMatch(/to:\s*'\/mas'/);
  expect(routes).toMatch(/label:\s*'Más'/);

  for (const file of walkSources(adminDir)) {
    for (const spec of importedSpecs(readFileSync(file, 'utf8'))) {
      expect(importsThreeOrScenes(spec), `${file} → ${spec}`).toBe(false);
    }
  }
});

test('adminModules excluye los tests y encuentra las pantallas creadas', () => {
  const keys = Object.keys(adminModules());

  expect(keys).toContain('./screens/AdminPipeline.tsx');
  expect(keys).toContain('./screens/AdminAudio.tsx');
  expect(keys.filter((key) => key.includes('.test.'))).toEqual([]);
});
