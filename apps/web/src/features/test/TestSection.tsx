import { lazy, Suspense } from 'react';
import type { StageReport } from '@kaoyan408/shared';
import type { AssessmentHistory, MasteryMap, WrongQuestionSummary } from '../../api';
import type { RoleSection } from '../../layouts/RoleNavigation';
import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
import { sectionFallback } from '../../components/sectionFallback';

const ReportWorkspace = lazy(() => import('../report/ReportWorkspace').then((m) => ({ default: m.ReportWorkspace })));
const StageAssessmentPanel = lazy(() => import('../assessment/StageAssessmentPanel').then((m) => ({ default: m.StageAssessmentPanel })));

interface TestSectionProps {
  student: {
    id: string;
    name: string;
    currentScore?: number | null;
    targetScore?: number | null;
    remainingDays?: number | null;
    dailyHours?: number | null;
    stage?: string | null;
    targetSchool?: string | null;
  };
  report: StageReport | null;
  masteryMap: MasteryMap | null;
  wrongQuestionSummary: WrongQuestionSummary;
  assessmentHistory: AssessmentHistory;
  stageAssessment: {
    id: string;
    title: string;
    description: string;
    estimatedMinutes: number;
    questions: Array<{ id: string; title?: string }>;
    focusKnowledgePoints: Array<{ id: string; title: string }>;
  };
  todayPlan?: TodayPlanType | null;
  diagnosticStatus: string;
  assessmentStatus: string;
  onSubmitDiagnostic: () => void;
  onSubmitAssessment: () => void;
  onNavigate: (section: RoleSection) => void;
  onRetryStageReport: () => void;
  onRetryAssessmentHistory: () => void;
}

export function TestSection(props: TestSectionProps) {
  return (
    <div className="test-section">
      <section className="panel test-section-entry" aria-label="阶段测评入口">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">测试中心</p>
            <h3>阶段能力诊断</h3>
          </div>
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={props.onSubmitDiagnostic}>提交诊断</button>
            <button type="button" className="primary-action" onClick={props.onSubmitAssessment}>开始阶段测评</button>
          </div>
        </div>
        <p className="task-status">{props.assessmentStatus}</p>
        <Suspense fallback={sectionFallback('阶段测评')}>
          <StageAssessmentPanel
            assessment={props.stageAssessment as never}
            result={null}
            status={props.assessmentStatus}
            onSubmit={props.onSubmitAssessment}
            onNavigate={props.onNavigate}
          />
        </Suspense>
      </section>

      <section className="panel test-section-report" aria-label="考后报告">
        <Suspense fallback={sectionFallback('测试报告')}>
          <ReportWorkspace
            student={props.student as never}
            report={props.report as never}
            stageReport={props.report}
            masteryMap={props.masteryMap}
            masteryMapResource={{ data: props.masteryMap, state: props.masteryMap ? 'ready' : 'loading' } as never}
            trialProgress={{ data: null, state: 'loading' } as never}
            studyReminders={{ data: null, state: 'loading' } as never}
            sprintPlan={{ data: null, state: 'loading' } as never}
            learningProfile={{ data: null, state: 'loading' } as never}
            reviewResources={{ data: { source: 'memory-api', userId: props.student.id, generatedAt: new Date().toISOString(), weakPointCount: 0, items: [] }, state: 'ready' } as never}
            assessmentHistory={{ data: props.assessmentHistory, state: 'ready' } as never}
            plan={{ id: '', userId: props.student.id, phase: '', targetScore: 0, remainingDays: 0, dailyHours: 0, checkpoint: '', stale: false, status: 'ACTIVE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never}
            wrongQuestionSummary={{ data: props.wrongQuestionSummary, state: 'ready' } as never}
            todayPlan={props.todayPlan}
            feedbackStatus={props.diagnosticStatus}
            diagnosticStatus={props.diagnosticStatus}
            onRetryStageReport={props.onRetryStageReport}
            onRetryTrial={() => undefined}
            onRetryReminders={() => undefined}
            onRetrySprint={() => undefined}
            onRetryMastery={() => undefined}
            onRetryLearningProfile={() => undefined}
            onRetryReviewResources={() => undefined}
            onRetryAssessmentHistory={props.onRetryAssessmentHistory}
            onSubmitFeedback={async () => true}
            onSubmitDiagnostic={props.onSubmitDiagnostic}
            onNavigate={props.onNavigate}
          />
        </Suspense>
      </section>
    </div>
  );
}
