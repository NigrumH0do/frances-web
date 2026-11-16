import { Link } from 'react-router';
import { repasarStrings } from './strings';

export type ReviewTabId = 'tarjetas' | 'pronunciacion' | 'texto';

// Pestañas de Repasar con el aspecto de `Segmented`, pero como enlaces para
// que la ruta de pronunciación sea compartible. Lo reusa UI-16.
export function ReviewTabs({ active }: { active: ReviewTabId }) {
  return (
    <nav className="segmented" aria-label={repasarStrings.tabsLabel}>
      <Link
        to="/repasar"
        aria-current={active === 'tarjetas' ? 'true' : undefined}
      >
        {repasarStrings.tabs.tarjetas}
      </Link>
      <Link
        to="/repasar/pronunciacion"
        aria-current={active === 'pronunciacion' ? 'true' : undefined}
      >
        {repasarStrings.tabs.pronunciacion}
      </Link>
      <Link
        to="/repasar/texto"
        aria-current={active === 'texto' ? 'true' : undefined}
      >
        {repasarStrings.tabs.texto}
      </Link>
    </nav>
  );
}
