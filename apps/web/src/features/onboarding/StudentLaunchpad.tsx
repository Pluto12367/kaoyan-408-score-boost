import type { ComponentProps } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { GeneratedPaper } from '../../api';
import type { SessionView } from '../../api/endpoints/sessions';
import { OnboardingWizard } from '../../components/OnboardingWizard';
import { ResumeSessionBanner } from '../../components/ResumeSessionBanner';
import { TodayPlan } from '../../components/TodayPlan';
import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
import { ModuleUnavailable } from '../../components/ModuleResourceState';

interface StudentLaunchpadProps {
  showOnboarding: boolean;
  todayPlan: TodayPlanType | null;
  todayPlanLoading: boolean;
  todayPlanError: string;
  latestPaper: GeneratedPaper | null;
  examQuestionCount: number;
  onOnboardingComplete: ComponentProps<typeof OnboardingWizard>['onComplete'];
  onRefreshTodayPlan: () => void;
  onOpenReview: (questionId: string) => void;
  onResumeExam: (session: SessionView) => void;
  onStartExam: () => void;
}

export function StudentLaunchpad({
  showOnboarding,
  todayPlan,
  todayPlanLoading,
  todayPlanError,
  latestPaper,
  examQuestionCount,
  onOnboardingComplete,
  onRefreshTodayPlan,
  onOpenReview,
  onResumeExam,
  onStartExam,
}: StudentLaunchpadProps) {
  if (showOnboarding) return <OnboardingWizard onComplete={onOnboardingComplete} />;

  return (
    <>
      {todayPlan ? <TodayPlan plan={todayPlan} onRefresh={onRefreshTodayPlan} onOpenReview={onOpenReview} /> : null}
      {!todayPlan && (todayPlanLoading || todayPlanError) ? (
        <ModuleUnavailable
          title="今日计划"
          resource={{ data: null, state: todayPlanLoading ? 'loading' : 'error', error: todayPlanError || undefined }}
          onRetry={onRefreshTodayPlan}
        />
      ) : null}
      <ResumeSessionBanner allowedTypes={['paper']} onResume={onResumeExam} />
      <section className="panel exam-entry-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">408 模拟考试</p><h3>{latestPaper?.title ?? '当前题库模拟卷'}</h3></div>
          <span>{examQuestionCount} 题 · 180 分钟</span>
        </div>
        <p>支持答题卡、题目标记、自动保存、断点恢复和未答题检查。</p>
        <button type="button" className="primary-action" disabled={examQuestionCount === 0} onClick={onStartExam}>
          <ClipboardCheck size={18} /> 开始模拟考试
        </button>
      </section>
    </>
  );
}
