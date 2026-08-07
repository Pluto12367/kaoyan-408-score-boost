import { reasonCopy } from './reason-copy';
import type { ScoreCenterItem } from './types';

interface WhyRecommendedDrawerProps {
  item: ScoreCenterItem | null;
  onClose: () => void;
}

const breakdownLabels: Record<string, string> = {
  examValue: '真题价值',
  weakness: '薄弱度',
  forgetting: '遗忘度',
  difficulty: '难度',
  trend: '趋势',
  pinned: '置顶',
};

export function WhyRecommendedDrawer({ item, onClose }: WhyRecommendedDrawerProps) {
  if (!item) return null;
  const breakdown = item.scoreBreakdown ?? {};
  const reasons = (item.reasonCodes ?? []).map((code) => reasonCopy[code] ?? code);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-label="为什么推荐我学这个">
        <div className="dialog-head">
          <h3>为什么推荐我学这个</h3>
          <button type="button" className="secondary-action" onClick={onClose} aria-label="关闭">关闭</button>
        </div>
        <p className="eyebrow">{item.title}</p>
        <p className="task-status">Priority Score：{item.score ?? 0}</p>
        <ul className="reason-list">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <h4>分数构成</h4>
        <dl className="breakdown-list">
          {Object.entries(breakdownLabels).map(([key, label]) => (
            <div key={key} className="breakdown-row">
              <dt>{label}</dt>
              <dd>{Math.round(breakdown[key] ?? 0)}</dd>
            </div>
          ))}
        </dl>
        <p className="task-status">
          暂无个人做题数据时，当前按中性冷启动值计算，不视为掌握度差。
        </p>
      </section>
    </div>
  );
}
