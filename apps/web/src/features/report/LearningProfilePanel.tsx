import type { LearningProfile } from '../../api';

export function LearningProfilePanel({ profile }: { profile: LearningProfile }) {
  return (
    <section className="panel profile-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">学习档案</p><h3>{profile.summary.name} 的提分闭环轨迹</h3></div>
        <span>{profile.summary.currentStage} · 连续 {profile.summary.streakDays} 天</span>
      </div>
      <div className="profile-grid">
        <article><strong>{profile.loopStats.practiceSetCount}</strong><span>题组练习</span></article>
        <article><strong>{profile.loopStats.stageAssessmentCount}</strong><span>阶段测评</span></article>
        <article><strong>{profile.loopStats.reviewedWrongQuestionCount}</strong><span>错题复盘</span></article>
        <article><strong>{profile.summary.accuracyRate}%</strong><span>综合正确率</span></article>
      </div>
      <p className="task-status">{profile.nextMilestone}</p>
      <div className="timeline-list">
        {profile.timeline.slice(0, 5).map((item) => (
          <article key={item.id}><time>{item.date}</time><div><strong>{item.title}</strong><span>{item.summary}</span></div></article>
        ))}
      </div>
    </section>
  );
}
