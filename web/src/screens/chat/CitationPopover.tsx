import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { Link } from 'react-router';
import type { Citation } from '../../contracts/generated';
import { tr } from '../../l10n/es';
import { chatStrings } from './strings';

export function citationHref(citation: Citation): string {
  const params = new URLSearchParams();
  if (citation.page !== null && citation.page !== undefined) {
    params.set('pagina', String(citation.page));
  }
  params.set('adjunto', citation.source);
  const query = params.toString();
  return `/publicaciones/${encodeURIComponent(citation.item_id)}${
    query === '' ? '' : `?${query}`
  }`;
}

function finePointer(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

function pointerTypeOf(event: MouseEvent<HTMLAnchorElement>): string {
  if ('pointerType' in event && typeof event.pointerType === 'string') {
    return event.pointerType;
  }
  const native = event.nativeEvent as Event & { pointerType?: string };
  return typeof native.pointerType === 'string' ? native.pointerType : '';
}

/**
 * Vista previa no modal de una cita `[n]`. El enlace marcado se conserva;
 * en táctil el primer toque abre el diálogo y el enlace interior navega.
 */
export function CitationPopover({
  citation,
  number,
}: {
  citation: Citation;
  number: number;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const dialogRef = useRef<HTMLSpanElement>(null);
  const markerRef = useRef<HTMLAnchorElement>(null);
  const armedTouch = useRef(false);
  const suppressFocusOpen = useRef(false);
  const titleId = useId();
  const href = citationHref(citation);
  const title =
    citation.item_title !== undefined &&
    citation.item_title !== null &&
    citation.item_title !== ''
      ? citation.item_title
      : undefined;
  const label = title ?? tr(chatStrings.citation, { n: number });

  function closeToMarker(): void {
    const marker = markerRef.current;
    const needsMove = marker !== null && document.activeElement !== marker;
    if (needsMove) suppressFocusOpen.current = true;
    setOpen(false);
    if (needsMove) marker.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeToMarker();
    }
    function onFocusIn(event: FocusEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (dialogRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  function onMarkerFocus(): void {
    if (suppressFocusOpen.current) {
      suppressFocusOpen.current = false;
      return;
    }
    setOpen(true);
  }

  function onPointerDown(event: PointerEvent<HTMLAnchorElement>): void {
    armedTouch.current = event.pointerType === 'touch';
  }

  function onMarkerClick(event: MouseEvent<HTMLAnchorElement>): void {
    const touch = pointerTypeOf(event) === 'touch' || armedTouch.current;
    armedTouch.current = false;
    if (!touch) return;
    event.preventDefault();
    setOpen(true);
  }

  return (
    <span
      className="cite-pop"
      ref={rootRef}
      onMouseEnter={() => {
        if (finePointer()) setOpen(true);
      }}
      onMouseLeave={() => {
        if (finePointer()) setOpen(false);
      }}
    >
      <Link
        ref={markerRef}
        to={href}
        className="cite"
        aria-label={tr(chatStrings.citation, { n: number })}
        onFocus={onMarkerFocus}
        onPointerDown={onPointerDown}
        onClick={onMarkerClick}
      >
        {number}
      </Link>
      {open ? (
        <span
          ref={dialogRef}
          role="dialog"
          className="cite-dialog"
          aria-modal="false"
          aria-labelledby={title === undefined ? undefined : titleId}
          aria-label={title === undefined ? label : undefined}
        >
          {title !== undefined ? (
            <span id={titleId} className="cite-dialog-title">
              {title}
            </span>
          ) : null}
          {citation.page !== null && citation.page !== undefined ? (
            <span className="cite-dialog-page">
              {tr(chatStrings.popoverPage, { page: citation.page })}
            </span>
          ) : null}
          <span className="cite-dialog-snippet">{citation.snippet}</span>
          <Link to={href}>{chatStrings.openCitation}</Link>
        </span>
      ) : null}
    </span>
  );
}
