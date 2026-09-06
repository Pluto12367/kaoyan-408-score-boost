import { ProgressRing, SurfaceCard, EmptyState } from '../../../components/ui';
import type { TrainingRoomViewModel } from './trainingRoomViewModel';

interface TrainingProgressProps {
  model: TrainingRoomViewModel;
}

export function TrainingProgress({ model }: TrainingProgressProps) {
  if (!model.progress) {
    return (
      <SurfaceCard className="training-room-progress" data-testid="training-room-progress">
        <EmptyState
          title="训练进度暂不可用"
          description="当前训练尚未提供可确认的题目进度。"
        />
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard className="training-room-progress" data-testid="training-room-progress">
      <div className="training-room-progress-heading">
        <div>
          <p className="eyebrow">Training Progress</p>
          <h3>当前进度</h3>
        </div>
        <strong>题库推进 {model.progress.current} / {model.progress.total}</strong>
      </div>
      <div className="training-room-progress-content">
        <ProgressRing
          value={model.progress.percent}
          label={`${model.progress.current}/${model.progress.total}`}
          size={82}
          tone="primary"
          aria-label={`训练进度 ${model.progress.current}/${model.progress.total}`}
        />
        <p>按当前训练顺序继续完成题目，提交和进度仍由现有答题流程负责。</p>
      </div>
    </SurfaceCard>
  );
}
