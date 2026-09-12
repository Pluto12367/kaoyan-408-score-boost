import type { UserProfile, WeaknessReport } from '@kaoyan408/shared';
import type { CanonicalOverview, LearningCalendar, MasteryMap, StudentContext, WrongQuestionSummary } from '../../../api';
import type { RoleSection } from '../../../layouts/RoleNavigation';
import type { TodayPlan as TodayPlanType } from '../../../api/endpoints/onboarding';
import type { DueReviewsResponse } from '../../../api/endpoints/review';
import type { TodayPlanTask } from '../../onboarding/todayLearningRoute';
import type { StudentAction } from '../actions/studentAction';
import type { ModuleResource } from '../../../hooks/moduleResource';
import { lazy, Suspense, useMemo } from 'react';
import { isStaticDemoMode } from '../../../api/env';
import { buildTodayMissionContract, type FirstUseFacts } from '@kaoyan408/shared';
import { TodaysScoreCenter } from '../../today-score-center/TodaysScoreCenter';
import { TransferProbeCard } from '../../transfer-probe/TransferProbeCard';
import { GuidanceLayer } from '../../guidance/GuidanceLayer';
import { PrimaryLearningActionCard } from '../../guidance/GuidanceCards';
import { StudentActionCard } from '../actions/StudentActionCard';
import { useDashboardViewModel } from './useDashboardViewModel';
import { DashboardHero } from './components/DashboardHero';
import { DailyBriefCard } from './components/DailyBriefCard';
import { ProactiveCoachCard } from './components/ProactiveCoachCard';
import { StudentStateCard } from './components/StudentStateCard';
import { TodayMission } from './components/TodayMission';
import { AIInsightCard } from './components/AIInsightCard';
import { LearningTrend } from './components/LearningTrend';
import { QuickActions } from './components/QuickActions';
import './components/dashboard-home.css';

const TodayPlan = lazy(() => import('../../../components/TodayPlan').then((m) => ({ default: m.TodayPlan })));

interface StudentHomeProps {
  student: UserProfile;
  report: WeaknessReport;
  todayPlan: TodayPlanType | null;
  todayPlanLoading: boolean;
  todayPlanError: string;
  dueReviews?: DueReviewsResponse | null;
  dueReviewsLoading?: boolean;
  dueReviewsError?: string;
  onRetryDueReviews?: () => void;
  wrongQuestionSummary: WrongQuestionSummary | null;
  masteryMap: MasteryMap | null;
  learningCalendar: LearningCalendar;
  canonicalOverview?: CanonicalOverview | null;
  canonicalOverviewError?: string;
  studentContext?: ModuleResource<StudentContext>;
  planFocusTaskId: string | null;
  onNavigate: (section: RoleSection) => void;
  onLaunchTodayTask: (task: TodayPlanTask) => void;
  onRefreshTodayPlan: () => void;
  onOpenReview?: (questionId: string) => void;
  canonicalAction: StudentAction | null;
  onSelectCanonicalAction: (action: StudentAction) => void;
  /** G1.3 first-use facts, derived from state the caller already holds. */
  firstUseFacts?: FirstUseFacts;
  /** True while the onboarding/diagnostic gate is still outstanding. */
  onboardingOutstanding?: boolean;
}

/**
 * G1.2 — home information hierarchy (owner decision A4).
 *
 * The audit found seven surfaces on the first screen all claiming to be "the
 * next step". This file now groups them into exactly three levels:
 *
 *   PRIMARY    one learning action, one filled button, four mandatory answers
 *              (WHAT / WHY / TIME / VERIFY) plus a NEXT.
 *   SECONDARY  the task list, the day's briefing, and the transfer re-test —
 *              everything that supports the primary action without competing
 *              with it for the button.
 *   CONTEXT    collapsed by default: full plan, recommendations, ambient coach,
 *              state card, trends, shortcuts. Reachable, never shouting.
 *
 * Every component previously mounted here is still mounted (existing contracts
 * assert on their presence); only the level they sit at changed.
 */
export function StudentHome({
  student,
  report,
  todayPlan,
  todayPlanLoading,
  todayPlanError,
  dueReviews,
  dueReviewsLoading,
  dueReviewsError,
  onRetryDueReviews,
  wrongQuestionSummary,
  masteryMap,
  learningCalendar,
  canonicalOverview,
  canonicalOverviewError,
  studentContext,
  planFocusTaskId,
  onNavigate,
  onLaunchTodayTask,
  onRefreshTodayPlan,
  onOpenReview,
  canonicalAction,
  onSelectCanonicalAction,
  firstUseFacts,
  onboardingOutstanding,
}: StudentHomeProps) {
  const model = useDashboardViewModel({ student, todayPlan, masteryMap, report, wrongQuestionSummary, learningCalendar, canonicalOverview, studentContext: studentContext?.data });
  const openCoach = () => onNavigate('ai');

  const contract = useMemo(() => buildTodayMissionContract({
    asOf: new Date().toISOString(),
    dateKey: todayPlan?.generatedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    tasks: (todayPlan?.priorityTasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      subject: task.subject,
      chapter: task.chapter,
      minutes: task.minutes,
      questionCount: task.questionCount,
      completed: Boolean(task.completed || task.status === 'completed'),
      reasonCodes: task.reasonCodes ?? null,
      reason: task.reason ?? null,
    })),
    reviewDue: todayPlan?.reviewDue ?? model.reviewDueCount ?? 0,
    verification: { probeDue: false, probeUnavailable: false, assessments: 0 },
  }), [todayPlan, model.reviewDueCount]);

  const primaryTask = useMemo(
    () => todayPlan?.priorityTasks.find((task) => !task.completed && task.status !== 'completed') ?? null,
    [todayPlan],
  );

  const facts: FirstUseFacts = useMemo(() => firstUseFacts ?? {
    onboardingOutstanding: onboardingOutstanding ?? false,
    gradedPracticeCount: studentContext?.data?.practice.totalCount ?? 0,
    wrongQuestionCount: wrongQuestionSummary?.totalWrongCount ?? 0,
    reviewAttemptCount: studentContext?.data?.review.reviewedCount ?? 0,
    hasProbeHistory: false,
    probeDeliverable: false,
    paperSessionCount: 0,
  }, [firstUseFacts, onboardingOutstanding, studentContext, wrongQuestionSummary]);

  return (
    <div className="student-home dashboard-home">
      {studentContext?.state === 'loading' && !studentContext.data ? <p className="dashboard-muted" role="status">正在同步学生状态摘要...</p> : null}
      {studentContext?.state === 'error' && !studentContext.data && studentContext.error ? <p className="dashboard-muted" role="status">学生状态摘要暂不可用，当前保留兼容视图：{studentContext.error}</p> : null}
      {canonicalOverviewError && !studentContext?.data ? <p className="dashboard-muted" role="status">新版总览暂不可用，当前保留兼容视图：{canonicalOverviewError}</p> : null}

      <GuidanceLayer facts={facts} onNavigate={onNavigate} surface="home" />

      {/* ---- PRIMARY: exactly one learning action ---- */}
      <PrimaryLearningActionCard
        contract={contract}
        onNavigate={onNavigate}
        onStart={primaryTask ? () => onLaunchTodayTask(primaryTask) : undefined}
        progressText={primaryTask?.progress
          ? `${primaryTask.progress.completedQuestionCount}/${primaryTask.questionCount} 题`
          : null}
      />

      {/* ---- SECONDARY: supports the primary action ---- */}
      <section className="dashboard-secondary-level" aria-label="今日支持信息">
        <DailyBriefCard />
        <TodayMission
          model={model}
          loading={todayPlanLoading}
          error={todayPlanError}
          onLaunch={onLaunchTodayTask}
          onRefresh={onRefreshTodayPlan}
          onNavigate={onNavigate}
        />
        {/* G1.7: the transfer re-test lives on the learning path, not only in a
            report tab. It stays silent when the feature is off or nothing is due. */}
        <TransferProbeCard onNavigate={onNavigate} mount="today" />
      </section>

      {/* ---- CONTEXT: collapsed by default ---- */}
      <details className="dashboard-context-level">
        <summary>更多信息与入口（今日完整计划 · 推荐依据 · 学习状态）</summary>
        <DashboardHero model={model} onNavigate={openCoach} />
        <ProactiveCoachCard />
        <StudentStateCard model={model} onNavigate={() => onNavigate('knowledge-catalog')} />
        {canonicalAction ? (
          <section className="dashboard-canonical-action-region" aria-label="首页核心行动">
            <StudentActionCard action={canonicalAction} onSelect={onSelectCanonicalAction} />
          </section>
        ) : null}
        {/* V9: score-center plan surface wired (backlog #23 owner decision) — node-driven
            plan with per-minute regeneration; hidden in the static demo (no API). */}
        {!isStaticDemoMode() ? <TodaysScoreCenter /> : null}
        {todayPlan ? (
          <details className="dashboard-plan-details">
            <summary>展开完整今日计划</summary>
            <Suspense fallback={<p className="dashboard-muted">正在打开完整计划...</p>}>
              <TodayPlan
                plan={todayPlan}
                student={student}
                focusTaskId={planFocusTaskId}
                onRefresh={async () => { onRefreshTodayPlan(); }}
                dueReviews={dueReviews}
                dueReviewsLoading={dueReviewsLoading}
                dueReviewsError={dueReviewsError}
                onRetryDueReviews={onRetryDueReviews}
                onOpenReview={onOpenReview}
                onNavigate={onNavigate}
              />
            </Suspense>
          </details>
        ) : null}
        <div className="dashboard-context-grid">
          <AIInsightCard model={model} onNavigate={openCoach} />
          <aside className="dashboard-secondary-actions" aria-label="次要快捷入口">
            <QuickActions onNavigate={onNavigate} />
          </aside>
        </div>
        <LearningTrend model={model} />
        <div className="dashboard-streak-strip"><strong>{model.studyStreak ?? '--'}</strong><span>天连续学习<br /><small>今日 {learningCalendar.today.practiceCount} 次练习</small></span></div>
      </details>
    </div>
  );
}
