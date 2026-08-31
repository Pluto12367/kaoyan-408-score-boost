import type { HTMLAttributes, ReactNode } from 'react';

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action, className = '', ...props }: EmptyStateProps) {
  return (
    <div {...props} className={`ui-empty-state ${className}`.trim()} role="status">
      {icon ? <div className="ui-empty-state-icon" aria-hidden="true">{icon}</div> : null}
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action ? <div className="ui-empty-state-action">{action}</div> : null}
    </div>
  );
}
