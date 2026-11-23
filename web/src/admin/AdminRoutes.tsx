import { lazy, Suspense, useMemo, type ComponentType } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { AppBar, Skeleton } from '../components';
import { common } from '../l10n/es';
import { NotFound } from '../shell/NotFound';
import AdminSection from './AdminSection';
import {
  ADMIN_SCREENS,
  adminModules,
  adminNavStrings,
  type AdminModules,
} from './adminNav';
import './admin.css';

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

function AdminSubnav() {
  const { pathname } = useLocation();
  return (
    <nav className="admin-subnav" aria-label={adminNavStrings.title}>
      {ADMIN_SCREENS.map((screen) => {
        const to = `/mas/admin/${screen.path}`;
        return (
          <Link
            key={screen.path}
            to={to}
            aria-current={pathname === to ? 'page' : undefined}
          >
            {screen.title}
          </Link>
        );
      })}
    </nav>
  );
}

function AdminChild({ Screen }: { Screen: ComponentType }) {
  return (
    <div className="admin-console admin-dense">
      <AdminSubnav />
      <div className="admin-console-main">
        <Suspense fallback={<ScreenLoading />}>
          <Screen />
        </Suspense>
      </div>
    </div>
  );
}

interface AdminRoute {
  path: string;
  Screen: ComponentType;
}

// Las pantallas se cargan con `React.lazy` desde el glob: AdminSection y
// AdminRoutes no importan `screens/*` de forma estática.
function adminRoutes(modules: AdminModules): AdminRoute[] {
  const routes: AdminRoute[] = [];
  for (const screen of ADMIN_SCREENS) {
    const loader = modules[screen.file];
    if (loader === undefined) continue;
    routes.push({ path: screen.path, Screen: lazy(loader) });
  }
  return routes;
}

export function AdminRoutes({
  modules = adminModules(),
}: {
  modules?: AdminModules;
}) {
  const { user } = useAuth();
  const routes = useMemo(() => adminRoutes(modules), [modules]);

  if (user?.role !== 'admin') return <NotFound />;

  return (
    <Routes>
      <Route
        index
        element={
          <>
            <AppBar
              title={adminNavStrings.title}
              back={{ to: '/mas', label: 'Más' }}
            />
            <AdminSection modules={modules} />
          </>
        }
      />
      {routes.map(({ path, Screen }) => (
        <Route
          key={path}
          path={path}
          element={<AdminChild Screen={Screen} />}
        />
      ))}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default AdminRoutes;
