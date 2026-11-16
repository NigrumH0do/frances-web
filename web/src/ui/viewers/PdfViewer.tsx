// Visor de PDF (Task WEB-06): `PdfDocument` recibe `load`, abre el blob con
// pdf.js y pinta la página actual en un `<canvas>` de forma perezosa
// (IntersectionObserver, con reserva sin observer). Teclado y botones con
// nombre accesible; el número de página se anuncia en texto. La web v1
// envolvía este núcleo con el contenido descifrado (retirado en CHG-16).

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { t } from '../../i18n/es';

GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

function PageCanvas({
  doc,
  pageNumber,
  scale,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === 'undefined',
  );

  useEffect(() => {
    if (visible) {
      return;
    }
    const host = hostRef.current;
    if (host === null || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (canvas === null || cancelled) {
        return;
      }
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, scale, visible]);

  return (
    <div ref={hostRef}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t('pdf.page', { n: pageNumber, total: doc.numPages })}
      />
    </div>
  );
}

// `load` entrega los bytes del PDF. Un cambio de identidad de `load` vuelve a
// cargar el documento.
export function PdfDocument({
  load,
  title,
  initialPage,
}: {
  load: (signal: AbortSignal) => Promise<Blob>;
  title: string;
  initialPage?: number;
}): JSX.Element {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    setDoc(null);
    setFailed(false);
    setPageNumber(1);
    (async () => {
      const blob = await load(controller.signal);
      const data = new Uint8Array(await blob.arrayBuffer());
      const loaded = await getDocument({ data }).promise;
      if (controller.signal.aborted) {
        return;
      }
      setDoc(loaded);
      const start = initialPage ?? 1;
      setPageNumber(start >= 1 && start <= loaded.numPages ? start : 1);
    })().catch(() => {
      if (!controller.signal.aborted) {
        setFailed(true);
      }
    });
    return () => {
      controller.abort();
    };
    // `initialPage` solo cuenta al cargar; cambiarlo no recarga el documento.
  }, [load]);

  if (failed) {
    return <p>{t('att.unavailable')}</p>;
  }

  const total = doc?.numPages ?? 0;

  return (
    <figure>
      <figcaption>{title}</figcaption>
      {doc !== null && (
        <>
          <div className="pdf-toolbar">
            <button
              type="button"
              aria-label={t('pdf.prev')}
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber((n) => Math.max(1, n - 1))}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label={t('pdf.next')}
              disabled={pageNumber >= total}
              onClick={() => setPageNumber((n) => Math.min(total, n + 1))}
            >
              ›
            </button>
            <button
              type="button"
              aria-label={t('pdf.zoomOut')}
              onClick={() =>
                setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))
              }
            >
              −
            </button>
            <button
              type="button"
              aria-label={t('pdf.zoomIn')}
              onClick={() =>
                setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))
              }
            >
              +
            </button>
            <p>{t('pdf.page', { n: pageNumber, total })}</p>
          </div>
          <PageCanvas doc={doc} pageNumber={pageNumber} scale={scale} />
        </>
      )}
    </figure>
  );
}
