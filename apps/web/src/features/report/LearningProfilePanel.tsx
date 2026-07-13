import type { LearningProfile } from '../../api';
import { ModuleResourceMeta, ModuleUnavailable } from '../../components/ModuleResourceState';
import type { ModuleResource } from '../../hooks/useStudentProgressData';

export function LearningProfilePanel({ profile, onRetry }: { profile: ModuleResource<LearningProfile>; onRetry: () => void }) {
  if (!profile.data) return <ModuleUnavailable title="学习档案" resource={profile} onRetry={onRetry} />;
  const data = profile.data;
  return (
    <section className="panel profile-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">学习档案</p><h3>{data.summary.name} 的提分闭环轨迹</h3></div>
        <span>{data.summary.currentStage} · 连续 {data.summary.streakDays} 天</span>
      </div>
      <ModuleResourceMeta resource={profile} onRetry={onRetry} />
      <div className="profile-grid">
        <article><strong>{data.loopStats.practiceSetCount}</strong><span>题组练习</span></article>
        <article><strong>{data.loopStats.stageAssessmentCount}</strong><span>阶段测评</span></article>
        <article><strong>{data.loopStats.reviewedWrongQuestionCount}</strong><span>错题复盘</span></article>
        <article><strong>{data.summary.accuracyRate}%</strong><span>综合正确率</span></article>
      </div>
      <p className="task-status">{data.nextMilestone}</p>
      <div className="timeline-list">
        {data.timeline.slice(0, 5).map((item) => (
          <article key={item.id}><time>{item.date}</time><div><strong>{item.title}</strong><span>{item.summary}</span></div></article>
        ))}
      </div>
    </section>
  );
}
