import type { StudentAction } from './studentAction';

export interface StudentActionCardProps {
  action: StudentAction;
  onSelect: (action: StudentAction) => void;
  compact?: boolean;
}

export function StudentActionCard({ action, onSelect, compact = false }: StudentActionCardProps) {
  return (
    <section className={`student-action-card${compact ? ' student-action-card--compact' : ''}`} data-testid="student-action-card">
      <p className="student-action-card__source">来源：{action.source}</p>
      <h3>{action.title}</h3>
      {action.reason ? (
        <p className="student-action-card__reason">{action.reason}</p>
      ) : null}
      <button type="button" onClick={() => onSelect(action)}>开始行动</button>
    </section>
  );
}
