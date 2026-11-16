import { Link } from 'react-router';
import { Icon, type IconName } from '../components';
import { tr } from '../l10n/es';
import { shellStrings } from './strings';

export type TabId = 'hoy' | 'temas' | 'repasar' | 'chat' | 'mas';

interface TabDef {
  id: TabId;
  to: string;
  icon: IconName;
}

const TABS: readonly TabDef[] = [
  { id: 'hoy', to: '/', icon: 'hoy' },
  { id: 'temas', to: '/temas', icon: 'temas' },
  { id: 'repasar', to: '/repasar', icon: 'repasar' },
  { id: 'chat', to: '/chat', icon: 'chat' },
  { id: 'mas', to: '/mas', icon: 'mas' },
];

// Barra inferior fija del shell v2: cinco destinos con icono y texto. La
// sección activa se marca con `aria-current` (el color nunca va solo).
export function TabBar({
  active,
  badges,
}: {
  active: TabId;
  badges?: Partial<Record<TabId, number>>;
}) {
  return (
    <nav className="tabbar" aria-label={shellStrings.navLabel}>
      <div className="tabbar-brand" aria-hidden="true">
        {shellStrings.brand}
        <small>{shellStrings.brandSub}</small>
      </div>
      {TABS.map((tab) => {
        const badge = badges?.[tab.id];
        return (
          <Link
            key={tab.id}
            to={tab.to}
            aria-current={active === tab.id ? 'page' : undefined}
          >
            <span className="pill">
              <Icon name={tab.icon} />
            </span>
            <span>{shellStrings.tabs[tab.id]}</span>
            {badge !== undefined && badge > 0 ? (
              <span
                className="tab-count"
                aria-label={tr(shellStrings.reviewBadge, { n: badge })}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
