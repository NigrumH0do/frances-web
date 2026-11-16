// Visor de imágenes (Task WEB-06): `BlobImage` recibe `load`, muestra el blob
// con una object URL y la revoca al desmontar o al cambiar de archivo. La web
// v1 envolvía este núcleo con el contenido descifrado (retirado en CHG-16).

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { t } from '../../i18n/es';

export function BlobImage({
  load,
  alt,
}: {
  load: (signal: AbortSignal) => Promise<Blob>;
  alt: string;
}): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    (async () => {
      const blob = await load(controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    })().catch(() => {
      if (!controller.signal.aborted) {
        setFailed(true);
      }
    });
    return () => {
      controller.abort();
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [load]);

  if (failed) {
    return <p>{t('att.unavailable')}</p>;
  }
  if (url === null) {
    return <p role="status">{t('app.loading')}</p>;
  }
  return <img src={url} alt={alt} />;
}
