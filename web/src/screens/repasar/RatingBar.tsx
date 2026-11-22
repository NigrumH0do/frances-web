import { useEffect } from 'react';
import type { Rating } from '../../srs/types';
import { repasarStrings } from './strings';

const TONES: Record<Rating, string> = {
  1: 'again',
  2: 'hard',
  3: 'good',
  4: 'easy',
};

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

function RatingGlyph({ rating }: { rating: Rating }) {
  const shared = {
    'aria-hidden': true as const,
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (rating) {
    case 1:
      return (
        <svg {...shared}>
          <path d="M4.5 13a7.5 7.5 0 1 0 2-5.5" />
          <path d="M4.5 4.5V9H9" />
        </svg>
      );
    case 2:
      return (
        <svg {...shared}>
          <rect x="9" y="5" width="6" height="14" rx="1.5" />
        </svg>
      );
    case 3:
      return (
        <svg {...shared}>
          <path d="M5 12.5 10 17.5 19 7" />
        </svg>
      );
    case 4:
      return (
        <svg {...shared}>
          <path d="M2.5 12.5 7 17l6.5-8" />
          <path d="M10 12.5 14.5 17 22 7" />
        </svg>
      );
  }
}

function ratingFromKey(key: string): Rating | null {
  switch (key) {
    case '1':
      return 1;
    case '2':
      return 2;
    case '3':
      return 3;
    case '4':
      return 4;
    default:
      return null;
  }
}

// Cuatro calificaciones con su intervalo en texto. Los atajos 1–4 solo
// actúan fuera de campos de texto; la barra se monta cuando ya se volteó la
// tarjeta, así que con la respuesta oculta no hay atajos activos.
export function RatingBar({
  intervals,
  onRate,
}: {
  intervals: Record<Rating, string>;
  onRate: (rating: Rating) => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      if (isTextEntry(event.target)) return;
      const rating = ratingFromKey(event.key);
      if (rating === null) return;
      event.preventDefault();
      onRate(rating);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onRate]);

  return (
    <div
      className="rating"
      role="group"
      aria-label={repasarStrings.ratingLabel}
    >
      {([1, 2, 3, 4] as const).map((rating) => (
        <button
          key={rating}
          type="button"
          className={`btn ${TONES[rating]}`}
          aria-keyshortcuts={String(rating)}
          onClick={() => onRate(rating)}
        >
          <span className="rating-name">
            <RatingGlyph rating={rating} />
            {repasarStrings.ratings[rating]}
          </span>
          <small>{intervals[rating]}</small>
        </button>
      ))}
    </div>
  );
}
