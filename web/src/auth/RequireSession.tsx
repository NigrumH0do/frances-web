import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Skeleton } from '../components';
import { common } from '../l10n/es';
import { useAuth } from './AuthContext';

// Envuelve las rutas privadas: mientras se comprueba la sesión muestra un
// esqueleto; sin sesión lleva a `/entrar` conservando el destino en `next`.

export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return (
      <div className="stack" role="status" aria-label={common.loading}>
        <span className="sr-only">{common.loading}</span>
        <Skeleton variant="title" />
        <Skeleton />
        <Skeleton variant="block" />
      </div>
    );
  }

  if (status === 'anonymous') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/entrar?next=${encodeURIComponent(next)}`} replace />;
  }

  return <>{children}</>;
}
