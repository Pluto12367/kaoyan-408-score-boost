import { useMemo } from 'react';
import { buildLearningInsights, estimatePredictedScore } from '@kaoyan408/shared';
import type { StageReport, UserProfile, WeaknessReport } from '@kaoyan408/shared';
import type { CanonicalOverview, MasteryMap, LearningProfile, StudentContext } from '../../api';
import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
import type { RoleSection } from '../../layouts/RoleNavigation';
import { GoalProgressInsight } from '../student/GoalProgressInsight';
import { RecommendationEvidence } from '../student/RecommendationEvidence';
import { buildReportNextLearningStep, NextLearningStepCard } from '../student/NextLearningStepCard';
import { buildReportActions } from '../student/actions/adapters/reportActionAdapter';
import { toRoleSection } from '../student/actions/studentActionDestination';
import { toReportWorkspaceSummary } from '../student/report/reportWorkspaceContextAdapter';

const verdictLabels: Record<StageReport['verdict'], string> = {
  improved: '较上阶段提升',
  declined: '较上阶段下降',
  steady: '与上阶段持平',
  insufficient: '数据不足',
};

interface ReportSummaryPanelProps {
  student: UserProfile;
  report: WeaknessReport;
  stageReport: StageReport | null;
  masteryMap: MasteryMap | null;
  learningProfile?: LearningProfile | null;
  wrongQuestionSummary?: { pendingCount: number } | null;
  todayPlan?: TodayPlanType | null;
  canonicalOverview?: CanonicalOverview | null;
  studentContext?: StudentContext | null;
  onRetry: () => void;
  onNavigate: (section: RoleSection) => void;
}

export function ReportSummaryPanel({ student, report, stageReport, masteryMap, learningProfile = null, wrongQuestionSummary = null, todayPlan = null, canonicalOverview = null, studentContext = null, onRetry, onNavigate }: ReportSummaryPanelProps) {
  const contextSummary = useMemo(
    () => (studentContext ? toReportWorkspaceSummary(studentContext) : null),
    [studentContext],
  );
  const averageMastery = useMemo(() => {
    if (contextSummary) return contextSummary.mastery.averageMastery;
    if (canonicalOverview) return canonicalOverview.mastery.averageMastery;
    if (!masteryMap || masteryMap.subjects.length === 0) return null;
    const total = masteryMap.subjects.reduce((sum, subject) => sum + subject.averageMastery, 0);
    return Math.round(total / masteryMap.subjects.length);
  }, [contextSummary, canonicalOverview, masteryMap]);

  const hasEnoughData = canonicalOverview
    ? canonicalOverview.mastery.nodes.length > 0
      || canonicalOverview.progress.last7d.sampleSize > 0
      || canonicalOverview.weaknesses.practiceWeaknesses.length > 0
    : report.completionRate > 0
      || report.weakPoints.length > 0
      || (masteryMap?.subjects.some((subject) => subject.points.length > 0) ?? false);

  const predicted = useMemo(() => {
    if (!hasEnoughData) return null;
    const contextAccuracy = contextSummary?.practice.status === 'sufficient' ? contextSummary.practice.recentAccuracy : null;
    const accuracyRate = contextAccuracy ?? (canonicalOverview?.progress.last7d.current ?? (canonicalOverview ? null : report.accuracyRate));
    const predictionMastery = averageMastery ?? report.accuracyRate;
    if (accuracyRate === null || predictionMastery === null) return null;
    return estimatePredictedScore({
      currentScore: student.currentScore ?? 0,
      targetScore: student.targetScore ?? 100,
      accuracyRate,
      averageMastery: predictionMastery,
      remainingDays: student.remainingDays ?? 0,
      scoreTrend: stageReport?.assessmentTrend.delta ?? undefined,
    });
  }, [averageMastery, canonicalOverview, contextSummary, hasEnoughData, report.accuracyRate, stageReport?.assessmentTrend.delta, student.currentScore, student.remainingDays, student.targetScore]);

  const improvements: string[] = [];
  if (canonicalOverview?.progress.last7d.status === 'up' && canonicalOverview.progress.last7d.current !== null && canonicalOverview.progress.last7d.baseline !== null) {
    const delta = canonicalOverview.progress.last7d.delta ?? canonicalOverview.progress.last7d.current - canonicalOverview.progress.last7d.baseline;
    improvements.push(`近 7 日正确率较基线提升 ${Math.round(delta * 10) / 10} 个百分点（${canonicalOverview.progress.last7d.sampleSize} 次练习）`);
  }
  if (stageReport?.verdict === 'improved' && stageReport.accuracyDelta !== null) {
    improvements.push(`答题正确率较上一阶段提升 ${stageReport.accuracyDelta} 个百分点（基于练习记录）`);
  }
  if (stageReport?.assessmentTrend.delta != null && stageReport.assessmentTrend.delta > 0) {
    improvements.push(`最近测评较上次提升 ${stageReport.assessmentTrend.delta} 分`);
  }
  if ((stageReport?.streakDays ?? 0) >= 2) {
    improvements.push(`已连续学习 ${stageReport?.streakDays} 天`);
  }
  if (improvements.length === 0) improvements.push('暂无足够对比数据，坚持一周学习后自动生成');

  const risks: string[] = [];
  if (stageReport?.verdict === 'declined' && stageReport.accuracyDelta !== null) {
    risks.push(`本阶段正确率较上一阶段下降 ${Math.abs(stageReport.accuracyDelta)} 个百分点`);
  }
  if (stageReport?.assessmentTrend.delta != null && stageReport.assessmentTrend.delta < 0) {
    risks.push(`最近测评较上次下降 ${Math.abs(stageReport.assessmentTrend.delta)} 分`);
  }
  const speedRiskCount = canonicalOverview ? canonicalOverview.weaknesses.speedRisks.length : report.speedRisks.length;
  if (speedRiskCount > 0) {
    risks.push(`${speedRiskCount} 个考点存在“耗时过长”风险，需限时训练`);
  }
  const pendingWrongCount = canonicalOverview
    ? canonicalOverview.reviewStatus.pendingWrongQuestionCount
    : stageReport?.wrong.pendingCount ?? 0;
  if (pendingWrongCount > 0) {
    risks.push(`还有 ${pendingWrongCount} 道错题待复盘`);
  }
  if (risks.length === 0) risks.push('当前无明显风险，保持现有节奏即可');

  const topMasteryWeakPoint = stageReport?.mastery.weakestPoints[0] ?? null;
  const canonicalNodeWeakness = canonicalOverview?.weaknesses.nodeWeaknesses[0] ?? null;
  const canonicalPracticeWeakness = canonicalOverview?.weaknesses.practiceWeaknesses[0] ?? null;
  const topTask = canonicalOverview
    ? canonicalNodeWeakness
      ? `优先补强「${canonicalNodeWeakness.title}」（掌握 ${canonicalNodeWeakness.masteryRate}% · Node 掌握度）`
      : canonicalPracticeWeakness
        ? `优先训练「${canonicalPracticeWeakness.title}」（正确率 ${canonicalPracticeWeakness.accuracyRate}% · Point 练习表现）`
        : '先完成今日推荐练习，积累数据后再生成建议'
    : topMasteryWeakPoint
      ? `优先补强「${topMasteryWeakPoint.title}」（掌握 ${topMasteryWeakPoint.masteryRate}%，基于掌握度地图）`
      : report.weakPoints[0]
        ? `优先补强「${report.weakPoints[0].title}」（${report.weakPoints[0].chapter}）：${report.weakPoints[0].suggestion}`
        : stageReport?.nextAction
          ? stageReport.nextAction
          : '先完成今日推荐练习，积累数据后再生成建议';
  const reportNextLearningStep = canonicalOverview ? null : buildReportNextLearningStep(
    report,
    topMasteryWeakPoint?.title ?? null,
  );
  const learningInsights = buildLearningInsights({
    masteryMap,
    wrongSummary: wrongQuestionSummary ?? null,
    todayPlan: todayPlan ?? null,
    learningProfile: learningProfile ?? null,
  });
  const visibleLearningInsights = canonicalOverview ? [] : learningInsights;
  const reportActions = buildReportActions({
    scopeKey: 'summary',
    insights: visibleLearningInsights.map((insight) => ({ action: insight.action })),
  });
  const reportAction = reportActions.find((action) => action.type === 'open_report');
  const mistakeAction = reportActions.find((action) => action.type === 'assessment_wrong_questions');
  const practiceAction = reportActions.find((action) => action.type === 'assessment_practice');
  const reportActionTarget = toRoleSection(reportAction?.destination ?? 'test');
  const mistakeActionTarget = toRoleSection(mistakeAction?.destination ?? 'review');
  const practiceActionTarget = toRoleSection(practiceAction?.destination ?? 'practice');

  const longTermWeakPoints = useMemo(() => {
    if (canonicalOverview) {
      return canonicalOverview.weaknesses.nodeWeaknesses.slice(0, 3).map((point) => ({ title: point.title, rate: `掌握 ${point.masteryRate}%` }));
    }
    const weak = (masteryMap?.subjects ?? []).flatMap((subject) =>
      subject.points
        .filter((point) => point.status === 'weak')
        .map((point) => ({ title: point.title, rate: `掌握 ${point.masteryRate}%` })),
    );
    if (weak.length > 0) return weak.slice(0, 3);
    return report.weakPoints.slice(0, 3).map((point) => ({ title: point.title, rate: `正确率 ${point.accuracyRate}%` }));
  }, [canonicalOverview, masteryMap, report.weakPoints]);

  const reportActionPlan = [
    {
      title: '优先复盘错题',
      description: pendingWrongCount > 0
        ? `还有 ${pendingWrongCount} 道错题待复盘，先把丢分点变成可修复动作。`
        : '当前待复盘压力不高，保持错题复盘节奏即可。',
      action: '去错题本',
      target: mistakeActionTarget,
      onClick: () => onNavigate(mistakeActionTarget),
    },
    {
      title: '训练薄弱知识点',
      description: canonicalOverview
        ? canonicalNodeWeakness
          ? `优先补强：${canonicalNodeWeakness.title}（Node 掌握度 ${canonicalNodeWeakness.masteryRate}%）。`
          : canonicalPracticeWeakness
            ? `优先训练：${canonicalPracticeWeakness.title}（Point 正确率 ${canonicalPracticeWeakness.accuracyRate}%）。`
            : '暂无明确薄弱点时，用推荐题组继续积累数据。'
        : report.weakPoints[0]
          ? `优先训练：${report.weakPoints[0].title}，对应 ${report.weakPoints[0].chapter}。`
          : '暂无明确薄弱点时，用推荐题组继续积累数据。',
      action: '去练习',
      target: practiceActionTarget,
      onClick: () => onNavigate(practiceActionTarget),
    },
    {
      title: '回到今日任务',
      description: todayPlan?.priorityTasks?.length
        ? '把报告建议落到今天的任务里，完成后再回来观察掌握度变化。'
        : '暂无今日任务数据，先完成诊断或重新加载计划。完成入学诊断后，系统会为你生成唯一主行动。',
      action: '回到首页',
      target: 'dashboard' as RoleSection,
      onClick: () => onNavigate('dashboard'),
    },
  ];

  return (
    <section id="report-summary" className="panel report-summary-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">报告结论</p><h3>先看结论，再看数据</h3></div>
        {stageReport ? <span className="stage-report-badge">{verdictLabels[stageReport.verdict]}</span> : null}
      </div>

      <div className="report-summary-grid">
        <article className="report-conclusion-card">
          <h4>预测分数</h4>
          {predicted
            ? <><strong>{predicted.minScore}–{predicted.maxScore} 分</strong><p>参考值 {predicted.bestEstimate} 分 · {predicted.basis}</p></>
            : <><strong>--</strong><p>完成练习后基于正确率、掌握度与剩余天数生成</p></>}
        </article>

        <article className="report-conclusion-card">
          <h4>主要进步</h4>
          <ul className="report-conclusion-list">
            {improvements.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </article>

        <article className="report-conclusion-card">
          <h4>当前风险</h4>
          <ul className="report-conclusion-list">
            {risks.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </article>

        <article className="report-conclusion-card">
          <h4>下周最重要任务</h4>
          <p className="report-top-task">{topTask}</p>
        </article>

        <article className="report-conclusion-card">
          <h4>长期薄弱点</h4>
          {longTermWeakPoints.length
            ? <ul className="report-conclusion-list">{longTermWeakPoints.map((item) => <li key={item.title}>{item.title}（{item.rate}）</li>)}</ul>
            : <p>暂无薄弱点数据，完成诊断与练习后自动生成</p>}
        </article>
      </div>

      <GoalProgressInsight
        student={student}
        report={canonicalOverview ? null : report}
        todayPlan={todayPlan}
        actionLabel="报告目标进度"
      />

      <section className="report-insight-grid" aria-label="报告学习洞察">
        {visibleLearningInsights.map((insight) => {
          const target: RoleSection = insight.action === '去错题本'
            ? 'wrong-book'
            : insight.action === '去练习薄弱点'
              ? 'question'
              : insight.action === '完成入学诊断'
                ? 'plan'
                : 'dashboard';
          return (
            <article key={insight.type} className={`report-insight-card report-insight-${insight.type}`}>
              <p className="eyebrow">{insight.type === 'progress' ? '进步点' : insight.type === 'risk' ? '风险点' : '下一步建议'}</p>
              <h4>{insight.title}</h4>
              <strong>为什么这样判断</strong>
              <p>{insight.evidence}</p>
              <strong>影响</strong>
              <p>{insight.impact}</p>
              <strong>下一步动作</strong>
              <button type="button" className="secondary-action" onClick={() => onNavigate(target)}>{insight.action}</button>
            </article>
          );
        })}
      </section>

      {reportNextLearningStep ? <NextLearningStepCard step={reportNextLearningStep} onNavigate={onNavigate} /> : null}

      <div className="report-action-plan" data-report-action-target={reportActionTarget}>
        <div className="report-action-plan-head">
          <h4>下一步学习建议</h4>
          <span>报告不是终点，下一步要落到练习和复盘。</span>
        </div>
        <RecommendationEvidence
          title="报告建议依据"
          reason={canonicalOverview
            ? canonicalNodeWeakness
              ? `当前最优先补强 ${canonicalNodeWeakness.title}`
              : canonicalPracticeWeakness
                ? `当前最优先训练 ${canonicalPracticeWeakness.title}`
                : '暂未形成稳定薄弱点，先继续完成今日练习。'
            : report.weakPoints[0]
              ? `当前最优先补强 ${report.weakPoints[0].title}`
              : stageReport?.nextAction ?? '暂未形成稳定薄弱点，先继续完成今日练习。'}
          evidence={canonicalOverview
            ? `Node 薄弱点 ${canonicalOverview.weaknesses.nodeWeaknesses.length} 个，Point 练习薄弱点 ${canonicalOverview.weaknesses.practiceWeaknesses.length} 个，待复盘错题 ${pendingWrongCount} 道，近 7 日趋势 ${canonicalOverview.progress.last7d.status}`
            : `薄弱点 ${report.weakPoints.length} 个，待复盘错题 ${stageReport?.wrong.pendingCount ?? 0} 道，阶段趋势 ${stageReport ? verdictLabels[stageReport.verdict] : '待生成'}`}
          impact="完成建议动作后，掌握度、错题复盘数和阶段报告会随练习记录更新。"
          confidence={hasEnoughData ? (stageReport && stageReport.verdict !== 'insufficient' ? 'high' : 'medium') : 'low'}
          nextDataHint="多完成几组练习和一次阶段测评，报告建议会更有区分度。"
        />
        <div className="report-action-grid">
          {reportActionPlan.map((item) => (
            <article key={item.title} className="report-action-card" data-action-target={item.target}>
              <strong>{item.title}</strong>
              <p>{item.description}</p>
              <button type="button" className="secondary-action" onClick={item.onClick}>{item.action}</button>
            </article>
          ))}
        </div>
      </div>

      <p className="report-summary-footer">
        {predicted
          ? `预测分数${predicted.disclaimer}，实际结果受题目难度、复习质量与临场状态影响。`
          : '完成诊断与练习后，系统将基于正确率、掌握度和剩余天数生成预测分数。'}
        {' '}<button type="button" className="secondary-action" onClick={onRetry}>刷新报告数据</button>
      </p>
    </section>
  );
}
