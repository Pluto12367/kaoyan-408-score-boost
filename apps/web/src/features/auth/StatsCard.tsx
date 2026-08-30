interface StatsCardProps {
  value: string;
  label: string;
  accent: 'violet' | 'cyan' | 'mint';
}

export function StatsCard({ value, label, accent }: StatsCardProps) {
  return (
    <div className={`auth-stat auth-stat-${accent}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
