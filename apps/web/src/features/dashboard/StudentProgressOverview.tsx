import type { UserProfile, WeaknessReport } from '@kaoyan408/shared';
import type { MasteryMap, SprintPlan, StudyReminders, TrialProgress } from '../../api';
import { masteryStatusLabel, priorityLabel } from '../../constants';

interface StudentProgressOverviewProps {
  trialProgress: TrialProgress;
  studyReminders: StudyReminders;
  sprintPlan: SprintPlan;
  masteryMap: MasteryMap;
  student: UserProfile;
  report: WeaknessReport;
}

export function StudentProgressOverview({
  trialProgress,
  studyReminders,
  sprintPlan,
  masteryMap,
  student,
  report,
}: StudentProgressOverviewProps) {
  return (
    <>
      <section id="trial" className="panel trial-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">试用引导</p><h3>{trialProgress.title}</h3></div>
          <span>{trialProgress.completedCount}/{trialProgress.totalCount} 已完成 · {trialProgress.completionRate}%</span>
        </div>
        <p className="task-status">下一步：{trialProgress.nextAction}</p>
        <div className="trial-list">
          {trialProgress.items.map((item) => (
            <article key={item.id} className={item.completed ? 'completed' : ''}>
              <div><strong>{item.title}</strong><span>{item.description}</span></div>
              <a href={item.actionAnchor}>{item.completed ? '已完成' : '去体验'}</a>
            </article>
          ))}
        </div>
      </section>

      <section className="panel reminder-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">今日提分提醒</p><h3>{studyReminders.title}</h3></div>
          <span>更新于 {new Date(studyReminders.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="reminder-list">
          {studyReminders.items.map((item) => (
            <article key={item.id} className={`reminder-row priority-${item.priority}`}>
              <div><span>{priorityLabel[item.priority]}</span><strong>{item.title}</strong><p>{item.reason}</p></div>
              <a href={item.actionAnchor}>{item.actionText}</a>
            </article>
          ))}
        </div>
      </section>

      <section className="panel sprint-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">7 天冲刺计划</p><h3>{sprintPlan.title}</h3></div>
          <span>差 {sprintPlan.scoreGap} 分 · 剩余 {sprintPlan.remainingDays ?? 0} 天</span>
        </div>
        <div className="sprint-summary">
          <article><strong>{sprintPlan.weeklyQuestionTarget}</strong><span>本周目标题量</span></article>
          <article><strong>{sprintPlan.weeklyReviewTarget}</strong><span>本周复盘目标</span></article>
          <article><strong>{sprintPlan.currentStage ?? '待诊断'}</strong><span>当前阶段</span></article>
        </div>
        <div className="risk-list">{sprintPlan.risks.map((risk) => <span key={risk}>{risk}</span>)}</div>
        <div className="sprint-days">
          {sprintPlan.days.map((day) => (
            <article key={day.date}>
              <div><strong>第 {day.dayIndex} 天 · {day.focus}</strong><span>{day.date} · {day.minutes} 分钟</span></div>
              <p>{day.reason}</p>
              <footer><span>{day.questionTarget} 题</span><span>{day.reviewTarget} 道复盘</span></footer>
            </article>
          ))}
        </div>
      </section>

      <section className="panel mastery-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">408 掌握度地图</p><h3>{masteryMap.title}</h3></div>
          <span>薄弱点 {masteryMap.weakestPoints.length} 个</span>
        </div>
        <div className="mastery-subjects">
          {masteryMap.subjects.map((subject) => (
            <article key={subject.subject} className="mastery-subject">
              <header>
                <div><strong>{subject.subject}</strong><span>平均掌握度 {subject.averageMastery}%</span></div>
                <small>{subject.weakCount} 薄弱 · {subject.reviewCount} 巩固 · {subject.masteredCount} 掌握</small>
              </header>
              <div className="mastery-points">
                {subject.points.length ? subject.points.map((point) => (
                  <div key={point.knowledgePointId} className={`mastery-point status-${point.status}`}>
                    <div><strong>{point.title}</strong><span>{point.chapter} · 掌握 {point.masteryRate}% · 正确率 {point.accuracyRate}%</span></div>
                    <p>{point.practiceCount} 次练习 · {point.wrongCount} 次错误 · {point.nextAction}</p>
                    <a href={point.actionAnchor}>{masteryStatusLabel[point.status]}</a>
                  </div>
                )) : (
                  <div className="mastery-empty"><strong>暂无知识点数据</strong><span>后续补充题库和知识树后会自动进入掌握度统计。</span></div>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="dashboard" className="metrics-grid">
        <Metric title="目标分" value={`${student.targetScore ?? 0}`} caption={student.targetSchool ?? '目标院校未设置'} />
        <Metric title="正确率" value={`${report.accuracyRate}%`} caption="近 20 次练习统计" />
        <Metric title="预计提分空间" value={`${report.estimatedGain} 分`} caption="基于薄弱点和目标分估算" />
        <Metric title="剩余天数" value={`${student.remainingDays ?? 0} 天`} caption={`每日 ${student.dailyHours ?? 0} 小时`} />
      </section>
    </>
  );
}

function Metric({ title, value, caption }: { title: string; value: string; caption: string }) {
  return <article className="metric"><span>{title}</span><strong>{value}</strong><p>{caption}</p></article>;
}
