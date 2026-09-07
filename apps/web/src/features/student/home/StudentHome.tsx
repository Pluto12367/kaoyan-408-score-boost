import type { UserProfile, WeaknessReport } from '@kaoyan408/shared';
import type { CanonicalOverview, LearningCalendar, MasteryMap, StudentContext, WrongQuestionSummary } from '../../../api';
import type { RoleSection } from '../../../layouts/RoleNavigation';
import type { TodayPlan as TodayPlanType } from '../../../api/endpoints/onboarding';
import type { DueReviewsResponse } from '../../../api/endpoints/review';
import type { TodayPlanTask } from '../../onboarding/todayLearningRoute';
import type { StudentAction } from '../actions/studentAction';
import type { ModuleResource } from '../../../hooks/moduleResource';
import { lazy, Suspense } from 'react';
import { isStaticDemoMode } from '../../../api/env';
import { TodaysScoreCenter } from '../../today-score-center/TodaysScoreCenter';
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
}

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
}: StudentHomeProps) {
  const model = useDashboardViewModel({ student, todayPlan, masteryMap, report, wrongQuestionSummary, learningCalendar, canonicalOverview, studentContext: studentContext?.data });
  const openCoach = () => onNavigate('ai');

  return (
    <div className="student-home dashboard-home">
      {studentContext?.state === 'loading' && !studentContext.data ? <p className="dashboard-muted" role="status">正在同步学生状态摘要...</p> : null}
      {studentContext?.state === 'error' && !studentContext.data && studentContext.error ? <p className="dashboard-muted" role="status">学生状态摘要暂不可用，当前保留兼容视图：{studentContext.error}</p> : null}
      {canonicalOverviewError && !studentContext?.data ? <p className="dashboard-muted" role="status">新版总览暂不可用，当前保留兼容视图：{canonicalOverviewError}</p> : null}
      <DashboardHero model={model} onNavigate={openCoach} />
      <div className="dashboard-main-grid">
        <div className="dashboard-primary-column">
          <DailyBriefCard />
          <ProactiveCoachCard />
          <StudentStateCard model={model} onNavigate={() => onNavigate('knowledge-catalog')} />
          {canonicalAction ? (
            <section className="dashboard-canonical-action-region" aria-label="首页核心行动">
              <StudentActionCard action={canonicalAction} onSelect={onSelectCanonicalAction} />
            </section>
          ) : null}
          <TodayMission model={model} loading={todayPlanLoading} error={todayPlanError} onLaunch={onLaunchTodayTask} onRefresh={onRefreshTodayPlan} />
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
          <LearningTrend model={model} />
        </div>
        <div className="dashboard-secondary-column">
          <AIInsightCard model={model} onNavigate={openCoach} />
          <aside className="dashboard-secondary-actions" aria-label="次要快捷入口">
            <QuickActions onNavigate={onNavigate} />
          </aside>
          <div className="dashboard-streak-strip"><strong>{model.studyStreak ?? '--'}</strong><span>天连续学习<br /><small>今日 {learningCalendar.today.practiceCount} 次练习</small></span></div>
        </div>
      </div>
    </div>
  );
}

