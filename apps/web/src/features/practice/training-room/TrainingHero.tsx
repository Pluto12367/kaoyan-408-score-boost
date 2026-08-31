import { Clock3, Target } from 'lucide-react';
import { GlassCard } from '../../../components/ui';
import type { TrainingRoomViewModel } from './trainingRoomViewModel';

interface TrainingHeroProps {
  model: TrainingRoomViewModel;
}

export function TrainingHero({ model }: TrainingHeroProps) {
  return (
    <GlassCard className="training-room-hero" tone="accent" data-testid="training-room-hero">
      <div className="training-room-hero-copy">
        <p className="eyebrow">Training Room</p>
        <h2>{model.title}</h2>
        <p>保持专注，完成这一轮训练，把当前知识点练得更稳。</p>
      </div>
      <div className="training-room-context" aria-label="训练上下文">
        <span><Target size={15} />{model.sourceLabel}</span>
        <strong>{model.target}</strong>
        <span>
          <Clock3 size={15} />
          {model.estimatedMinutes == null ? '暂无预计时长' : `预计 ${model.estimatedMinutes} 分钟`}
        </span>
      </div>
    </GlassCard>
  );
}
