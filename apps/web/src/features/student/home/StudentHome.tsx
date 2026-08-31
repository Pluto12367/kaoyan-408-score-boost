import type { UserProfile, WeaknessReport } from '@kaoyan408/shared';
import type { LearningCalendar, MasteryMap, WrongQuestionSummary } from '../../../api';
import type { RoleSection } from '../../../layouts/RoleNavigation';
import type { TodayPlan as TodayPlanType } from '../../../api/endpoints/onboarding';
import type { TodayPlanTask } from '../../onboarding/todayLearningRoute';
import { useDashboardViewModel } from './useDashboardViewModel';
import { DashboardHero } from './components/DashboardHero';
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
  wrongQuestionSummary: WrongQuestionSummary | null;
  masteryMap: MasteryMap | null;
  learningCalendar: LearningCalendar;
  planFocusTaskId: string | null;
  onNavigate: (section: RoleSection) => void;
  onLaunchTodayTask: (task: TodayPlanTask) => void;
  onRefreshTodayPlan: () => void;
  onOpenReview?: (questionId: string) => void;
}

export function StudentHome({
  student,
  report,
  todayPlan,
  todayPlanLoading,
  todayPlanError,
  wrongQuestionSummary,
  masteryMap,
  learningCalendar,
  planFocusTaskId,
  onNavigate,
  onLaunchTodayTask,
  onRefreshTodayPlan,
  onOpenReview,
}: StudentHomeProps) {
  const model = useDashboardViewModel({ student, todayPlan, masteryMap, report, wrongQuestionSummary, learningCalendar });
  const openCoach = () => onNavigate('ai');

  return (
    <div className="student-home dashboard-home">
      <DashboardHero model={model} onNavigate={openCoach} />
      <div className="dashboard-main-grid">
        <div className="dashboard-primary-column">
          <StudentStateCard model={model} onNavigate={() => onNavigate('knowledge-catalog')} />
          <TodayMission model={model} loading={todayPlanLoading} error={todayPlanError} onLaunch={onLaunchTodayTask} onRefresh={onRefreshTodayPlan} />
          {todayPlan ? (
            <details className="dashboard-plan-details">
              <summary>展开完整今日计划</summary>
              <Suspense fallback={<p className="dashboard-muted">正在打开完整计划...</p>}>
                <TodayPlan
                  plan={todayPlan}
                  student={student}
                  focusTaskId={planFocusTaskId}
                  onRefresh={async () => { onRefreshTodayPlan(); }}
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
          <QuickActions onNavigate={onNavigate} />
          <div className="dashboard-streak-strip"><strong>{learningCalendar.streakDays}</strong><span>天连续学习<br /><small>今日 {learningCalendar.today.practiceCount} 次练习</small></span></div>
        </div>
      </div>
    </div>
  );
}
import { lazy, Suspense } from 'react';
