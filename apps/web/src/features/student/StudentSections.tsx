import { lazy, Suspense } from 'react';
import type {
  FeedbackDraft,
  Question,
  StageReport,
  StudyPlan,
  UserProfile,
  WeaknessReport,
} from '@kaoyan408/shared';
import type {
  AiFollowUp,
  AssessmentHistory,
  DashboardOverview,
  GeneratedPaper,
  LearningCalendar,
  LearningProfile,
  MasteryMap,
  PaperSubmitResult,
  PracticeSet,
  PracticeSetResult,
  PrepareExamPaperInput,
  ReviewResourceRecommendation,
  SprintPlan,
  StageAssessmentResult,
  StudyReminders,
  TrialProgress,
  TutorReply,
  WrongQuestion,
  WrongQuestionSummary,
} from '../../api';
import { ModuleUnavailable } from '../../components/ModuleResourceState';
import { ContextualCoach } from '../../components/ContextualCoach';
import { sectionFallback } from '../../components/sectionFallback';
import { isMockAllowed } from '../../api/env';
import type { ModuleResource } from '../../hooks/moduleResource';
import type { RoleSection } from '../../layouts/RoleNavigation';
import { ReviewResourcesPanel } from '../report/ReviewResourcesPanel';
import { WeaknessReportPanel } from '../report/WeaknessReportPanel';
import { LearningProfileCard } from '../dashboard/LearningProfileCard';
import { StudentHome } from './home/StudentHome';
import type { PracticeAnswerResult } from '../../api/endpoints/practice';
import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
import type { SessionView } from '../../api/endpoints/sessions';
import { deriveTodayTaskNextStep, type TodayPlanTask, type TodayTaskLaunchContext } from '../onboarding/todayLearningRoute';
import './student-learning-experience.css';

const StudentLaunchpad = lazy(() => import('../onboarding/StudentLaunchpad').then((m) => ({ default: m.StudentLaunchpad })));
const StudyPlanOverview = lazy(() => import('../plan/StudyPlanOverview').then((m) => ({ default: m.StudyPlanOverview })));
const TestSection = lazy(() => import('../test/TestSection').then((m) => ({ default: m.TestSection })));
const PracticePanel = lazy(() => import('../practice/PracticePanel').then((m) => ({ default: m.PracticePanel })));
const TutorPanel = lazy(() => import('../tutor/TutorPanel').then((m) => ({ default: m.TutorPanel })));
const MistakeWorkspace = lazy(() => import('../mistakes/MistakeWorkspace').then((m) => ({ default: m.MistakeWorkspace })));

export interface StudentSectionsProps {
  visibleSection: RoleSection;
  studentOverviewReady: boolean;
  overviewResource: ModuleResource<DashboardOverview>;
  onRetryOverview: () => void;
  student: UserProfile;
  questions: Question[];
  report: WeaknessReport;
  plan: StudyPlan;
  wrongQuestions: WrongQuestion[];
  learningCalendar: LearningCalendar;
  stageReport: StageReport | null;
  masteryMap: MasteryMap | null;
  masteryMapResource: ModuleResource<MasteryMap>;
  trialProgress: ModuleResource<TrialProgress>;
  studyReminders: ModuleResource<StudyReminders>;
  sprintPlan: ModuleResource<SprintPlan>;
  learningProfile: ModuleResource<LearningProfile>;
  reviewResources: ModuleResource<ReviewResourceRecommendation>;
  assessmentHistory: ModuleResource<AssessmentHistory>;
  practiceSet: ModuleResource<PracticeSet>;
  practiceSetResult: PracticeSetResult | null;
  wrongQuestionSummary: ModuleResource<WrongQuestionSummary>;
  showOnboarding: boolean;
  todayPlan: TodayPlanType | null;
  todayPlanLoading: boolean;
  todayPlanError: string;
  todayTaskLaunchingId: string | null;
  todayTaskLaunchError: string;
  todayTaskLaunchContext: TodayTaskLaunchContext | null;
  latestPaper: GeneratedPaper | null;
  examResult: PaperSubmitResult | null;
  examQuestionCount: number;
  remoteSessionsEnabled: boolean;
  redoQuestionId: string | null;
  practiceStatus: string;
  practiceSubmitting: boolean;
  practiceAnswerResult: PracticeAnswerResult | null;
  currentQuestion: Question;
  currentQuestionProgress: { current: number; total: number };
  hasNextQuestion: boolean;
  detailQuestionId: string | null;
  wrongStatus: string;
  stageResult: StageAssessmentResult | null;
  stageAssessment: DashboardOverview['stageAssessment'];
  assessmentStatus: string;
  onSubmitAssessment: () => void;
  onGenerateAssessment: () => void;
  diagnosticStatus: string;
  feedbackStatus: string;
  planFocusTaskId: string | null;
  tutorReply: TutorReply | null;
  aiFollowUp: AiFollowUp | null;
  tutorStatus: string;
  tutorFailed: boolean;
  onNavigate: (section: RoleSection) => void;
  onLaunchTodayTask: (task: TodayPlanTask) => void;
  onRetryTodayPlan: () => void;
  onOnboardingComplete: (result: Awaited<ReturnType<typeof import('../../api/endpoints/onboarding').completeOnboarding>>) => void;
  onOpenReview: (questionId: string) => void;
  onResumeSession: (session: SessionView) => void;
  onStartExam: (input: PrepareExamPaperInput) => Promise<void>;
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
  onSubmitAnswer: (answer: string) => void;
  onNextQuestion: () => void;
  onSubmitPracticeSet: () => void;
  onStartLearningMode: () => void;
  onRestartPracticeSet: () => void;
  onRestartQuestionBank: () => void;
  onRetryPracticeSet: () => void;
  onOpenDetail: (questionId: string) => void;
  onCloseDetail: () => void;
  onOpenCatalog?: (nodeId: string) => void;
  onReviewWrongQuestion: (questionId: string) => void;
  onRetryWrongQuestionSummary: () => void;
  onRedo: (questionId: string, knowledgePointTitle?: string) => void;
  onPracticeVariant: (questionId: string, variantQuestionId: string) => void;
  onAskTutor: () => void;
  onAskFollowUp: (message: string, mode?: string) => void;
}

export function StudentSections(props: StudentSectionsProps) {
  const { visibleSection, studentOverviewReady, overviewResource, onRetryOverview, report, questions } = props;
  const hasQuestions = questions.length > 0;
  const launchedQuestionTask = props.todayTaskLaunchContext?.destination === 'question'
    ? props.todayPlan?.priorityTasks.find((task) => task.id === props.todayTaskLaunchContext?.taskId) ?? null
    : null;
  const todayTaskNextStep = launchedQuestionTask
    ? deriveTodayTaskNextStep(
      props.todayPlan,
      launchedQuestionTask.id,
      props.wrongQuestionSummary.data?.pendingCount ?? 0,
    )
    : null;
  const launchedQuestionTaskReachedTarget = Boolean(
    launchedQuestionTask?.completed
    || launchedQuestionTask?.status === 'completed'
    || launchedQuestionTask?.progress?.reachedTarget,
  );

  return (
    <div className="student-workspace-sections">
      {visibleSection === 'dashboard' ? (
        studentOverviewReady ? (
          <Suspense fallback={sectionFallback('学习总览')}>
            <>
              <StudentHome
                student={props.student}
                report={report}
                todayPlan={props.todayPlan}
                todayPlanLoading={props.todayPlanLoading}
                todayPlanError={props.todayPlanError}
                wrongQuestionSummary={props.wrongQuestionSummary.data}
                masteryMap={props.masteryMap}
                learningCalendar={props.learningCalendar}
                planFocusTaskId={props.planFocusTaskId}
                onNavigate={props.onNavigate}
                onLaunchTodayTask={props.onLaunchTodayTask}
                onRefreshTodayPlan={props.onRetryTodayPlan}
                onOpenReview={props.onOpenReview}
              />
              {!props.todayPlan && isMockAllowed() ? (
                <Suspense fallback={sectionFallback('学习计划')}>
                  <StudyPlanOverview plan={props.plan} />
                </Suspense>
              ) : null}
              <LearningProfileCard profile={props.learningProfile} onRetry={props.onRetryLearningProfile} />
              <StudentLaunchpad
                showOnboarding={props.showOnboarding}
                todayPlan={props.todayPlan}
                todayPlanLoading={props.todayPlanLoading}
                todayPlanError={props.todayPlanError}
                todayTaskLaunchingId={props.todayTaskLaunchingId}
                todayTaskLaunchError={props.todayTaskLaunchError}
                latestPaper={props.latestPaper}
                examResult={props.examResult}
                examQuestionCount={props.examQuestionCount}
                remoteSessionsEnabled={props.remoteSessionsEnabled}
                report={report}
                masteryMap={props.masteryMap}
                learningCalendar={props.learningCalendar}
                wrongQuestionSummary={props.wrongQuestionSummary.data}
                onNavigate={props.onNavigate}
                onLaunchTodayTask={props.onLaunchTodayTask}
                onRetryTodayPlan={props.onRetryTodayPlan}
                onOnboardingComplete={props.onOnboardingComplete}
                onOpenReview={props.onOpenReview}
                onResumeSession={props.onResumeSession}
                onStartExam={props.onStartExam}
              />
            </>
          </Suspense>
        ) : (
          <ModuleUnavailable title="学习总览" resource={overviewResource} onRetry={onRetryOverview} />
        )
      ) : null}

      {visibleSection === 'test' || visibleSection === 'report' ? (
        studentOverviewReady ? (
          <Suspense fallback={sectionFallback('测试中心')}>
            <TestSection
              student={props.student}
              report={report}
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
              stageAssessment={props.stageAssessment}
              stageResult={props.stageResult}
              feedbackStatus={props.feedbackStatus}
              diagnosticStatus={props.diagnosticStatus}
              assessmentStatus={props.assessmentStatus}
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
              onSubmitAssessment={props.onSubmitAssessment}
              onGenerateAssessment={props.onGenerateAssessment}
              onNavigate={props.onNavigate}
            />
          </Suspense>
        ) : (
          <ModuleUnavailable title="测试中心" resource={overviewResource} onRetry={onRetryOverview} />
        )
      ) : null}

      {visibleSection === 'question' ? (
        studentOverviewReady ? (
          hasQuestions ? <>
            <section className="two-column student-section student-section-question">
              <Suspense fallback={sectionFallback('题库训练')}>
                <PracticePanel
                  question={props.currentQuestion}
                  practiceSet={props.practiceSet}
                  practiceSetResult={props.practiceSetResult}
                  student={props.student}
                  targetWeakPointTitle={report.weakPoints[0]?.title ?? null}
                  taskContext={props.todayTaskLaunchContext?.destination === 'question' ? launchedQuestionTask : null}
                  taskNextStep={todayTaskNextStep}
                  redoQuestionId={props.redoQuestionId}
                  status={props.practiceStatus}
                  submitting={props.practiceSubmitting}
                  answerResult={props.practiceAnswerResult}
                  questionProgress={props.currentQuestionProgress}
                  hasNextQuestion={props.hasNextQuestion}
                  taskReachedTarget={launchedQuestionTaskReachedTarget}
                  onSubmitAnswer={props.onSubmitAnswer}
                  onNextQuestion={props.onNextQuestion}
                  onTaskNextStep={todayTaskNextStep ? () => props.onNavigate(todayTaskNextStep.targetSection) : undefined}
                  onSubmitPracticeSet={props.onSubmitPracticeSet}
                  onStartLearningMode={props.onStartLearningMode}
                  onRestartPracticeSet={props.onRestartPracticeSet}
                  onRestartQuestionBank={props.onRestartQuestionBank}
                  onNavigate={props.onNavigate}
                  onRetryPracticeSet={props.onRetryPracticeSet}
                />
              </Suspense>
              {props.practiceAnswerResult ? (
                <ContextualCoach
                  request={{
                    contextType: 'question',
                    questionId: props.currentQuestion.id,
                    ...(props.practiceAnswerResult.selectedAnswer
                      ? { selectedAnswer: props.practiceAnswerResult.selectedAnswer }
                      : {}),
                  }}
                  title="题目 Contextual AI Coach"
                  prompt="请解释当前题目的考点、易错原因和下一步学习建议。"
                />
              ) : null}
              <WeaknessReportPanel report={report} />
            </section>
            <ReviewResourcesPanel resources={props.reviewResources} onRetry={props.onRetryReviewResources} />
          </> : (
            <div className="panel">
              <div className="panel-heading"><div><p className="eyebrow">题库训练</p><h3>暂无可用题目</h3></div></div>
              <p className="empty-state">题库暂未就绪，请先完成入学诊断，或等待教研更新题目后重试。</p>
            </div>
          )
        ) : (
          <ModuleUnavailable title="题库训练" resource={overviewResource} onRetry={onRetryOverview} />
        )
      ) : null}

      {visibleSection === 'ai' ? (
        studentOverviewReady ? <>
          <Suspense fallback={sectionFallback('AI 答疑')}>
            <TutorPanel
              reply={props.tutorReply}
              followUp={props.aiFollowUp}
              status={props.tutorStatus}
              failed={props.tutorFailed}
              onRetry={props.onAskTutor}
              onAskTutor={props.onAskTutor}
              onAskFollowUp={props.onAskFollowUp}
            />
          </Suspense>
        </> : (
          <ModuleUnavailable title="AI 答疑" resource={overviewResource} onRetry={onRetryOverview} />
        )
      ) : null}

      {visibleSection === 'wrong-book' ? (
        studentOverviewReady ? (
          <Suspense fallback={sectionFallback('错题复盘')}>
            <MistakeWorkspace
              wrongQuestions={props.wrongQuestions}
              initialKnowledgePointId={props.todayTaskLaunchContext?.destination === 'wrong-book'
                ? props.todayTaskLaunchContext.knowledgePointId
                : undefined}
              summary={props.wrongQuestionSummary}
              status={props.wrongStatus}
              detailQuestionId={props.detailQuestionId}
              onOpenDetail={props.onOpenDetail}
              onCloseDetail={props.onCloseDetail}
              onReview={props.onReviewWrongQuestion}
              onRetrySummary={props.onRetryWrongQuestionSummary}
              onRedo={props.onRedo}
              onPracticeVariant={props.onPracticeVariant}
              onOpenCatalog={props.onOpenCatalog}
              onNavigate={props.onNavigate}
            />
          </Suspense>
        ) : (
          <ModuleUnavailable title="错题复盘" resource={overviewResource} onRetry={onRetryOverview} />
        )
      ) : null}
    </div>
  );
}
