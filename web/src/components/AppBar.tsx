import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { common } from '../l10n/es';
import { Icon } from './Icon';

export function AppBar({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle?: string;
  back?: { to: string; label?: string };
  actions?: ReactNode;
}) {
  return (
    <header className="appbar">
      {back ? (
        <Link
          to={back.to}
          className="btn btn-ghost btn-icon"
          aria-label={back.label ?? common.back}
        >
          <Icon name="back" />
        </Link>
      ) : null}
      <div className="appbar-titles">
        <h1>{title}</h1>
        {subtitle ? <span className="sub">{subtitle}</span> : null}
      </div>
      {actions}
    </header>
  );
}
