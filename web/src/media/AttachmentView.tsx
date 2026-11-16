import { useCallback } from 'react';
import type { JSX } from 'react';
import { useApi } from '../api/ApiContext';
import { Icon } from '../components/Icon';
import type {
  AttachmentView as AttachmentViewData,
  FileLink,
} from '../contracts/generated';
import { BlobImage } from '../ui/viewers/ImageViewer';
import { PdfDocument } from '../ui/viewers/PdfViewer';

type AttachmentKind = AttachmentViewData['kind'];
type AttachmentStatus = AttachmentViewData['status'];

const UNAVAILABLE_REASON: Partial<Record<AttachmentStatus, string>> = {
  pending: 'Todavía se está descargando',
  skipped_too_large: 'El archivo es demasiado grande',
  forbidden: 'Sin permiso para descargarlo',
  not_found: 'El archivo ya no está disponible',
  error: 'No se pudo descargar',
};

const LINK_LABEL: Record<AttachmentKind, string> = {
  drive_file: 'Abrir enlace',
  link: 'Abrir enlace',
  youtube: 'Abrir en YouTube',
  form: 'Abrir formulario',
};

function pdfLink(att: AttachmentViewData): FileLink | null {
  if (att.view_pdf !== null) {
    return att.view_pdf;
  }
  if (att.file !== null && att.file.mime === 'application/pdf') {
    return att.file;
  }
  return null;
}

function Unavailable({
  title,
  reason,
}: {
  title: string;
  reason: string;
}): JSX.Element {
  return (
    <div>
      <p>{title}</p>
      <p className="muted small">{`No disponible: ${reason}`}</p>
    </div>
  );
}

// Adjunto v2: PDF e imagen se piden con la URL del `FileLink` que manda la API
// (SRV-08); enlaces, vídeos y Drive sin archivo se abren fuera de la app.
export function AttachmentBlock({
  att,
  initialPage,
}: {
  att: AttachmentViewData;
  initialPage?: number;
}): JSX.Element {
  const api = useApi();
  const pdf = pdfLink(att);
  const image =
    att.file !== null && att.file.mime.startsWith('image/') ? att.file : null;
  const pdfUrl = pdf?.url;
  const imageUrl = image?.url;

  const loadPdf = useCallback(
    (signal: AbortSignal): Promise<Blob> => {
      if (pdfUrl === undefined) {
        return Promise.reject(new Error('sin PDF'));
      }
      return api.client.blob(pdfUrl, { signal });
    },
    [api, pdfUrl],
  );
  const loadImage = useCallback(
    (signal: AbortSignal): Promise<Blob> => {
      if (imageUrl === undefined) {
        return Promise.reject(new Error('sin imagen'));
      }
      return api.client.blob(imageUrl, { signal });
    },
    [api, imageUrl],
  );

  const reason = UNAVAILABLE_REASON[att.status];
  if (reason !== undefined) {
    return <Unavailable title={att.title ?? 'Adjunto'} reason={reason} />;
  }

  if (pdf !== null) {
    return (
      <PdfDocument
        load={loadPdf}
        title={att.title ?? 'Documento'}
        initialPage={initialPage}
      />
    );
  }

  if (image !== null) {
    return <BlobImage load={loadImage} alt={att.title ?? 'Imagen'} />;
  }

  if (att.url !== null) {
    const label = LINK_LABEL[att.kind];
    return (
      <a
        className="list-item"
        href={att.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="lead-icon">
          <Icon name="external" />
        </span>
        <span className="grow">
          <span className="title">{att.title ?? label}</span>
          {att.title !== null ? (
            <>
              <br />
              <span className="meta">{label}</span>
            </>
          ) : null}
        </span>
      </a>
    );
  }

  return (
    <Unavailable
      title={att.title ?? 'Adjunto'}
      reason="No hay una vista disponible"
    />
  );
}
