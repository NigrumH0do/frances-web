import { cx } from './cx';

// Bloque de carga. Tamaño, gradiente y movimiento reducido vienen de design/components.css.
export function Skeleton({
  variant = 'line',
}: {
  variant?: 'title' | 'line' | 'block';
}) {
  return (
    <span
      className={cx('skeleton', `skeleton-${variant}`)}
      aria-hidden="true"
    />
  );
}
