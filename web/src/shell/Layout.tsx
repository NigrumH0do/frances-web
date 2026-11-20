import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useMatches } from 'react-router';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useApi } from '../api/ApiContext';
import { useResource } from '../api/useResource';
import { UpdatePrompt } from '../sw/PwaStatus';
import { OfflineBanner } from './OfflineBanner';
import { RouteFocus } from './RouteFocus';
import { TabBar, type TabId } from './TabBar';
import { shellStrings } from './strings';
import './shell.css';

interface ShellHandle {
  tab?: TabId;
  title?: string;
}

function currentHandle(
  matches: ReturnType<typeof useMatches>,
): ShellHandle | undefined {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index]?.handle as ShellHandle | undefined;
    if (handle?.title !== undefined) return handle;
  }
  return undefined;
}

// Marco de la app v2: enlace de salto, contenido, barra inferior y avisos de
// conexión y versión nueva. Solo se monta dentro de `RequireSession`.
export function Layout() {
  const api = useApi();
  const location = useLocation();
  const matches = useMatches();
  const handle = currentHandle(matches);
  const title = handle?.title ?? shellStrings.notFound.title;
  const active = handle?.tab ?? 'hoy';
  const wide =
    location.pathname.startsWith('/publicacion') ||
    location.pathname.startsWith('/mas/admin') ||
    location.pathname.startsWith('/admin');

  const stats = useResource('stats', (signal) => api.stats({ signal }));
  const reloadStats = useRef(stats.reload);
  reloadStats.current = stats.reload;

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reloadStats.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  return (
    <div className="shell">
      <a className="shell-skip" href="#main">
        {shellStrings.skip}
      </a>

      <div className="shell-main">
        <OfflineBanner />
        <main
          id="main"
          className={wide ? 'content content-wide' : 'content'}
          tabIndex={-1}
        >
          <div key={location.pathname} className="route-enter">
            <Outlet />
          </div>
        </main>
        <UpdatePrompt
          needRefresh={needRefresh}
          updateServiceWorker={updateServiceWorker}
        />
      </div>

      <div className="shell-tabbar">
        <TabBar
          active={active}
          badges={
            stats.status === 'ready'
              ? { repasar: stats.data.due_now }
              : undefined
          }
        />
      </div>

      <RouteFocus title={title} />
    </div>
  );
}
