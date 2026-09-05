import { BarChart3 } from 'lucide-react';
import type { DashboardViewModel } from '../useDashboardViewModel';

export function LearningTrend({ model }: { model: DashboardViewModel }) {
  const points = model.trend.length ? model.trend : [{ label: '--', value: 0, practiceCount: 0, active: false }];
  const max = Math.max(...points.map((point) => point.value), 1);
  const reviewCount = model.reviewDueCount ?? model.pendingWrongCount;
  const accuracy = model.practiceAccuracy == null ? '--' : `${model.practiceAccuracy}%`;
  const volume = model.practiceVolume == null ? '--' : model.practiceVolume;
  return <section className="dashboard-section dashboard-trend-section" aria-label="最近学习趋势">
    <div className="dashboard-section-heading"><div><span className="dashboard-kicker">Learning Trend</span><h3>最近 7 天</h3></div><span className="dashboard-trend-note"><BarChart3 size={15} /> 练习活动</span></div>
    <div className="dashboard-bars" aria-label="最近七天练习活动趋势">{points.map((point) => <div className="dashboard-bar-column" key={point.label}><span style={{ height: `${Math.max(point.value ? (point.value / max) * 100 : 4, 4)}%` }} className={point.active ? 'is-active' : ''} title={`${point.label} · ${point.practiceCount} 次练习`} /><small>{point.label}</small></div>)}</div>
    <div className="dashboard-trend-footer"><span><strong>{reviewCount ?? '--'}</strong> 道复习待处理</span><span><strong>{model.reviewOverdueCount ?? '--'}</strong> 道逾期复习</span><span><strong>{accuracy}</strong> 近 7 日正确率</span><span><strong>{volume}</strong> 近 7 日练习</span></div>
  </section>;
}
