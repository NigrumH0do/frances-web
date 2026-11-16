import { useState } from 'react';
import { useOffline } from '../offline/OfflineContext';
import type { FlushResult } from '../offline/outbox';
import { Button, Icon } from '../components';
import { tr } from '../l10n/es';
import { shellStrings } from './strings';

// Franja de estado de la conexión. Mientras no hay red avisa de que se ve lo
// guardado; si hay cambios en cola, dice cuántos; y tras un flush con descartes
// o conflictos muestra un aviso que se puede cerrar.
export function OfflineBanner() {
  const { online, pending, lastFlush } = useOffline();
  const [dismissed, setDismissed] = useState<FlushResult | null>(null);

  if (!online) {
    return (
      <p className="callout info" role="status">
        <Icon name="offline" />
        <span className="grow">
          {shellStrings.offline}
          {pending > 0 ? ` ${tr(shellStrings.pending, { n: pending })}` : ''}
        </span>
      </p>
    );
  }

  if (pending > 0) {
    return (
      <p className="callout info" role="status">
        <Icon name="offline" />
        <span className="grow">{shellStrings.syncing}</span>
      </p>
    );
  }

  const failures =
    lastFlush === null ? 0 : lastFlush.dropped + lastFlush.conflicts;

  if (failures > 0 && lastFlush !== null && dismissed !== lastFlush) {
    return (
      <div className="callout error" role="alert">
        <Icon name="alert" />
        <p className="grow">{tr(shellStrings.flushFailed, { n: failures })}</p>
        <Button variant="secondary" onClick={() => setDismissed(lastFlush)}>
          {shellStrings.dismiss}
        </Button>
      </div>
    );
  }

  return null;
}
