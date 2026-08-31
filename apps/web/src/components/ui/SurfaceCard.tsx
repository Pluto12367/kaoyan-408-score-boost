import type { HTMLAttributes } from 'react';

export interface SurfaceCardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'default' | 'subtle';
}

export function SurfaceCard({ tone = 'default', className = '', ...props }: SurfaceCardProps) {
  return <div {...props} className={`ui-card ui-surface-card ui-surface-card-${tone} ${className}`.trim()} />;
}
