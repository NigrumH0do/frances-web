import { useAuth } from '../auth/AuthContext';
import { Card, ListItem } from '../components';
import {
  ADMIN_SCREENS,
  adminModules,
  adminNavStrings,
  type AdminModules,
} from './adminNav';

// Hueco de administración que monta AdminSlot (UI-19). El rol viene de
// `/api/auth/me`; este componente no pinta el encabezado «Administración»
// porque AdminSlot ya lo hace. Solo lista las pantallas cuyo módulo existe.
export function AdminSection({
  modules = adminModules(),
}: {
  modules?: AdminModules;
}) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return null;

  const screens = ADMIN_SCREENS.filter(
    (screen) => modules[screen.file] !== undefined,
  );

  return (
    <Card>
      {screens.length === 0 ? (
        <p className="small muted">{adminNavStrings.empty}</p>
      ) : (
        <nav aria-label={adminNavStrings.title}>
          <ul className="list">
            {screens.map((screen) => (
              <li key={screen.path}>
                <ListItem
                  to={`/mas/admin/${screen.path}`}
                  title={screen.title}
                />
              </li>
            ))}
          </ul>
        </nav>
      )}
    </Card>
  );
}

export default AdminSection;
