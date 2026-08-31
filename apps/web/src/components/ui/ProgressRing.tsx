import type { CSSProperties, HTMLAttributes } from 'react';

export interface ProgressRingProps extends HTMLAttributes<HTMLDivElement> {
  value: number | null;
  label?: string;
  size?: number;
  strokeWidth?: number;
  tone?: 'primary' | 'teal' | 'success' | 'warning';
}

function clampProgress(value: number | null) {
  return value == null ? null : Math.min(100, Math.max(0, value));
}

export function ProgressRing({
  value,
  label,
  size = 72,
  strokeWidth = 6,
  tone = 'primary',
  className = '',
  ...props
}: ProgressRingProps) {
  const normalizedValue = clampProgress(value);
  const radius = (64 - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = normalizedValue == null
    ? circumference * 0.75
    : circumference - (normalizedValue / 100) * circumference;
  const accessibleLabel = label ?? (normalizedValue == null ? '暂无进度数据' : `完成度 ${normalizedValue}%`);
  const style = { width: size, height: size } as CSSProperties;

  return (
    <div
      {...props}
      className={`ui-progress-ring ui-progress-ring-${tone} ${normalizedValue == null ? 'is-unknown' : ''} ${className}`.trim()}
      style={{ ...style, ...props.style }}
      role="progressbar"
      aria-label={accessibleLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(normalizedValue == null ? {} : { 'aria-valuenow': normalizedValue })}
    >
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <circle className="ui-progress-ring-track" cx="32" cy="32" r={radius} strokeWidth={strokeWidth} />
        <circle
          className="ui-progress-ring-value"
          cx="32"
          cy="32"
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className="ui-progress-ring-label">{label ?? (normalizedValue == null ? '—' : `${normalizedValue}%`)}</span>
    </div>
  );
}
