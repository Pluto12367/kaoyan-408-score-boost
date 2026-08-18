import type { LearningProfile } from '../../api';
import { ModuleResourceMeta, ModuleUnavailable } from '../../components/ModuleResourceState';
import type { ModuleResource } from '../../hooks/moduleResource';

export function LearningProfileCard({ profile, onRetry }: { profile: ModuleResource<LearningProfile>; onRetry: () => void }) {
  if (!profile.data) return <ModuleUnavailable title="学习画像" resource={profile} onRetry={onRetry} />;
  const data = profile.data;
  const topWeak = data.insights.weakPoints[0];
  const topSpeedRisk = data.insights.speedRisks[0];

  return (
    <section className="panel learning-profile-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">学习画像</p>
          <h3>{data.summary.name} 的个性化提分状态</h3>
        </div>
        <span className={`profile-state profile-state-${data.insights.learningState}`}>{data.insights.learningState}</span>
      </div>
      <ModuleResourceMeta resource={profile} onRetry={onRetry} />
      <div className="profile-grid">
        <article><strong>{data.summary.accuracyRate}%</strong><span>综合正确率</span></article>
        <article><strong>{data.summary.streakDays}</strong><span>连续学习天数</span></article>
        <article><strong>{data.loopStats.wrongQuestionCount}</strong><span>待处理错题</span></article>
        <article><strong>{data.loopStats.reviewedWrongQuestionCount}</strong><span>已复盘错题</span></article>
      </div>
      <p className="task-status">{data.insights.stateReason}</p>
      <div className="profile-insight-list">
        {topWeak ? <article><strong>最弱点</strong><span>{topWeak.title} · {topWeak.suggestion}</span></article> : null}
        {topSpeedRisk ? <article><strong>速度风险</strong><span>{topSpeedRisk.title} · 建议限时训练</span></article> : null}
        {data.insights.mistakeReasons[0] ? <article><strong>主要错因</strong><span>{data.insights.mistakeReasons[0].reason}（{data.insights.mistakeReasons[0].count} 次）</span></article> : null}
      </div>
      <div className="timeline-list">
        {data.insights.focusHints.slice(0, 4).map((hint) => (
          <article key={hint}><div><strong>{hint}</strong></div></article>
        ))}
      </div>
    </section>
  );
}
