import { useState } from 'react';
import type { FeedbackDraft, StageReport, StudyPlan, UserProfile, WeaknessReport } from '@kaoyan408/shared';
import type {
  AssessmentHistory,
  LearningCalendar,
  LearningProfile,
  MasteryMap,
  ReviewResourceRecommendation,
  SprintPlan,
  StudyReminders,
  TrialProgress,
  WrongQuestionSummary,
  CanonicalOverview,
  StudentContext,
} from '../../api';
import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
import type { ModuleResource } from '../../hooks/moduleResource';
import type { RoleSection } from '../../layouts/RoleNavigation';
import { StudentProgressOverview } from '../dashboard/StudentProgressOverview';
import { AssessmentHistoryPanel } from '../assessment/AssessmentHistoryPanel';
import { DiagnosticSummary } from '../diagnostic/DiagnosticSummary';
import { EffectivenessPanel } from './EffectivenessPanel';
import { FeedbackPanel } from '../feedback/FeedbackPanel';
import { TaskEvidencePanel } from './TaskEvidencePanel';
import { LearningEvidenceLedger } from './LearningEvidenceLedger';
import { ScoreAnchorPanel } from './ScoreAnchorPanel';
import { ExamDateCard } from './ExamDateCard';
import { TransferProbeCard } from '../transfer-probe/TransferProbeCard';
import { LearningProfilePanel } from './LearningProfilePanel';
import { MasteryTrendPanel } from './MasteryTrendPanel';
import { ProgressStoryCard } from './ProgressStoryCard';
import { ReportSummaryPanel } from './ReportSummaryPanel';
import { ReviewResourcesPanel } from './ReviewResourcesPanel';
import { StageReportPanel } from './StageReportPanel';
import { WeaknessReportPanel } from './WeaknessReportPanel';

type ReportTab = 'overview' | 'effectiveness' | 'mastery' | 'history' | 'actions' | 'resources';

const TABS: { id: ReportTab; label: string }[] = [
  { id: 'overview', label: '总览' },
  { id: 'effectiveness', label: '努力与效果' },
  { id: 'mastery', label: '四科掌握度' },
  { id: 'history', label: '测评历史' },
  { id: 'actions', label: '今日行动' },
  { id: 'resources', label: '资源与反馈' },
];

interface ReportWorkspaceProps {
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
  learningCalendar?: LearningCalendar;
  wrongQuestionSummary: ModuleResource<WrongQuestionSummary>;
  todayPlan?: TodayPlanType | null;
  canonicalOverview?: CanonicalOverview | null;
  studentContext?: StudentContext | null;
  feedbackStatus: string;
  diagnosticStatus: string;
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
  onNavigate: (section: RoleSection) => void;
}

export function ReportWorkspace(props: ReportWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<ReportTab>('overview');

  return (
    <div className="report-workspace">
      <div className="report-tabs" role="tablist" aria-label="提分报告分区">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`report-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`report-panel-${tab.id}`}
            className={`report-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="report-panel-overview"
        aria-labelledby="report-tab-overview"
        hidden={activeTab !== 'overview'}
      >
        <ReportSummaryPanel
          student={props.student}
          report={props.report}
          stageReport={props.stageReport}
          masteryMap={props.masteryMap}
          learningProfile={props.learningProfile.data ?? null}
          wrongQuestionSummary={props.wrongQuestionSummary.data}
          todayPlan={props.todayPlan}
          canonicalOverview={props.canonicalOverview}
          studentContext={props.studentContext}
          onRetry={props.onRetryStageReport}
          onNavigate={props.onNavigate}
        />
        <ProgressStoryCard />
        <TaskEvidencePanel />
        <LearningEvidenceLedger />
        <TransferProbeCard />
        <ScoreAnchorPanel />
        <ExamDateCard />
        <StudentProgressOverview
          trialProgress={props.trialProgress}
          studyReminders={props.studyReminders}
          sprintPlan={props.sprintPlan}
          masteryMap={props.masteryMapResource}
          student={props.student}
          report={props.report}
          canonicalOverview={props.canonicalOverview}
          sections={['metrics']}
          onRetryTrial={props.onRetryTrial}
          onRetryReminders={props.onRetryReminders}
          onRetrySprint={props.onRetrySprint}
          onRetryMastery={props.onRetryMastery}
          onNavigate={props.onNavigate}
        />
        <LearningProfilePanel profile={props.learningProfile} onRetry={props.onRetryLearningProfile} />
      </div>

      <div
        role="tabpanel"
        id="report-panel-effectiveness"
        aria-labelledby="report-tab-effectiveness"
        hidden={activeTab !== 'effectiveness'}
      >
        <EffectivenessPanel />
      </div>

      <div
        role="tabpanel"
        id="report-panel-mastery"
        aria-labelledby="report-tab-mastery"
        hidden={activeTab !== 'mastery'}
      >
        <MasteryTrendPanel />
        <StudentProgressOverview
          trialProgress={props.trialProgress}
          studyReminders={props.studyReminders}
          sprintPlan={props.sprintPlan}
          masteryMap={props.masteryMapResource}
          student={props.student}
          report={props.report}
          canonicalOverview={props.canonicalOverview}
          sections={['mastery']}
          onRetryTrial={props.onRetryTrial}
          onRetryReminders={props.onRetryReminders}
          onRetrySprint={props.onRetrySprint}
          onRetryMastery={props.onRetryMastery}
          onNavigate={props.onNavigate}
        />
        <WeaknessReportPanel report={props.report} />
      </div>

      <div
        role="tabpanel"
        id="report-panel-history"
        aria-labelledby="report-tab-history"
        hidden={activeTab !== 'history'}
      >
        <StageReportPanel report={props.stageReport} onRetry={props.onRetryStageReport} />
        <AssessmentHistoryPanel history={props.assessmentHistory} onRetry={props.onRetryAssessmentHistory} />
      </div>

      <div
        role="tabpanel"
        id="report-panel-actions"
        aria-labelledby="report-tab-actions"
        hidden={activeTab !== 'actions'}
      >
        <StudentProgressOverview
          trialProgress={props.trialProgress}
          studyReminders={props.studyReminders}
          sprintPlan={props.sprintPlan}
          masteryMap={props.masteryMapResource}
          student={props.student}
          report={props.report}
          sections={['trial', 'reminders', 'sprint']}
          onRetryTrial={props.onRetryTrial}
          onRetryReminders={props.onRetryReminders}
          onRetrySprint={props.onRetrySprint}
          onRetryMastery={props.onRetryMastery}
          onNavigate={props.onNavigate}
        />
      </div>

      <div
        role="tabpanel"
        id="report-panel-resources"
        aria-labelledby="report-tab-resources"
        hidden={activeTab !== 'resources'}
      >
        <ReviewResourcesPanel resources={props.reviewResources} onRetry={props.onRetryReviewResources} />
        <FeedbackPanel status={props.feedbackStatus} onSubmit={props.onSubmitFeedback} />
        <DiagnosticSummary
          student={props.student}
          plan={props.plan}
          status={props.diagnosticStatus}
          onSubmit={props.onSubmitDiagnostic}
        />
      </div>
    </div>
  );
}
