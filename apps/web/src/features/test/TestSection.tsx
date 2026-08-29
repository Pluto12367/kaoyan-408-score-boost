import { lazy, Suspense } from 'react';
import type {
  FeedbackDraft,
  StageReport,
  StudyPlan,
  UserProfile,
  WeaknessReport,
} from '@kaoyan408/shared';
import type {
  AssessmentHistory,
  DashboardOverview,
  LearningProfile,
  MasteryMap,
  ReviewResourceRecommendation,
  SprintPlan,
  StageAssessmentResult,
  StudyReminders,
  TrialProgress,
  WrongQuestionSummary,
} from '../../api';
import type { ModuleResource } from '../../hooks/moduleResource';
import type { RoleSection } from '../../layouts/RoleNavigation';
import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
import { sectionFallback } from '../../components/sectionFallback';

const ReportWorkspace = lazy(() => import('../report/ReportWorkspace').then((m) => ({ default: m.ReportWorkspace })));
const StageAssessmentPanel = lazy(() => import('../assessment/StageAssessmentPanel').then((m) => ({ default: m.StageAssessmentPanel })));

interface TestSectionProps {
  student: UserProfile;
  report: WeaknessReport;
  stageReport: StageReport | null;
  masteryMap: MasteryMap | null;
  masteryMapResource: ModuleResource<MasteryMap>;
  trialProgress: ModuleResource<TrialProgress>;
  studyReminders: ModuleResource<StudyReminders>;
  sprintPlan: ModuleResource<SprintPlan>;
  learningProfile: ModuleResource<LearningProfile>;
  reviewResources: ModuleResource<ReviewResourceRecommendation>;
  assessmentHistory: ModuleResource<AssessmentHistory>;
  plan: StudyPlan;
  wrongQuestionSummary: ModuleResource<WrongQuestionSummary>;
  todayPlan: TodayPlanType | null;
  stageAssessment: DashboardOverview['stageAssessment'];
  stageResult: StageAssessmentResult | null;
  feedbackStatus: string;
  diagnosticStatus: string;
  assessmentStatus: string;
  onRetryStageReport: () => void;
  onRetryTrial: () => void;
  onRetryReminders: () => void;
  onRetrySprint: () => void;
  onRetryMastery: () => void;
  onRetryLearningProfile: () => void;
  onRetryReviewResources: () => void;
  onRetryAssessmentHistory: () => void;
  onSubmitFeedback: (draft: FeedbackDraft) => Promise<boolean>;
  onSubmitDiagnostic: () => void;
  onSubmitAssessment: () => void;
  onGenerateAssessment: () => void;
  onNavigate: (section: RoleSection) => void;
}

// V3 测试中心：顶部为阶段测评入口，下方保留完整提分报告工作台。
export function TestSection(props: TestSectionProps) {
  return (
    <div className="test-section">
      <section className="panel test-section-entry" aria-label="阶段测评入口">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">测试中心</p>
            <h3>阶段能力诊断</h3>
          </div>
        </div>
        <p className="task-status">{props.assessmentStatus}</p>
        <Suspense fallback={sectionFallback('阶段测评')}>
          <StageAssessmentPanel
            assessment={props.stageAssessment}
            result={props.stageResult}
            status={props.assessmentStatus}
            onSubmit={props.onSubmitAssessment}
            onGenerate={props.onGenerateAssessment}
            onNavigate={props.onNavigate}
          />
        </Suspense>
      </section>

      <section className="panel test-section-report" aria-label="提分报告">
        <Suspense fallback={sectionFallback('提分报告')}>
          <ReportWorkspace
            student={props.student}
            report={props.report}
            stageReport={props.stageReport}
            masteryMap={props.masteryMap}
            masteryMapResource={props.masteryMapResource}
            trialProgress={props.trialProgress}
            studyReminders={props.studyReminders}
            sprintPlan={props.sprintPlan}
            learningProfile={props.learningProfile}
            reviewResources={props.reviewResources}
            assessmentHistory={props.assessmentHistory}
            plan={props.plan}
            wrongQuestionSummary={props.wrongQuestionSummary}
            todayPlan={props.todayPlan}
            feedbackStatus={props.feedbackStatus}
            diagnosticStatus={props.diagnosticStatus}
            onRetryStageReport={props.onRetryStageReport}
            onRetryTrial={props.onRetryTrial}
            onRetryReminders={props.onRetryReminders}
            onRetrySprint={props.onRetrySprint}
            onRetryMastery={props.onRetryMastery}
            onRetryLearningProfile={props.onRetryLearningProfile}
            onRetryReviewResources={props.onRetryReviewResources}
            onRetryAssessmentHistory={props.onRetryAssessmentHistory}
            onSubmitFeedback={props.onSubmitFeedback}
            onSubmitDiagnostic={props.onSubmitDiagnostic}
            onNavigate={props.onNavigate}
          />
        </Suspense>
      </section>
    </div>
  );
}
