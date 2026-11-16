import type { ComponentType } from 'react';

// Navegación del admin (MGT-05). Las pantallas se descubren con un glob
// perezoso: MGT-06/07/08 solo agregan archivos y no tocan este módulo.
export interface AdminScreen {
  path: string;
  file: string;
  title: string;
}

export type AdminModule = { default: ComponentType };
export type AdminModuleLoader = () => Promise<AdminModule>;
export type AdminModules = Record<string, AdminModuleLoader>;

export const adminNavStrings = {
  title: 'Administración',
  empty: 'No hay pantallas de administración disponibles.',
} as const;

export const ADMIN_SCREENS: readonly AdminScreen[] = [
  {
    path: 'pipeline',
    file: './screens/AdminPipeline.tsx',
    title: 'Pipeline',
  },
  {
    path: 'audio',
    file: './screens/AdminAudio.tsx',
    title: 'Audio',
  },
  {
    path: 'users',
    file: './screens/AdminUsers.tsx',
    title: 'Usuarios',
  },
  {
    path: 'invites',
    file: './screens/AdminInvites.tsx',
    title: 'Invitaciones',
  },
  {
    path: 'topics',
    file: './screens/AdminTopics.tsx',
    title: 'Temas',
  },
  {
    path: 'cards',
    file: './screens/AdminCards.tsx',
    title: 'Tarjetas',
  },
];

// El patrón negativo es parte del contrato: un `*.test.tsx` dentro de
// `screens/` nunca entra al bundle ni aparece como pantalla.
const ADMIN_MODULES = import.meta.glob(
  ['./screens/*.tsx', '!./screens/*.test.tsx'],
  { eager: false },
) as AdminModules;

export function adminModules(): AdminModules {
  return ADMIN_MODULES;
}
