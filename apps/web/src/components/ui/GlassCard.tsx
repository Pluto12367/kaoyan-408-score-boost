import type { HTMLAttributes } from 'react';

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'default' | 'accent';
}

export function GlassCard({ tone = 'default', className = '', ...props }: GlassCardProps) {
  return <div {...props} className={`ui-card ui-glass-card ui-glass-card-${tone} ${className}`.trim()} />;
}
