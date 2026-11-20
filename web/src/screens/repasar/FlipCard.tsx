import { useEffect, useRef, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { Button, Chip } from '../../components';
import { cx } from '../../components/cx';
import type { CardView } from '../../contracts/generated';
import { CardAudio } from '../../media/CardAudio';
import { tr } from '../../l10n/es';
import { prefersReducedMotion } from '../../three/motionPref';
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
}: {
  card: CardView;
  flipped: boolean;
  onFlip: () => void;
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

  function handleTiltMove(event: PointerEvent<HTMLDivElement>): void {
    if (prefersReducedMotion() || tiltRef.current === null) return;
    const rect = tiltRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dx = (event.clientX - rect.left) / rect.width - 0.5;
    const dy = (event.clientY - rect.top) / rect.height - 0.5;
    tiltRef.current.style.setProperty('--rx', `${(-dy * 4).toFixed(2)}deg`);
    tiltRef.current.style.setProperty('--ry', `${(dx * 5).toFixed(2)}deg`);
  }

  function handleTiltLeave(): void {
    if (tiltRef.current === null) return;
    tiltRef.current.style.setProperty('--rx', '0deg');
    tiltRef.current.style.setProperty('--ry', '0deg');
  }

  useEffect(() => {
    if (flipped) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key !== ' ' ||
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
        className="flip-tilt"
        onPointerMove={handleTiltMove}
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
                <CardAudio card={card} field="front" />
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
                    <CardAudio card={card} field="front" />
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
                    <CardAudio card={card} field="example" />
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
