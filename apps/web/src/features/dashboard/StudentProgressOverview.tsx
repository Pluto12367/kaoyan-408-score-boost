import { estimatePredictedScore } from '@kaoyan408/shared';
import type { UserProfile, WeaknessReport } from '@kaoyan408/shared';
import type { MasteryMap, SprintPlan, StudyReminders, TrialProgress } from '../../api';
import { masteryStatusLabel, priorityLabel } from '../../constants';
import { ModuleResourceMeta, ModuleUnavailable } from '../../components/ModuleResourceState';
import type { ModuleResource } from '../../hooks/moduleResource';

interface StudentProgressOverviewProps {
  trialProgress: ModuleResource<TrialProgress>;
  studyReminders: ModuleResource<StudyReminders>;
  sprintPlan: ModuleResource<SprintPlan>;
  masteryMap: ModuleResource<MasteryMap>;
  student: UserProfile;
  report: WeaknessReport;
  onRetryTrial: () => void;
  onRetryReminders: () => void;
  onRetrySprint: () => void;
  onRetryMastery: () => void;
}

export function StudentProgressOverview({
  trialProgress,
  studyReminders,
  sprintPlan,
  masteryMap,
  student,
  report,
  onRetryTrial,
  onRetryReminders,
  onRetrySprint,
  onRetryMastery,
}: StudentProgressOverviewProps) {
  const trial = trialProgress.data;
  const reminders = studyReminders.data;
  const sprint = sprintPlan.data;
  const mastery = masteryMap.data;
  const averageMastery = mastery && mastery.subjects.length
    ? Math.round(mastery.subjects.reduce((sum, subject) => sum + subject.averageMastery, 0) / mastery.subjects.length)
    : null;
  const predicted = report.completionRate > 0 || report.weakPoints.length > 0
    ? estimatePredictedScore({
        currentScore: student.currentScore ?? 0,
        targetScore: student.targetScore ?? 100,
        accuracyRate: report.accuracyRate,
        averageMastery: averageMastery ?? report.accuracyRate,
        remainingDays: student.remainingDays ?? 0,
      })
    : null;

  return (
    <>
      {trial ? <section id="trial" className="panel trial-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">试用引导</p><h3>{trial.title}</h3></div>
          <span>{trial.completedCount}/{trial.totalCount} 已完成 · {trial.completionRate}%</span>
        </div>
        <ModuleResourceMeta resource={trialProgress} onRetry={onRetryTrial} />
        <p className="task-status">下一步：{trial.nextAction}</p>
        <div className="trial-list">
          {trial.items.map((item) => (
            <article key={item.id} className={item.completed ? 'completed' : ''}>
              <div><strong>{item.title}</strong><span>{item.description}</span></div>
              <a href={item.actionAnchor}>{item.completed ? '已完成' : '去体验'}</a>
            </article>
          ))}
        </div>
      </section> : <ModuleUnavailable id="trial" title="试用进度" resource={trialProgress} onRetry={onRetryTrial} />}

      {reminders ? <section className="panel reminder-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">今日提分提醒</p><h3>{reminders.title}</h3></div>
          <span>更新于 {new Date(reminders.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <ModuleResourceMeta resource={studyReminders} onRetry={onRetryReminders} />
        <div className="reminder-list">
          {reminders.items.map((item) => (
            <article key={item.id} className={`reminder-row priority-${item.priority}`}>
              <div><span>{priorityLabel[item.priority]}</span><strong>{item.title}</strong><p>{item.reason}</p></div>
              <a href={item.actionAnchor}>{item.actionText}</a>
            </article>
          ))}
        </div>
      </section> : <ModuleUnavailable title="今日提醒" resource={studyReminders} onRetry={onRetryReminders} />}

      {sprint ? <section className="panel sprint-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">7 天冲刺计划</p><h3>{sprint.title}</h3></div>
          <span>差 {sprint.scoreGap} 分 · 剩余 {sprint.remainingDays ?? 0} 天</span>
        </div>
        <ModuleResourceMeta resource={sprintPlan} onRetry={onRetrySprint} />
        <div className="sprint-summary">
          <article><strong>{sprint.weeklyQuestionTarget}</strong><span>本周目标题量</span></article>
          <article><strong>{sprint.weeklyReviewTarget}</strong><span>本周复盘目标</span></article>
          <article><strong>{sprint.currentStage ?? '待诊断'}</strong><span>当前阶段</span></article>
        </div>
        <div className="risk-list">{sprint.risks.map((risk) => <span key={risk}>{risk}</span>)}</div>
        <div className="sprint-days">
          {sprint.days.map((day) => (
            <article key={day.date}>
              <div><strong>第 {day.dayIndex} 天 · {day.focus}</strong><span>{day.date} · {day.minutes} 分钟</span></div>
              <p>{day.reason}</p>
              <footer><span>{day.questionTarget} 题</span><span>{day.reviewTarget} 道复盘</span></footer>
            </article>
          ))}
        </div>
      </section> : <ModuleUnavailable title="七天冲刺计划" resource={sprintPlan} onRetry={onRetrySprint} />}

      {mastery ? <section className="panel mastery-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">408 掌握度地图</p><h3>{mastery.title}</h3></div>
          <span>薄弱点 {mastery.weakestPoints.length} 个</span>
        </div>
        <ModuleResourceMeta resource={masteryMap} onRetry={onRetryMastery} />
        <div className="mastery-subjects">
          {mastery.subjects.map((subject) => (
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
      </section> : <ModuleUnavailable title="掌握度地图" resource={masteryMap} onRetry={onRetryMastery} />}

      <section id="dashboard" className="metrics-grid">
        <Metric title="目标分" value={`${student.targetScore ?? 0}`} caption={student.targetSchool ?? '目标院校未设置'} />
        <Metric title="正确率" value={`${report.accuracyRate}%`} caption="近 20 次练习统计" />
        <Metric title="预计提分空间" value={`${report.estimatedGain} 分`} caption="基于薄弱点和目标分估算" />
        <Metric title="剩余天数" value={`${student.remainingDays ?? 0} 天`} caption={`每日 ${student.dailyHours ?? 0} 小时`} />
        <Metric title="预测分数" value={predicted ? `${predicted.minScore}–${predicted.maxScore} 分` : '--'} caption={predicted ? predicted.disclaimer : '完成练习后估算'} />
      </section>
    </>
  );
}

function Metric({ title, value, caption }: { title: string; value: string; caption: string }) {
  return <article className="metric"><span>{title}</span><strong>{value}</strong><p>{caption}</p></article>;
}
