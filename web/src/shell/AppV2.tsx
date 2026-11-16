import { useEffect, useMemo } from 'react';
import { RouterProvider } from 'react-router';
import { useApi } from '../api/ApiContext';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { applyTheme, initialTheme } from '../design/theme';
import { OfflineProvider } from '../offline/OfflineContext';
import { prefetchForOffline } from '../offline/prefetch';
import { buildRouter } from './routes';

const PREFETCH_DAY_KEY = 'fc-prefetch-day';

function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function claimDailyPrefetch(): boolean {
  const today = todayKey();
  try {
    if (localStorage.getItem(PREFETCH_DAY_KEY) === today) return false;
    localStorage.setItem(PREFETCH_DAY_KEY, today);
    return true;
  } catch {
    // Sin almacenamiento no se puede recordar; se intenta una vez por montaje.
    return true;
  }
}

// Tareas posteriores al login: aplicar el tema guardado del usuario (si difiere
// del que ya puso `bootV2`) y precargar los datos de Hoy una vez al día.
function SessionBootstrap() {
  const api = useApi();
  const { status } = useAuth();

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;

    void (async () => {
      try {
        const prefs = await api.prefs();
        if (
          !cancelled &&
          prefs.theme !== undefined &&
          prefs.theme !== initialTheme()
        ) {
          applyTheme(prefs.theme);
        }
      } catch {
        // Sin preferencias guardadas se queda el tema del dispositivo.
      }

      if (cancelled || !claimDailyPrefetch()) return;
      try {
        await prefetchForOffline(api, { audio: false });
      } catch {
        // La precarga es best-effort; la app sigue funcionando sin red.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, status]);

  return null;
}

function AppRoutes() {
  const { user, status } = useAuth();
  const router = useMemo(() => buildRouter(import.meta.env.BASE_URL), []);

  return (
    <OfflineProvider userId={user?.id ?? ''}>
      {status === 'authenticated' ? <SessionBootstrap /> : null}
      <RouterProvider router={router} />
    </OfflineProvider>
  );
}

// Raíz de la web v2. La v1 sigue montándose desde `App.tsx` hasta CHG-14.
export function AppV2() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
