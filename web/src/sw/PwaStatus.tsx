// Aviso de versión nueva de la PWA (Task WEB-12, CHG-15; CHG-16 retiró el
// banner «sin conexión» de la web v1, que ahora vive en `shell/OfflineBanner`).
//
// `UpdatePrompt` recibe el estado de `useRegisterSW` por props y muestra solo
// el aviso con el botón «Actualizar». No renderiza nada cuando no hay versión
// nueva.

import { useCallback } from 'react';
import type { JSX } from 'react';
import { t } from '../i18n/es';

export type UpdatePromptProps = {
  needRefresh: boolean;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
};

export function UpdatePrompt({
  needRefresh,
  updateServiceWorker,
}: UpdatePromptProps): JSX.Element | null {
  const update = useCallback((): void => {
    void updateServiceWorker(true);
  }, [updateServiceWorker]);

  if (!needRefresh) {
    return null;
  }
  return (
    <p role="status">
      {t('pwa.update')}{' '}
      <button type="button" onClick={update}>
        {t('pwa.reload')}
      </button>
    </p>
  );
}
