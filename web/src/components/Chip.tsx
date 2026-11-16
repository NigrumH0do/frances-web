import type { ReactNode } from 'react';
import { cx } from './cx';

export type ChipTone =
  'neutral' | 'success' | 'warning' | 'danger' | 'level' | 'streak';

const TONE_CLASS: Record<ChipTone, string | false> = {
  neutral: false,
  success: 'chip-success',
  warning: 'chip-warning',
  danger: 'chip-danger',
  level: 'chip-level',
  streak: 'chip-streak',
};

export function Chip({
  tone = 'neutral',
  children,
}: {
  tone?: ChipTone;
  children: ReactNode;
}) {
  return <span className={cx('chip', TONE_CLASS[tone])}>{children}</span>;
}

// Filtro con estado: aria-pressed indica si está activo.
export function FilterChip({
  pressed,
  onPressedChange,
  children,
}: {
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="chip chip-filter"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
    >
      {children}
    </button>
  );
}
