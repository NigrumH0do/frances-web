import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon';

export interface ListItemProps {
  to?: string;
  onClick?: () => void;
  lead?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  // Por omisión, una flecha si la fila es interactiva.
  trail?: ReactNode;
}

// Fila de lista. Sin `to` ni `onClick` se renderiza como texto, no como control.
export function ListItem({
  to,
  onClick,
  lead,
  title,
  meta,
  trail,
}: ListItemProps) {
  const interactive = to !== undefined || onClick !== undefined;
  const content = (
    <>
      {lead ? <span className="lead-icon">{lead}</span> : null}
      <span className="grow">
        <span className="title">{title}</span>
        {meta ? (
          <>
            <br />
            <span className="meta">{meta}</span>
          </>
        ) : null}
      </span>
      {trail ?? (interactive ? <Icon name="chevron" /> : null)}
    </>
  );
  if (to !== undefined) {
    return (
      <Link to={to} className="list-item">
        {content}
      </Link>
    );
  }
  if (onClick !== undefined) {
    return (
      <button type="button" className="list-item" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="list-item">{content}</div>;
}
