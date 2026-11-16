import { lazy, Suspense, type ComponentType, type ReactElement } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import Login from '../auth/Login';
import Invitacion from '../auth/Invitacion';
import { RequireSession } from '../auth/RequireSession';
import { Skeleton } from '../components';
import { common } from '../l10n/es';
import { Layout } from './Layout';
import { NotFound } from './NotFound';
import { Placeholder } from './Placeholder';
import { shellStrings } from './strings';
import type { TabId } from './TabBar';

export type ScreenModule =
  | 'hoy/Hoy'
  | 'temas/Temas'
  | 'temas/TemaDetalle'
  | 'publicacion/Publicacion'
  | 'repasar/Repasar'
  | 'pronunciacion/Pronunciacion'
  | 'texto/Texto'
  | 'quiz/Quiz'
  | 'chat/Chat'
  | 'mas/Mas'
  | 'admin/AdminRoutes';

export interface ScreenRoute {
  path: string;
  module: ScreenModule;
  tab: TabId;
  title: string;
  role?: 'admin';
}

// Lista completa del «Mapa de la app v2». Igual que `ROUTER_MODULES` en el
// servidor: se declara entera y cada pantalla aterriza en su tarea.
export const SCREENS: ScreenRoute[] = [
  {
    path: '/',
    module: 'hoy/Hoy',
    tab: 'hoy',
    title: shellStrings.screens.hoy,
  },
  {
    path: '/temas',
    module: 'temas/Temas',
    tab: 'temas',
    title: shellStrings.screens.temas,
  },
  {
    path: '/temas/:topicId',
    module: 'temas/TemaDetalle',
    tab: 'temas',
    title: shellStrings.screens.tema,
  },
  {
    path: '/publicaciones/:itemId',
    module: 'publicacion/Publicacion',
    tab: 'temas',
    title: shellStrings.screens.publicacion,
  },
  {
    path: '/repasar',
    module: 'repasar/Repasar',
    tab: 'repasar',
    title: shellStrings.screens.repasar,
  },
  {
    path: '/repasar/pronunciacion',
    module: 'pronunciacion/Pronunciacion',
    tab: 'repasar',
    title: shellStrings.screens.pronunciacion,
  },
  {
    path: '/repasar/texto',
    module: 'texto/Texto',
    tab: 'repasar',
    title: shellStrings.screens.texto,
  },
  {
    path: '/quiz/:quizId',
    module: 'quiz/Quiz',
    tab: 'temas',
    title: shellStrings.screens.quiz,
  },
  {
    path: '/chat',
    module: 'chat/Chat',
    tab: 'chat',
    title: shellStrings.screens.chat,
  },
  {
    path: '/chat/:threadId',
    module: 'chat/Chat',
    tab: 'chat',
    title: shellStrings.screens.chat,
  },
  {
    path: '/mas',
    module: 'mas/Mas',
    tab: 'mas',
    title: shellStrings.screens.mas,
  },
  {
    path: '/mas/admin/*',
    module: 'admin/AdminRoutes',
    tab: 'mas',
    title: shellStrings.screens.admin,
    role: 'admin',
  },
];

export type ScreenModuleLoader = () => Promise<{
  default: ComponentType;
}>;

export type ScreenModules = Record<string, ScreenModuleLoader>;

// Carga perezosa de las pantallas reales. El patrón negativo es parte del
// contrato: un `*.test.tsx` dentro de screens/ o admin/ nunca entra al bundle.
export const SCREEN_MODULES = import.meta.glob([
  '../screens/*/*.tsx',
  '../admin/AdminRoutes.tsx',
  '!**/*.test.tsx',
]) as ScreenModules;

function moduleKey(module: ScreenModule): string {
  return module === 'admin/AdminRoutes'
    ? '../admin/AdminRoutes.tsx'
    : `../screens/${module}.tsx`;
}

function ScreenLoading() {
  return (
    <div className="stack" role="status">
      <span className="sr-only">{common.loading}</span>
      <Skeleton variant="title" />
      <Skeleton />
      <Skeleton variant="block" />
    </div>
  );
}

function AdminGate({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <NotFound />;
  return children;
}

function screenElement(
  route: ScreenRoute,
  modules: ScreenModules,
): ReactElement {
  const loader = modules[moduleKey(route.module)];
  if (loader === undefined) {
    if (route.module === 'admin/AdminRoutes') return <NotFound />;
    return <Placeholder title={route.title} />;
  }

  const Screen = lazy(loader);
  const element = (
    <Suspense fallback={<ScreenLoading />}>
      <Screen />
    </Suspense>
  );

  return route.role === 'admin' ? <AdminGate>{element}</AdminGate> : element;
}

function childPath(path: string): string | undefined {
  const relative = path.replace(/^\//, '');
  return relative === '' ? undefined : relative;
}

export function buildRoutes(
  modules: ScreenModules = SCREEN_MODULES,
): RouteObject[] {
  const screens: RouteObject[] = SCREENS.map((route) => {
    const path = childPath(route.path);
    return {
      ...(path === undefined ? { index: true } : { path }),
      element: screenElement(route, modules),
      handle: { tab: route.tab, title: route.title },
    };
  });

  return [
    { path: '/entrar', element: <Login /> },
    { path: '/invitacion', element: <Invitacion /> },
    {
      path: '/',
      element: (
        <RequireSession>
          <Layout />
        </RequireSession>
      ),
      children: [
        ...screens,
        {
          path: '*',
          element: <NotFound />,
          handle: { title: shellStrings.notFound.title },
        },
      ],
    },
  ];
}

export function buildRouter(
  basename: string,
): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(buildRoutes(), { basename });
}
