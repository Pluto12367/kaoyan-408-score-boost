import { AlertTriangle, CalendarCheck, ClipboardList } from 'lucide-react';
import { GlassCard } from '../../../components/ui';

interface ReviewHeroProps {
  todayDueCount: number;
  overdueCount: number;
  pendingCount: number;
  dueLoading: boolean;
}

export function ReviewHero({ todayDueCount, overdueCount, pendingCount, dueLoading }: ReviewHeroProps) {
  return (
    <GlassCard className="review-center-hero" tone="accent" data-testid="review-center-hero">
      <div className="review-center-hero-copy">
        <p className="eyebrow">Smart Review Center</p>
        <h2>恢复正在遗忘的知识</h2>
        <p>把今天最值得处理的错题、到期复习和薄弱知识集中到一个清晰的恢复路径里。</p>
      </div>
      <div className="review-center-hero-metrics" aria-label="复习状态概览">
        <div>
          <CalendarCheck size={17} aria-hidden="true" />
          <span>今日到期</span>
          <strong>{dueLoading ? '…' : todayDueCount}</strong>
        </div>
        <div>
          <AlertTriangle size={17} aria-hidden="true" />
          <span>已逾期</span>
          <strong>{dueLoading ? '…' : overdueCount}</strong>
        </div>
        <div>
          <ClipboardList size={17} aria-hidden="true" />
          <span>待复盘错题</span>
          <strong>{pendingCount}</strong>
        </div>
      </div>
    </GlassCard>
  );
}
