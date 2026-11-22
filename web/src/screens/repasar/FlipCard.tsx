import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { Button, Chip } from '../../components';
import { cx } from '../../components/cx';
import type { CardView } from '../../contracts/generated';
import { CardAudio } from '../../media/CardAudio';
import { tr } from '../../l10n/es';
import type { Rating } from '../../srs/types';
import { getMotion3dPref, prefersReducedMotion } from '../../three/motionPref';
import { repasarStrings } from './strings';

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null
  );
}

function hasAudio(card: CardView, field: 'front' | 'example'): boolean {
  return (
    card.audio.some((clip) => clip.field === field) ||
    card.audio_pending.some((pending) => pending.field === field)
  );
}

// Tarjeta de estudio con dos caras. La cara oculta queda fuera del árbol de
// accesibilidad (`aria-hidden`) y no recibe foco ni clics (`inert`). Espacio
// muestra la respuesta solo cuando el foco no está en un campo de texto ni en
// otro control (en un botón, Espacio ya activa el botón).
export function FlipCard({
  card,
  flipped,
  onFlip,
  onSwipeRate,
}: {
  card: CardView;
  flipped: boolean;
  onFlip: () => void;
  onSwipeRate?: (rating: Rating) => void;
}) {
  const personal = card.mine;
  const front = personal?.front_fr ?? card.front_fr;
  const back = personal?.back_es ?? card.back_es;
  const exampleFr = personal?.example_fr ?? card.example_fr;
  const exampleEs = personal?.example_es ?? card.example_es;
  const notes = personal?.notes ?? card.notes;
  const theme = card.tags[0];
  const sourceId = card.source_item_ids[0];
  const sourceTitle =
    sourceId !== undefined
      ? (card.source_titles?.[sourceId] ?? sourceId)
      : undefined;
  const flagged = card.state?.flagged_hard ?? false;
  const tiltRef = useRef<HTMLDivElement>(null);
  const swipeRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const [tilting, setTilting] = useState(false);

  function gestureEnabled(): boolean {
    return !prefersReducedMotion() && getMotion3dPref() !== 'off';
  }

  function handleTiltMove(event: PointerEvent<HTMLDivElement>): void {
    if (event.pointerType !== 'mouse') return;
    if (
      prefersReducedMotion() ||
      getMotion3dPref() === 'off' ||
      tiltRef.current === null
    ) {
      return;
    }
    const rect = tiltRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dx = (event.clientX - rect.left) / rect.width - 0.5;
    const dy = (event.clientY - rect.top) / rect.height - 0.5;
    tiltRef.current.style.setProperty('--rx', `${(-dy * 4).toFixed(2)}deg`);
    tiltRef.current.style.setProperty('--ry', `${(dx * 5).toFixed(2)}deg`);
  }

  function handleTiltEnter(event: PointerEvent<HTMLDivElement>): void {
    if (event.pointerType !== 'mouse') return;
    if (!gestureEnabled() || tiltRef.current === null) return;
    setTilting(true);
  }

  function handleTiltLeave(): void {
    setTilting(false);
    if (tiltRef.current === null) return;
    tiltRef.current.style.setProperty('--rx', '0deg');
    tiltRef.current.style.setProperty('--ry', '0deg');
  }

  function handleSwipeDown(event: PointerEvent<HTMLDivElement>): void {
    if (!gestureEnabled()) return;
    swipeRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    const node = event.currentTarget;
    if (typeof node.setPointerCapture === 'function') {
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        // jsdom no implementa la captura del puntero.
      }
    }
  }

  function dragSwipe(event: PointerEvent<HTMLDivElement>): void {
    const swipe = swipeRef.current;
    if (swipe === null || swipe.pointerId !== event.pointerId) return;
    if (!flipped || tiltRef.current === null) return;
    const dx = event.clientX - swipe.x;
    tiltRef.current.style.setProperty('--swipe-x', `${dx}px`);
  }

  function handleSwipeEnd(event: PointerEvent<HTMLDivElement>): void {
    const swipe = swipeRef.current;
    if (swipe === null || swipe.pointerId !== event.pointerId) return;
    swipeRef.current = null;
    if (!gestureEnabled()) {
      tiltRef.current?.style.setProperty('--swipe-x', '0px');
      return;
    }
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    if (!flipped) {
      if (horizontal && Math.abs(dx) >= 48) onFlip();
      return;
    }
    const width = tiltRef.current?.getBoundingClientRect().width ?? 0;
    const passed = horizontal && width > 0 && Math.abs(dx) >= width * 0.4;
    tiltRef.current?.style.setProperty('--swipe-x', '0px');
    if (!passed) return;
    onSwipeRate?.(dx < 0 ? 1 : 4);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    dragSwipe(event);
    handleTiltMove(event);
  }

  useEffect(() => {
    if (flipped) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (
        (event.key !== ' ' && event.code !== 'Space') ||
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      if (isTextEntry(event.target)) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'button, a, [role="button"], [role="link"], [role="radio"]',
        ) !== null
      ) {
        return;
      }
      event.preventDefault();
      onFlip();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flipped, onFlip]);

  return (
    <>
      <div
        ref={tiltRef}
        className={cx('flip-tilt', tilting && 'is-tilting')}
        onPointerEnter={handleTiltEnter}
        onPointerDown={handleSwipeDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handleSwipeEnd}
        onPointerCancel={handleSwipeEnd}
        onPointerLeave={handleTiltLeave}
      >
        <div className={cx('flip', flipped && 'is-flipped')}>
          <div className="flip-inner">
            <div
              className="flip-face flip-front paper"
              aria-hidden={flipped}
              inert={flipped}
            >
              <div className="row-between">
                <span className="kind">
                  {repasarStrings.kinds[card.kind]}
                  {theme !== undefined ? (
                    <span className="kind-topic" lang="fr">
                      {theme}
                    </span>
                  ) : null}
                </span>
                {flagged ? (
                  <Chip tone="danger">{repasarStrings.hardChip}</Chip>
                ) : null}
              </div>
              <div className="spacer" />
              <p className="front-fr fr" lang="fr">
                {front}
              </p>
              {card.ipa !== null ? (
                <p className="ipa" lang="fr">
                  /{card.ipa}/
                </p>
              ) : null}
              {hasAudio(card, 'front') ? (
                <CardAudio
                  card={card}
                  field="front"
                  slowLabel={repasarStrings.slow}
                />
              ) : null}
              <div className="spacer" />
            </div>

            <div
              className="flip-face flip-back paper"
              aria-hidden={!flipped}
              inert={!flipped}
            >
              <div className="row-between">
                <span className="kind">{repasarStrings.answer}</span>
                {flipped ? (
                  <span className="xs muted">
                    {repasarStrings.kinds[card.kind]}
                    {theme !== undefined ? ` · ${theme}` : ''}
                  </span>
                ) : null}
              </div>
              {flipped ? (
                <div className="flip-recap">
                  <div className="flip-recap-head">
                    <p className="flip-recap-fr fr" lang="fr">
                      {front}
                    </p>
                    {card.ipa !== null ? (
                      <p className="flip-recap-ipa" lang="fr">
                        /{card.ipa}/
                      </p>
                    ) : null}
                  </div>
                  {hasAudio(card, 'front') ? (
                    <CardAudio
                      card={card}
                      field="front"
                      slowLabel={repasarStrings.slow}
                    />
                  ) : null}
                </div>
              ) : null}
              <p className="back-es">{back}</p>
              {exampleFr !== null ||
              exampleEs !== null ||
              hasAudio(card, 'example') ? (
                <div className="flip-block">
                  <span className="flip-label">
                    {repasarStrings.exampleLabel}
                  </span>
                  {exampleFr !== null ? (
                    <p className="example fr" lang="fr">
                      {exampleFr}
                    </p>
                  ) : null}
                  {exampleEs !== null ? (
                    <p className="example flip-example-es">{exampleEs}</p>
                  ) : null}
                  {hasAudio(card, 'example') ? (
                    <CardAudio
                      card={card}
                      field="example"
                      slowLabel={repasarStrings.slow}
                    />
                  ) : null}
                </div>
              ) : null}
              {notes !== null && notes !== '' ? (
                <div className="flip-note">
                  <span className="flip-label">{repasarStrings.noteLabel}</span>
                  <p className="small">{notes}</p>
                </div>
              ) : null}
              <div className="spacer" />
              {sourceId !== undefined && sourceTitle !== undefined ? (
                <p className="xs muted">
                  <Link to={`/publicaciones/${encodeURIComponent(sourceId)}`}>
                    {tr(repasarStrings.source, { title: sourceTitle })}
                  </Link>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {!flipped ? (
        <Button
          variant="primary"
          size="lg"
          block
          className="show-answer"
          onClick={onFlip}
        >
          {repasarStrings.showAnswer}
        </Button>
      ) : null}
    </>
  );
}
