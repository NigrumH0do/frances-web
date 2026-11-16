import type { ReactNode } from 'react';
import { cx } from './cx';

export function Card({
  accent = false,
  tight = false,
  children,
}: {
  accent?: boolean;
  tight?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx('card', accent && 'card-accent', tight && 'card-tight')}>
      {children}
    </div>
  );
}
