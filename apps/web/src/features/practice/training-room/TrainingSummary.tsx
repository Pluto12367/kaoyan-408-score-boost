import { CheckCircle2 } from 'lucide-react';
import { GlassCard, EmptyState } from '../../../components/ui';
import { StudentActionCard } from '../../student/actions/StudentActionCard';
import type { StudentAction } from '../../student/actions/studentAction';
import type { TrainingRoomViewModel } from './trainingRoomViewModel';

interface TrainingSummaryProps {
  model: TrainingRoomViewModel;
  onSelectAction: (action: StudentAction) => void;
}

export function TrainingSummary({ model, onSelectAction }: TrainingSummaryProps) {
  const result = model.result;
  if (!result?.completed) return null;
  const structuredActions = result.actions ?? [];

  return (
    <GlassCard className="training-room-summary" tone="accent" data-testid="training-room-summary">
      <div className="training-room-summary-heading">
        <div>
          <p className="eyebrow">Training Summary</p>
          <h3><CheckCircle2 size={18} />训练已完成</h3>
        </div>
        <span>{model.sourceLabel}</span>
      </div>
      <div className="training-room-summary-metrics">
        {result.totalQuestions != null ? <div><strong>{result.totalQuestions}</strong><span>完成题数</span></div> : null}
        {result.correctCount != null ? <div><strong>{result.correctCount}</strong><span>答对题数</span></div> : null}
        {result.accuracyRate != null ? <div><strong>{result.accuracyRate}%</strong><span>正确率</span></div> : null}
      </div>
      {structuredActions.length || result.nextActions.length ? (
        <div className="training-room-summary-actions">
          {structuredActions.length ? (
            <div>
              <strong>下一步行动</strong>
              {structuredActions.map((action) => (
                <StudentActionCard key={action.id} action={action} onSelect={onSelectAction} compact />
              ))}
            </div>
          ) : null}
          {result.nextActions.length ? (
            <div>
              <strong>补充建议</strong>
              <ul>{result.nextActions.map((action) => <li key={action}>{action}</li>)}</ul>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState title="暂无下一步建议" description="可以回到学习空间查看已有计划和复习任务。" />
      )}
    </GlassCard>
  );
}
