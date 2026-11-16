import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export type ButtonVariant =
  'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant;
  size?: 'md' | 'lg';
  block?: boolean;
  icon?: IconName;
  // Muestra spinner y aria-busy. No deshabilita el botón, pero ignora nuevos clics.
  busy?: boolean;
}

export function Button({
  variant,
  size = 'md',
  block,
  icon,
  busy,
  type = 'button',
  onClick,
  className,
  children,
  ...rest
}: ButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }
  return (
    <button
      {...rest}
      type={type}
      className={cx(
        'btn',
        `btn-${variant}`,
        size === 'lg' && 'btn-lg',
        block && 'btn-block',
        className,
      )}
      aria-busy={busy || undefined}
      onClick={handleClick}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {icon && !busy ? <Icon name={icon} size="sm" /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<
  ButtonProps,
  'children' | 'icon' | 'variant'
> {
  label: string;
  icon: IconName;
  variant?: ButtonVariant;
}

// Botón solo con icono. El nombre accesible es obligatorio.
export function IconButton({
  label,
  icon,
  variant = 'secondary',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <Button
      {...rest}
      variant={variant}
      className={cx('btn-icon', className)}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} />
    </Button>
  );
}
