import { useApi } from '../../api/ApiContext';
import { useResource } from '../../api/useResource';
import { useAuth } from '../../auth/AuthContext';
import { Card, Chip, StateView } from '../../components';
import { AccountSection } from './AccountSection';
import { AdminSlot } from './AdminSlot';
import { ProgressSection } from './ProgressSection';
import { SettingsSection } from './SettingsSection';
import { VoicesSection } from './VoicesSection';
import { masStrings } from './strings';

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

// Pantalla Más: perfil, progreso, ajustes, voces, cuenta, hueco de admin y
// versión del servidor, en ese orden (P09-5).
export function Mas() {
  const api = useApi();
  const { user } = useAuth();
  const stats = useResource('mas-stats', (signal) => api.stats({ signal }));
  const health = useResource('mas-health', (signal) => api.health({ signal }));

  return (
    <div className="stack-lg">
      <h1>{masStrings.title}</h1>

      {user !== null ? (
        <Card>
          <div className="row">
            <span className="lead-icon" aria-hidden="true">
              {initial(user.display_name)}
            </span>
            <div className="grow">
              <p className="title">{user.display_name}</p>
              <p className="small muted">{user.email}</p>
            </div>
            {user.role === 'admin' ? (
              <Chip tone="level">{masStrings.roleAdmin}</Chip>
            ) : null}
          </div>
        </Card>
      ) : null}

      <section className="stack" aria-labelledby="mas-progress-title">
        <div className="section-title">
          <h2 id="mas-progress-title">{masStrings.progress.title}</h2>
        </div>
        <StateView
          state={stats}
          empty={(data) =>
            data.cards_learned === 0 &&
            data.reviews_today === 0 &&
            data.quiz_best.length === 0
          }
          emptyText={masStrings.progress.empty}
          onRetry={stats.reload}
        >
          {(data) => <ProgressSection stats={data} />}
        </StateView>
      </section>

      <SettingsSection />
      <VoicesSection />
      <AccountSection />
      <AdminSlot />

      <section className="stack" aria-labelledby="mas-about-title">
        <div className="section-title">
          <h2 id="mas-about-title">{masStrings.about.title}</h2>
        </div>
        <StateView
          state={health}
          emptyText={masStrings.about.error}
          onRetry={health.reload}
        >
          {(data) => (
            <p className="small muted">
              {masStrings.about.version(data.version)}
            </p>
          )}
        </StateView>
      </section>
    </div>
  );
}

export default Mas;
