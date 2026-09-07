import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ApiStateIndicator, type ApiState } from './components/ApiStateIndicator';
import { ThemeToggle } from './components/ThemeToggle';
import { ErrorReasonSelector } from './components/ErrorReasonSelector';
import { OverlayDialog } from './components/OverlayDialog';
import { sectionFallback } from './components/sectionFallback';
import {
  RoleNavigation,
  StudentBottomNav,
  type RoleSection,
} from './layouts/RoleNavigation';
import { useRoleSectionNavigation, withTimeout } from './features/navigation/useRoleSectionNavigation';
import { AdminLayout, StudentLayout, TeacherLayout } from './layouts/RoleLayouts';
import { useAdminWorkspaceActions } from './features/admin/useAdminWorkspaceActions';
import { AccountPanel } from './features/auth/AccountPanel';
import { AuthExperience } from './features/auth/AuthExperience';
import { OnboardingFlow } from './features/onboarding/OnboardingFlow';
import { StudentSections } from './features/student/StudentSections';
import { StudentLoopGuide } from './features/student/StudentLoopGuide';
import { SpriteWidget } from './features/sprite/SpriteWidget';
import { TrainingHero } from './features/practice/training-room/TrainingHero';
import { buildTrainingRoomViewModel } from './features/practice/training-room/trainingRoomViewModel';
import {
  advanceQuestion,
  advanceQuestionByCurrentId,
  beginRedo,
  beginVariantRetest,
  hasNextQuestionByCurrentId,
  restartAttempt,
  type PracticeAttemptState,
} from './features/practice/practiceAttemptState';
import {
  createPracticeSubmissionGate,
  finishPracticeSubmission,
  invalidatePracticeAttempt,
  isCurrentPracticeSubmission,
  tryStartPracticeSubmission,
  type PracticeSubmissionGate,
} from './features/practice/practiceSubmissionGate';
import { useStudentProgressData } from './hooks/useStudentProgressData';
import { useStudentLearningData } from './hooks/useStudentLearningData';
import { useDashboardOverviewData } from './hooks/useDashboardOverviewData';
import { useCanonicalOverviewData } from './hooks/useCanonicalOverviewData';
import { useStudentContextData } from './hooks/useStudentContextData';
import { useRoleWorkspaceData } from './hooks/useRoleWorkspaceData';
import { ModuleUnavailable } from './components/ModuleResourceState';
import type { SessionView } from './api/endpoints/sessions';
import type { PracticeAnswerResult } from './api/endpoints/practice';
import { fetchDueReviews, type DueReviewsResponse } from './api/endpoints/review';
import { isMockAllowed } from './api/env';
import { trackEvent } from './api/events';
import { fetchOnboardingStatus, fetchTodayPlan, startTask, type TodayPlan as TodayPlanType } from './api/endpoints/onboarding';
import {
  completeNodeQuest,
  fetchNodeQuest,
  type NodeQuestState,
} from './api/endpoints/score-center';
import {
  resolveLaunchableTodayTask,
  shouldClearTodayTaskLaunch,
  startTodayTaskIfCurrent,
  type TodayPlanTask,
  type TodayTaskLaunchContext,
} from './features/onboarding/todayLearningRoute';
import {
  createKnowledgePoint,
  createTeacherQuestion,
  deleteTeacherQuestion,
  createMockAiFollowUp,
  createMockGeneratedPaper,
  createMockOverview,
  createMockPaperSubmitResult,
  fetchDashboardOverview,
  fetchQuestions,
  fetchStageAssessment,
  generatePaper,
  prepareExamPaper,
  requestAiFollowUp,
  requestTutorReply,
  reviewWrongQuestion,
  submitDiagnosticProfile,
  submitFeedback,
  submitPaper,
  submitPracticeAnswer,
  updateTeacherQuestion,
  updateSystemConfig,
  isStaticDemoMode,
  type AiFollowUp,
  type GeneratedPaper,
  type PaperSubmitResult,
  type PrepareExamPaperInput,
  type PracticeSetResult,
  type StageAssessmentResult,
  type TutorReply,
} from './api';
import { computeStageReport } from '@kaoyan408/shared';
import type { FeedbackDraft, MistakeReason, UserProfile, UserRole } from '@kaoyan408/shared';
import { useAuth } from './hooks/useAuth';
import {
  roleLabel,
  createInitialPaperSession,
} from './constants';
import { isStudentOverviewReady, resolveSessionQuestions, shouldHydrateSessionFromOverview } from './studentSessionPolicy';
import type { StudentActionCommandDescriptor } from './features/student/actions/studentActionCommand';

// Phase 3.3: route/section-level code splitting — heavy workspaces load on demand.
// Student section workspaces live in features/student/StudentSections (Phase 3.4).
const ExamSession = lazy(() => import('./components/ExamSession').then((m) => ({ default: m.ExamSession })));
const ExamReportView = lazy(() => import('./components/ExamReport').then((m) => ({ default: m.ExamReportView })));
const AdminWorkspace = lazy(() => import('./features/admin/AdminWorkspace').then((m) => ({ default: m.AdminWorkspace })));
const TeacherWorkspace = lazy(() => import('./features/teacher/TeacherWorkspace').then((m) => ({ default: m.TeacherWorkspace })));
const TodayPlan = lazy(() => import('./components/TodayPlan').then((m) => ({ default: m.TodayPlan })));
const KnowledgeCatalog = lazy(() => import('./features/knowledge-catalog/KnowledgeCatalog').then((m) => ({ default: m.KnowledgeCatalog })));

interface QuestContext {
  nodeId: string;
  title: string;
  questionIds: string[];
}

export function App() {
  const {
    authSession, sessionUser, authMode, authStatus,
    setAuthSession, setSessionUser, setAuthMode, setAuthStatus,
    handleRoleSwitch, handleAccountSubmit, handlePasswordChangeSubmit, handleLogout, lastAuthAction,
  } = useAuth();

  const authKey = authSession?.accessToken ?? authSession?.token;
  const studentDataEnabled = isStaticDemoMode() || sessionUser?.role === 'student';
  const dashboardOverview = useDashboardOverviewData(studentDataEnabled, authKey);
  const canonicalOverview = useCanonicalOverviewData(studentDataEnabled && sessionUser?.role === 'student', authKey);
  const studentContext = useStudentContextData(studentDataEnabled && sessionUser?.role === 'student', authKey);
  const { setOverview, refreshOverview } = dashboardOverview;
  const overview = dashboardOverview.overview.data ?? createMockOverview();
  const studentOverviewReady = isStudentOverviewReady(
    studentDataEnabled,
    dashboardOverview.overview.data !== null,
  );
  const roleWorkspace = useRoleWorkspaceData(sessionUser?.role, authKey);
  const adminUsers = roleWorkspace.adminUsers.data;
  const teacherQuestionList = roleWorkspace.questions.data ?? [];
  const {
    setAdminMetrics,
    setAdminUsers,
    setReviewQueue,
    setSystemConfig,
    setQuestions: setTeacherQuestionList,
  } = roleWorkspace;
  const [apiState, setApiState] = useState<ApiState>('connecting');
  const adminActions = useAdminWorkspaceActions({
    users: adminUsers,
    setUsers: setAdminUsers,
    setMetrics: setAdminMetrics,
    setReviewQueue,
    setApiState,
  });
  const [lastSyncAt, setLastSyncAt] = useState<string | undefined>();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activationDismissed, setActivationDismissed] = useState(false);
  const [todayPlan, setTodayPlan] = useState<TodayPlanType | null>(null);
  const [todayPlanLoading, setTodayPlanLoading] = useState(false);
  const [todayPlanError, setTodayPlanError] = useState('');
  const [dueReviews, setDueReviews] = useState<DueReviewsResponse | null>(null);
  const [dueReviewsLoading, setDueReviewsLoading] = useState(false);
  const [dueReviewsError, setDueReviewsError] = useState('');
  const [todayTaskLaunchContext, setTodayTaskLaunchContext] = useState<TodayTaskLaunchContext | null>(null);
  const [todayTaskLaunchingId, setTodayTaskLaunchingId] = useState<string | null>(null);
  const [todayTaskLaunchError, setTodayTaskLaunchError] = useState('');
  const todayTaskLaunchOwnerRef = useRef<string | undefined>(sessionUser?.id);
  const todayTaskLaunchGenerationRef = useRef(0);
  const [questContext, setQuestContext] = useState<QuestContext | null>(null);
  const [questResults, setQuestResults] = useState<boolean[]>([]);
  const [questState, setQuestState] = useState<NodeQuestState | null>(null);
  const [questError, setQuestError] = useState('');
  const [questVersion, setQuestVersion] = useState(0);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [diagnosticStatus, setDiagnosticStatus] = useState('完成入学诊断后，系统会更新备考阶段、目标和学习计划。');
  const [assessmentStatus, setAssessmentStatus] = useState('等待生成阶段测评');
  const [practiceStatus, setPracticeStatus] = useState('选择一个选项后，系统会自动判题并更新提分报告。');
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceSubmitting, setPracticeSubmitting] = useState(false);
  const [practiceAnswerResult, setPracticeAnswerResult] = useState<PracticeAnswerResult | null>(null);
  const [reasonQueue, setReasonQueue] = useState<Array<{
    questionId: string;
    correct: boolean;
    timeSpentSec: number;
    isReview: boolean;
    mistakeReason?: MistakeReason | null;
  }>>([]);
  const reasonPrompt = reasonQueue[0] ?? null;
  const practiceTimerRef = useRef<{ questionId: string; activeMs: number; startedAt: number | null }>({
    questionId: '', activeMs: 0, startedAt: null,
  });
  const practiceSubmissionGateRef = useRef<PracticeSubmissionGate>(createPracticeSubmissionGate());
  const [redoQuestionId, setRedoQuestionId] = useState<string | null>(null);
  const [variantOfQuestionId, setVariantOfQuestionId] = useState<string | null>(null);

  function readPracticeAttemptState(): PracticeAttemptState {
    return {
      answerResult: practiceAnswerResult,
      submitting: practiceSubmitting,
      reasonQueue,
      redoQuestionId,
      variantOfQuestionId,
      index: practiceIndex,
    };
  }

  function applyPracticeAttemptState(next: PracticeAttemptState) {
    setPracticeAnswerResult(next.answerResult);
    setPracticeSubmitting(next.submitting);
    setReasonQueue(next.reasonQueue);
    setRedoQuestionId(next.redoQuestionId);
    setVariantOfQuestionId(next.variantOfQuestionId);
    setPracticeIndex(next.index);
  }

  const [detailQuestionId, setDetailQuestionId] = useState<string | null>(null);
  const [catalogFocusNodeId, setCatalogFocusNodeId] = useState<string | null>(null);
  const [wrongStatus, setWrongStatus] = useState('错题复盘后，系统会给出同考点练习建议。');
  const [stageResult, setStageResult] = useState<StageAssessmentResult | null>(null);
  const [tutorReply, setTutorReply] = useState<TutorReply | null>(null);
  const [aiFollowUp, setAiFollowUp] = useState<AiFollowUp | null>(() => isMockAllowed() ? createMockAiFollowUp() : null);
  const [tutorStatus, setTutorStatus] = useState('选择一道题后，可以让 AI 助教按标准解析拆解思路。');
  const [tutorFailed, setTutorFailed] = useState(false);
  const [teacherStatus, setTeacherStatus] = useState('教师可以新增题目，学生端会立即用于检索和练习。');
  const [configStatus, setConfigStatus] = useState('推荐策略参数会影响阶段测评和每日训练建议。');
  const [knowledgeStatus, setKnowledgeStatus] = useState('教研可以维护 408 知识树，新增考点后可用于题目绑定。');
  const [paperStatus, setPaperStatus] = useState('教师可以按知识点生成专项卷、阶段卷或模拟卷。');
  const [latestPaper, setLatestPaper] = useState<GeneratedPaper | null>(null);
  const [paperResult, setPaperResult] = useState<PaperSubmitResult | null>(() => isMockAllowed() ? createMockPaperSubmitResult() : null);
  const [paperSession, setPaperSession] = useState<PaperSubmitResult['examSession'] | null>(null);
  const [learningSessionType, setLearningSessionType] = useState<SessionView['type'] | null>(null);
  const [learningSessionMode, setLearningSessionMode] = useState(false);
  const [planFocusTaskId, setPlanFocusTaskId] = useState<string | null>(null);
  const [examReportSessionId, setExamReportSessionId] = useState<string | null>(null);
  const [resumedLearningSession, setResumedLearningSession] = useState<SessionView | null>(null);
  const [practiceSetResult, setPracticeSetResult] = useState<PracticeSetResult | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState('可以提交站内反馈，也可以打开问卷继续补充详细建议。');
  const studentProgress = useStudentProgressData(
    sessionUser?.id ?? overview.student.id,
    studentDataEnabled,
    authKey,
  );
  const {
    refreshTrialProgress,
    refreshStudyReminders,
    refreshSprintPlan,
    refreshMasteryMap,
    refreshLearningProfile,
    refreshAll: refreshStudentProgress,
  } = studentProgress;
  const studentLearning = useStudentLearningData(studentDataEnabled, authKey);
  const {
    refreshPracticeSet,
    refreshReviewResources,
    refreshWrongQuestionSummary,
    refreshAssessmentHistory,
    updateAssessmentHistory,
  } = studentLearning;
  const { activeSection, setActiveSection, visibleSection, resetSectionForRole } = useRoleSectionNavigation(sessionUser?.role);

  function handleStudentNavigate(section: RoleSection, command?: StudentActionCommandDescriptor) {
    if (command?.kind === 'quest' && command.questionIds?.length) {
      setQuestContext((current) => ({
        nodeId: command.knowledgeNodeId,
        title: current?.nodeId === command.knowledgeNodeId ? current.title : '',
        questionIds: [...command.questionIds!],
      }));
      setQuestResults([]);
      setQuestState(null);
      setQuestError('');
    }
    if (command?.kind === 'assessment'
      && command.assessmentId === stageResult?.id
      && command.questionId) {
      setDetailQuestionId(command.questionId);
    }
    setActiveSection(section);
  }

  useEffect(() => {
    if (todayTaskLaunchContext && activeSection !== todayTaskLaunchContext.destination) {
      setTodayTaskLaunchContext(null);
    }
  }, [activeSection, todayTaskLaunchContext]);

  useEffect(() => {
    // The quest survives while the student stays in practice (question) or
    // returns to the catalog (knowledge-catalog) to settle the round.
    if (questContext && activeSection !== 'question' && activeSection !== 'knowledge-catalog') {
      setQuestContext(null);
      setQuestResults([]);
    }
  }, [activeSection, questContext]);

  useEffect(() => {
    const nextUserId = sessionUser?.id;
    if (shouldClearTodayTaskLaunch(todayTaskLaunchOwnerRef.current, nextUserId)) {
      todayTaskLaunchGenerationRef.current += 1;
      invalidatePracticeAttempt(practiceSubmissionGateRef.current);
      setTodayTaskLaunchContext(null);
      setTodayTaskLaunchingId(null);
      setTodayTaskLaunchError('');
      setPracticeIndex(0);
      setPracticeSubmitting(false);
      setPracticeAnswerResult(null);
      setReasonQueue([]);
      setRedoQuestionId(null);
      setVariantOfQuestionId(null);
    }
    todayTaskLaunchOwnerRef.current = nextUserId;
  }, [sessionUser?.id]);

  useEffect(() => {
    const resource = dashboardOverview.overview;
    if (shouldHydrateSessionFromOverview(isStaticDemoMode(), resource.data !== null)) {
      setSessionUser((current) => current ?? resource.data?.student ?? null);
    }
    if (sessionUser?.role === 'teacher') {
      const resources = [roleWorkspace.questions, roleWorkspace.classAnalytics];
      setApiState(resources.some((item) => item.state === 'error') ? 'error' : resources.every((item) => item.state === 'ready') ? 'connected' : resources.some((item) => item.state === 'mock') ? 'mock' : 'connecting');
      setLastSyncAt(resources.map((item) => item.lastSyncAt).filter(Boolean).sort().at(-1));
      return;
    }
    if (sessionUser?.role === 'admin') {
      const resources = [roleWorkspace.adminMetrics, roleWorkspace.adminUsers, roleWorkspace.teacherAuthorizations, roleWorkspace.reviewQueue, roleWorkspace.systemConfig, roleWorkspace.feedback];
      setApiState(resources.some((item) => item.state === 'error') ? 'error' : resources.every((item) => item.state === 'ready') ? 'connected' : resources.some((item) => item.state === 'mock') ? 'mock' : 'connecting');
      setLastSyncAt(resources.map((item) => item.lastSyncAt).filter(Boolean).sort().at(-1));
      return;
    }
    setApiState(resource.state === 'ready' ? 'connected' : resource.state === 'loading' ? 'connecting' : resource.state);
    setLastSyncAt(resource.lastSyncAt);
  }, [dashboardOverview.overview, roleWorkspace.adminMetrics, roleWorkspace.adminUsers, roleWorkspace.classAnalytics, roleWorkspace.feedback, roleWorkspace.questions, roleWorkspace.reviewQueue, roleWorkspace.systemConfig, roleWorkspace.teacherAuthorizations, sessionUser?.role, setSessionUser]);

  // Phase 3: Check onboarding status on mount
  useEffect(() => {
    if (isStaticDemoMode()) { setOnboardingChecked(true); return; }
    if (!studentDataEnabled || !authKey) {
      setOnboardingChecked(false);
      setShowOnboarding(false);
      setTodayPlan(null);
      setTodayPlanError('');
      setTodayPlanLoading(false);
      return;
    }
    fetchOnboardingStatus()
      .then((status) => {
        if (!status.completed) setShowOnboarding(true);
        setOnboardingChecked(true);
      })
      .catch(() => setOnboardingChecked(true));
  }, [authKey, studentDataEnabled]);

  // Phase 3: Load today plan when onboarding is done
  useEffect(() => {
    if (!studentDataEnabled || !authKey || !onboardingChecked || showOnboarding) return;
    if (isStaticDemoMode()) return;
    setTodayPlanLoading(true);
    setTodayPlanError('');
    fetchTodayPlan()
      .then((plan) => setTodayPlan(plan))
      .catch((error) => setTodayPlanError(error instanceof Error ? error.message : '今日计划加载失败，请重试。'))
      .finally(() => setTodayPlanLoading(false));
  }, [authKey, onboardingChecked, showOnboarding, studentDataEnabled]);

  useEffect(() => {
    if (!studentDataEnabled || !authKey || isStaticDemoMode()) {
      setDueReviews(null);
      setDueReviewsError('');
      setDueReviewsLoading(false);
      return;
    }
    void refreshDueReviews();
  }, [authKey, studentDataEnabled]);

  async function handleOnboardingComplete(result: Awaited<ReturnType<typeof import('./api/endpoints/onboarding').completeOnboarding>>) {
    setShowOnboarding(false);
    setTodayPlanError('');
    if (result.todayPlan) {
      setTodayPlan(result.todayPlan as TodayPlanType);
    }
    await Promise.allSettled([refreshOverview(), refreshStudentProgress(), studentContext.refresh()]);
  }

  async function refreshTodayPlan() {
    setTodayPlanLoading(true);
    setTodayPlanError('');
    try {
      const plan = await fetchTodayPlan();
      setTodayPlan(plan);
      await Promise.allSettled([refreshOverview(), refreshStudentProgress(), studentContext.refresh()]);
    } catch (error) {
      setTodayPlanError(error instanceof Error ? error.message : '今日计划更新失败，请重试。');
    } finally {
      setTodayPlanLoading(false);
    }
  }

  async function refreshDueReviews() {
    setDueReviewsLoading(true);
    setDueReviewsError('');
    try {
      setDueReviews(await fetchDueReviews());
    } catch (error) {
      setDueReviewsError(error instanceof Error ? error.message : '到期复习加载失败，请重试。');
    } finally {
      setDueReviewsLoading(false);
    }
  }

  const { student, questions, report, plan, wrongQuestions, learningCalendar, stageAssessment, practiceRecords } = overview;
  const stageReport = useMemo(() => {
    if (!studentLearning.assessmentHistory.data || !studentProgress.masteryMap.data || !studentLearning.wrongQuestionSummary.data) {
      return null;
    }
    return computeStageReport({
      records: practiceRecords,
      assessments: studentLearning.assessmentHistory.data.items,
      masteryPoints: studentProgress.masteryMap.data.subjects.flatMap((subject) =>
        subject.points.map((point) => ({ ...point, subject: subject.subject })),
      ),
      wrongSummary: studentLearning.wrongQuestionSummary.data,
      streakDays: learningCalendar.streakDays,
    });
  }, [
    learningCalendar.streakDays,
    practiceRecords,
    studentLearning.assessmentHistory.data,
    studentLearning.wrongQuestionSummary.data,
    studentProgress.masteryMap.data,
  ]);
  const refreshStageReport = () => {
    void Promise.allSettled([refreshAssessmentHistory(), refreshMasteryMap(), refreshWrongQuestionSummary()]);
  };
  const examQuestions = latestPaper?.questions.length ? latestPaper.questions : questions;
  const examResourceId = latestPaper?.id ?? `mock-exam-${examQuestions.map((question) => question.id).join('-')}`;
  const practiceSessionQuestions = studentLearning.practiceSet.data?.questions ?? [];
  const learningQuestionCatalog = [...questions, ...practiceSessionQuestions, ...stageAssessment.questions, ...examQuestions];
  const activeLearningQuestionIds = resumedLearningSession?.questionIds ?? (
    learningSessionType === 'practice_set'
      ? practiceSessionQuestions.map((question) => question.id)
      : learningSessionType === 'stage_assessment'
        ? stageAssessment.questions.map((question) => question.id)
        : examQuestions.map((question) => question.id)
  );
  const activeLearningQuestions = resolveSessionQuestions(
    activeLearningQuestionIds,
    resumedLearningSession?.questions ?? [],
    learningQuestionCatalog,
  );
  const activeLearningResourceId = resumedLearningSession?.resourceId ?? (
    learningSessionType === 'practice_set'
      ? studentLearning.practiceSet.data?.id
      : learningSessionType === 'stage_assessment'
        ? stageAssessment.id
        : examResourceId
  );
  const activeLearningTimeLimit = learningSessionType === 'practice_set'
    ? studentLearning.practiceSet.data?.estimatedMinutes ?? 30
    : learningSessionType === 'stage_assessment'
      ? stageAssessment.estimatedMinutes
      : 180;
  const sessionTrainingSource = learningSessionType === 'practice_set'
    ? 'practice_set' as const
    : learningSessionType === 'stage_assessment'
      ? 'stage_assessment' as const
      : 'paper' as const;
  const sessionTrainingModel = buildTrainingRoomViewModel({
    source: sessionTrainingSource,
    title: learningSessionType === 'practice_set'
      ? studentLearning.practiceSet.data?.title
      : learningSessionType === 'stage_assessment'
        ? stageAssessment.title
        : latestPaper?.title,
    target: learningSessionType === 'practice_set'
      ? studentLearning.practiceSet.data?.focus
      : learningSessionType === 'stage_assessment'
        ? stageAssessment.focusKnowledgePoints[0]?.title
        : latestPaper?.paperType,
    estimatedMinutes: learningSessionType === 'practice_set'
      ? studentLearning.practiceSet.data?.estimatedMinutes
      : learningSessionType === 'stage_assessment'
        ? stageAssessment.estimatedMinutes
        : latestPaper?.estimatedMinutes,
    sessionProgress: resumedLearningSession
      ? {
          currentIndex: resumedLearningSession.currentIndex,
          totalQuestions: resumedLearningSession.totalQuestions,
        }
      : null,
  });
  const activePracticeQuestions = todayTaskLaunchContext?.destination === 'question'
    ? todayTaskLaunchContext.questionIds?.length
      ? questions.filter((question) => todayTaskLaunchContext.questionIds!.includes(question.id))
      : questions.filter((question) => question.knowledgePointIds.includes(todayTaskLaunchContext.knowledgePointId))
    : questContext
      ? questions.filter((question) => questContext.questionIds.includes(question.id))
      : questions;
  const activePracticeQuestionIds = activePracticeQuestions.map((question) => question.id);
  const currentQuestion = (redoQuestionId
    ? activePracticeQuestions.find((question) => question.id === redoQuestionId)
    : undefined)
    ?? activePracticeQuestions[Math.min(practiceIndex, Math.max(0, activePracticeQuestions.length - 1))];
  const activePracticeQuestionPosition = activePracticeQuestionIds.indexOf(currentQuestion.id);
  const hasNextActivePracticeQuestion = hasNextQuestionByCurrentId(
    activePracticeQuestionIds,
    currentQuestion.id,
    practiceIndex,
  );

  useEffect(() => {
    practiceTimerRef.current = {
      questionId: currentQuestion.id,
      activeMs: 0,
      startedAt: document.hidden ? null : performance.now(),
    };
  }, [currentQuestion.id]);

  useEffect(() => {
    function handlePracticeVisibility() {
      const timer = practiceTimerRef.current;
      if (document.hidden) {
        if (timer.startedAt !== null) timer.activeMs += Math.max(0, performance.now() - timer.startedAt);
        timer.startedAt = null;
      } else if (timer.startedAt === null) {
        timer.startedAt = performance.now();
      }
    }
    document.addEventListener('visibilitychange', handlePracticeVisibility);
    return () => document.removeEventListener('visibilitychange', handlePracticeVisibility);
  }, []);

  function readPracticeElapsedSec() {
    const timer = practiceTimerRef.current;
    const now = performance.now();
    if (timer.startedAt !== null) timer.activeMs += Math.max(0, now - timer.startedAt);
    const elapsedSec = Math.max(1, Math.round(timer.activeMs / 1000));
    timer.activeMs = 0;
    timer.startedAt = null;
    return elapsedSec;
  }

  function restartPracticeTimer() {
    practiceTimerRef.current.activeMs = 0;
    practiceTimerRef.current.startedAt = document.hidden ? null : performance.now();
  }

  function addMockPaperResultToHistory(result: PaperSubmitResult, paper: GeneratedPaper) {
    updateAssessmentHistory((current) => {
      const nextItem = {
        id: `assessment-history-static-${Date.now()}`,
        paperId: paper.id,
        userId: result.userId,
        title: paper.title,
        submittedAt: result.submittedAt,
        score: result.score,
        totalScore: 100,
        accuracyRate: result.accuracyRate,
        elapsedSec: result.examSession.elapsedSec,
        unansweredCount: result.examSession.unansweredCount,
        weakPointTitle: result.weakKnowledgePoints[0] ?? '限时整卷训练',
        reviewSuggestion: result.accuracyRate >= 80
          ? '本次表现较稳定，建议进入真题整卷训练，并保留错题复盘节奏。'
          : `先处理 ${result.weakKnowledgePoints[0] ?? '本次薄弱点'}，再补 1 组变式题验证是否真正掌握。`,
      };
      const items = [nextItem, ...current.items].slice(0, 5);
      const previous = current.items[0];
      const bestScore = Math.max(...items.map((item) => item.score));
      const improvementText = previous
        ? nextItem.score > previous.score
          ? `较上次提升 ${nextItem.score - previous.score} 分，继续巩固本次薄弱点。`
          : nextItem.score === previous.score
            ? '与上次持平，建议通过限时训练和错题复盘提高稳定性。'
            : `较上次下降 ${previous.score - nextItem.score} 分，先复盘本次错题再进入新题训练。`
        : '已建立第一次测评基线，下一次可重点观察正确率和用时变化。';

      return {
        userId: result.userId,
        items,
        summary: {
          attemptCount: items.length,
          bestScore,
          latestAccuracyRate: nextItem.accuracyRate,
          improvementText,
        },
      };
    });
  }

  async function onRoleSwitch(role: UserRole) {
    const result = await handleRoleSwitch(role);
    // 等新角色的导航监听器挂载后再切到默认分区，避免旧角色监听器
    // 把 resetSectionForRole 写入的 hash 当作非法值弹回上一分区。
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetSectionForRole(role);
    setApiState(result);
  }

  async function onLogout() {
    await handleLogout();
    setApiState(isMockAllowed() ? 'mock' : 'connecting');
  }

  async function handleSubmitDiagnostic() {
    const targetScore = student.targetScore;
    const currentScore = student.currentScore;
    const remainingDays = student.remainingDays;
    const dailyHours = student.dailyHours;
    const weakestSubject = student.weakestSubject;
    if (
      targetScore == null ||
      currentScore == null ||
      remainingDays == null ||
      dailyHours == null ||
      !weakestSubject
    ) {
      setDiagnosticStatus('缺少目标分、当前水平、备考天数等基础信息，请先完成入学引导。');
      return;
    }
    setDiagnosticStatus('正在生成入学诊断...');

    try {
      const profile = await submitDiagnosticProfile({
        targetScore,
        currentScore,
        remainingDays,
        dailyHours,
        weakestSubject,
      });
      const nextOverview = await fetchDashboardOverview();
      setOverview(nextOverview);
      setSessionUser(nextOverview.student);
      setApiState('connected');
      await refreshTrialProgress();
      await refreshStudyReminders();
      await refreshSprintPlan();
      await refreshMasteryMap();
      await refreshWrongQuestionSummary();
      await studentContext.refresh();
      setDiagnosticStatus(`${profile.diagnosis} 已切换到${profile.stage}阶段计划。`);
    } catch {
      setDiagnosticStatus('入学诊断提交失败，请稍后重试。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleSubmitAnswer(selectedAnswer: string) {
    if (practiceSubmitting || practiceAnswerResult) return;
    const submissionToken = tryStartPracticeSubmission(practiceSubmissionGateRef.current);
    if (!submissionToken) return;
    setPracticeSubmitting(true);
    setPracticeStatus('正在提交答案...');
    const timeSpentSec = readPracticeElapsedSec();

    try {
      const isVariant = variantOfQuestionId !== null && variantOfQuestionId !== currentQuestion.id;
      const record = await submitPracticeAnswer({
        questionId: currentQuestion.id,
        knowledgePointId: currentQuestion.knowledgePointIds[0],
        selectedAnswer,
        timeSpentSec,
        variantQuestionId: isVariant ? variantOfQuestionId : undefined,
      });
      if (!isCurrentPracticeSubmission(practiceSubmissionGateRef.current, submissionToken)) return;
      setPracticeAnswerResult(record);
      if (questContext) {
        setQuestResults((current) => [...current, record.correct]);
      }
      setApiState('connected');
      void Promise.allSettled([
        fetchDashboardOverview().then((nextOverview) => setOverview(nextOverview)),
        refreshTodayPlan(),
        refreshStudyReminders(),
        refreshSprintPlan(),
        refreshMasteryMap(),
        refreshWrongQuestionSummary(),
      ]);
      const isReview = redoQuestionId === currentQuestion.id;
      if (isVariant) {
        if (record.correct) {
          setPracticeStatus(record.variantProgress?.message ?? '变式题回答正确，已更新掌握状态。');
          restartPracticeTimer();
        } else {
          setReasonQueue([{
            questionId: currentQuestion.id,
            correct: false,
            timeSpentSec,
            isReview: false,
            mistakeReason: record.mistakeReason,
          }]);
          setPracticeStatus('变式题回答错误，请选择错因；原错题复习进度已重置。');
        }
      } else if (!record.correct || isReview) {
        setReasonQueue([{
          questionId: currentQuestion.id,
          correct: record.correct,
          timeSpentSec,
          isReview,
          mistakeReason: record.mistakeReason,
        }]);
        setPracticeStatus(record.correct ? '重做正确，请确认本次错因以调整复习间隔。' : '回答错误，请选择最符合本次情况的错因。');
      } else {
        setPracticeStatus('回答正确，已记录本次练习，可继续下一题。');
        restartPracticeTimer();
      }
    } catch {
      if (!isCurrentPracticeSubmission(practiceSubmissionGateRef.current, submissionToken)) return;
      setPracticeStatus(isMockAllowed() ? '提交失败，当前显示本地演示数据。' : '提交失败，请重试。本次作答尚未保存。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    } finally {
      if (finishPracticeSubmission(practiceSubmissionGateRef.current, submissionToken)) {
        setPracticeSubmitting(false);
      }
    }
  }

  function handleNextQuestion() {
    if (activePracticeQuestions.length === 0) return;
    invalidatePracticeAttempt(practiceSubmissionGateRef.current);
    if (!hasNextActivePracticeQuestion) {
      applyPracticeAttemptState(advanceQuestion(readPracticeAttemptState()));
      setPracticeStatus('已到当前题库末尾，可开始专项练习或前往错题本复习。');
      return;
    }
    applyPracticeAttemptState(advanceQuestionByCurrentId(readPracticeAttemptState(), activePracticeQuestionIds, currentQuestion.id));
    restartPracticeTimer();
    setPracticeStatus('选择选项后，系统会自动判题并更新提分报告。');
  }

  function handleSubmitPracticeSet() {
    const practiceSet = studentLearning.practiceSet.data;
    if (!practiceSet) {
      setPracticeStatus('推荐题组尚未加载，请先重新加载本模块。');
      return;
    }
    setResumedLearningSession(null);
    setLearningSessionType('practice_set');
    setLearningSessionMode(false);
    setPracticeStatus('专项练习已开始（训练模式），作答进度会自动保存。');
    void trackEvent('practice.set_start');
  }

  function handleRestartPracticeSet() {
    const practiceSet = studentLearning.practiceSet.data;
    if (!practiceSet) {
      setPracticeStatus('推荐题组尚未加载，请先重新加载本模块。');
      return;
    }
    invalidatePracticeAttempt(practiceSubmissionGateRef.current);
    setPracticeSetResult(null);
    setResumedLearningSession(null);
    setLearningSessionType('practice_set');
    setLearningSessionMode(false);
    setPracticeStatus('再来一组：同知识点训练已开始，作答进度会自动保存。');
    void trackEvent('practice.set_restart');
  }

  function handleRestartQuestionBank() {
    if (questions.length === 0) return;
    setTodayTaskLaunchContext(null);
    invalidatePracticeAttempt(practiceSubmissionGateRef.current);
    applyPracticeAttemptState(restartAttempt(readPracticeAttemptState()));
    restartPracticeTimer();
    setPracticeStatus('已重新开始题库训练，选择选项后系统会自动判题。');
    void trackEvent('practice.bank_restart');
  }

  function handleStartLearningMode() {
    const practiceSet = studentLearning.practiceSet.data;
    if (!practiceSet || practiceSet.questions.length === 0) {
      setPracticeStatus('推荐题组尚未加载，无法进入学习模式，请先重新加载本模块。');
      return;
    }
    setResumedLearningSession(null);
    setLearningSessionType('practice_set');
    setLearningSessionMode(true);
    setPracticeStatus('学习模式已开始：每题作答后立即核对答案并查看解析。');
    void trackEvent('practice.learning_mode_start');
  }

  async function handleLearningCheckAnswer(input: {
    questionId: string;
    selectedAnswer: string;
    timeSpentSec: number;
    confidence?: '确定' | '不确定' | '完全不会';
    usedHint?: boolean;
    answerModified?: boolean;
  }): Promise<PracticeAnswerResult> {
    const question = activeLearningQuestions.find((item) => item.id === input.questionId);
    if (!question) throw new Error('题目不存在，无法核对答案。');
    return submitPracticeAnswer({
      questionId: input.questionId,
      knowledgePointId: question.knowledgePointIds[0],
      selectedAnswer: input.selectedAnswer,
      timeSpentSec: input.timeSpentSec,
      confidence: input.confidence,
      usedHint: input.usedHint,
      answerModified: input.answerModified,
    });
  }

  async function handleLaunchTodayTask(task: TodayPlanTask) {
    const launch = resolveLaunchableTodayTask(todayPlan?.priorityTasks ?? [task], task, questions, wrongQuestions);
    setTodayTaskLaunchError('');
    if (launch.kind === 'error') {
      setTodayTaskLaunchError(launch.message);
      return;
    }
    if (launch.kind === 'navigate-plan') {
      setPlanFocusTaskId(launch.taskId);
      setActiveSection('plan');
      return;
    }
    if (launch.skippedTaskIds.length > 0) {
      setTodayTaskLaunchError(`已跳过暂无内容的任务，自动开始：${launch.task.title}`);
    }
    const launchGeneration = todayTaskLaunchGenerationRef.current + 1;
    const launchOwnerId = todayTaskLaunchOwnerRef.current;
    todayTaskLaunchGenerationRef.current = launchGeneration;
    const isCurrentLaunch = () =>
      todayTaskLaunchGenerationRef.current === launchGeneration
      && todayTaskLaunchOwnerRef.current === launchOwnerId;
    setTodayTaskLaunchingId(launch.task.id);
    try {
      const canCommit = await startTodayTaskIfCurrent(launch.task.id, startTask, isCurrentLaunch);
      if (!canCommit) return;
      invalidatePracticeAttempt(practiceSubmissionGateRef.current);
      applyPracticeAttemptState(restartAttempt(readPracticeAttemptState()));
      setRedoQuestionId(null);
      setVariantOfQuestionId(null);
      setTodayTaskLaunchContext(launch.preflight.context);
      setPracticeStatus(launch.preflight.context.destination === 'question'
        ? `已开始 ${launch.task.title}，本轮只练习对应知识点。`
        : `已打开 ${launch.task.title} 的待复盘错题。`);
      void refreshTodayPlan();
      void trackEvent('task.start', { taskId: launch.task.id, mode: launch.task.mode });
      setActiveSection(launch.preflight.context.destination);
    } catch (error) {
      if (!isCurrentLaunch()) return;
      setTodayTaskLaunchError(error instanceof Error ? error.message : '任务启动失败，请重试。');
    } finally {
      if (isCurrentLaunch()) setTodayTaskLaunchingId(null);
    }
  }

  async function handleReviewWrongQuestion(questionId: string) {
    setWrongStatus('正在记录错题复盘...');
    void trackEvent('wrong.open_review', { questionId });

    try {
      const reviewed = await reviewWrongQuestion(questionId);
      const nextOverview = await fetchDashboardOverview();
      setOverview(nextOverview);
      await refreshTrialProgress();
      await refreshStudyReminders();
      await refreshSprintPlan();
      await refreshMasteryMap();
      await refreshWrongQuestionSummary();
      await refreshDueReviews();
      await studentContext.refresh();
      setApiState('connected');
      setWrongStatus(`已复盘 ${reviewed.knowledgePointTitle}。${reviewed.nextAction}`);
    } catch {
      setWrongStatus('错题复盘记录失败，请稍后重试。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  function handlePracticeQuestionFromCatalog(questionId: string, title: string) {
    invalidatePracticeAttempt(practiceSubmissionGateRef.current);
    applyPracticeAttemptState(beginRedo(readPracticeAttemptState(), questionId));
    setDetailQuestionId(null);
    setPracticeStatus(`正在练习：${title}。请选择答案。`);
    setActiveSection('question');
  }

  function handleOpenCatalogNode(nodeId: string) {
    setCatalogFocusNodeId(nodeId);
    setActiveSection('knowledge-catalog');
  }

  async function handleStartQuestFromCatalog(nodeId: string, title: string, questionIds: string[]) {
    if (questionIds.length === 0) {
      setQuestError('该节点暂无可闯关题目');
      return;
    }
    setQuestError('');
    invalidatePracticeAttempt(practiceSubmissionGateRef.current);
    applyPracticeAttemptState(restartAttempt(readPracticeAttemptState()));
    setRedoQuestionId(null);
    setVariantOfQuestionId(null);
    setTodayTaskLaunchContext(null);
    setQuestResults([]);
    setQuestState(null);
    setQuestContext({ nodeId, title, questionIds });
    setDetailQuestionId(null);
    setPracticeStatus(`已开始闯关：${title}。答完 ${questionIds.length} 题后回到详情页结算正确率。`);
    setActiveSection('question');
    void trackEvent('quest.start', { nodeId });
    try {
      setQuestState(await fetchNodeQuest(nodeId));
    } catch {
      // 状态徽章仍可通过 mastery 摘要展示，闯关流程不因状态加载失败中断。
    }
  }

  async function handleCompleteQuest() {
    const current = questContext;
    if (!current) return;
    const answered = questResults.length;
    if (answered === 0) {
      setQuestError('尚未作答，无法结算闯关');
      return;
    }
    setQuestError('');
    const correct = questResults.filter(Boolean).length;
    const accuracy = Math.round((correct / answered) * 100);
    try {
      const next = await completeNodeQuest(current.nodeId, accuracy);
      setQuestState(next);
      setQuestVersion((version) => version + 1);
      setQuestContext(null);
      setQuestResults([]);
      setPracticeStatus(
        next.status === 'passed'
          ? `闯关成功！${current.title} 已通关（正确率 ${accuracy}%）。`
          : `闯关完成（正确率 ${accuracy}%），达到 60% 即可通关，可再闯一次。`,
      );
      void trackEvent('quest.complete', { nodeId: current.nodeId, accuracy, passed: next.status === 'passed' });
    } catch (error) {
      setQuestError(error instanceof Error ? error.message : '闯关结算失败，请重试。');
      setPracticeStatus('闯关结算失败，请重试。');
    }
  }

  async function handleGenerateAssessment() {
    setAssessmentStatus('正在生成阶段测评...');
    void trackEvent('assessment.generate');

    try {
      const assessment = await fetchStageAssessment();
      setOverview((current) => ({
        ...current,
        stageAssessment: assessment,
      }));
      setStageResult(null);
      setApiState('connected');
      setAssessmentStatus(`已生成 ${assessment.questions.length} 题阶段测评，预计 ${assessment.estimatedMinutes} 分钟，可点击「开始阶段测评」开始作答。`);
    } catch {
      setAssessmentStatus(isMockAllowed() ? '阶段测评生成失败，当前显示本地演示数据。' : '阶段测评生成失败，请稍后重试。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  function handleSubmitAssessment() {
    if (stageAssessment.questions.length === 0) {
      setAssessmentStatus('当前阶段测评没有可用题目，请先重新生成。');
      return;
    }
    setResumedLearningSession(null);
    setLearningSessionType('stage_assessment');
    setLearningSessionMode(false);
    setAssessmentStatus('阶段测评已开始，作答进度会自动保存。');
  }

  async function handleAskTutor() {
    setTutorStatus('AI 助教正在整理解析...');
    setTutorFailed(false);
    void trackEvent('tutor.ask');

    try {
      const reply = await withTimeout(requestTutorReply({
        questionId: currentQuestion.id,
        selectedAnswer: practiceAnswerResult?.selectedAnswer,
        prompt: '请解释这道题的考点和易错点。',
      }), 25000);
      setTutorReply(reply);
      setApiState('connected');
      setTutorStatus(`已生成 ${reply.knowledgePointTitle} 的答疑解析。`);
      setActiveSection('ai');
    } catch {
      setTutorFailed(true);
      setTutorStatus('AI 答疑超时或不可用，可稍后重试，或先查看标准解析。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleAskFollowUp(message: string, mode?: string) {
    setTutorStatus('AI 正在整理追问解释和复习卡片...');
    setTutorFailed(false);

    try {
      const reply = await withTimeout(requestAiFollowUp({
        questionId: currentQuestion.id,
        message,
        mode,
      }), 25000);
      setAiFollowUp(reply);
      setApiState('connected');
      setTutorStatus(`已生成 ${reply.reviewCards.length} 张复习卡片：${reply.relatedKnowledgePoint.title}`);
      setActiveSection('ai');
    } catch {
      setTutorFailed(true);
      setTutorStatus('AI 追问超时或不可用，可稍后重试，或先查看标准解析和错题复盘建议。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleCreateTeacherQuestion() {
    setTeacherStatus('正在新增题目...');

    try {
      const created = await createTeacherQuestion({
        stem: 'Cache 命中率提高后，平均访存时间通常会如何变化？',
        options: ['增大', '不变', '减小', '无法判断'],
        answer: 'C',
        analysis: '命中率提高后，访问更多落在高速 Cache 中，平均访存时间通常减小。',
        knowledgePointIds: ['co-cache'],
        difficulty: currentQuestion.difficulty,
        type: currentQuestion.type,
        source: '教师新增',
        year: 2026,
        expectedTimeSec: 90,
      });
      const nextQuestions = await fetchQuestions();
      setTeacherQuestionList(nextQuestions);
      setApiState('connected');
      setTeacherStatus(`已新增 ${created.id}，当前题库共 ${nextQuestions.length} 题。`);
    } catch {
      setTeacherStatus('题目录入失败，请检查题干、选项、答案和知识点绑定。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleFilterTeacherQuestions() {
    setTeacherStatus('正在按 Cache 考点筛选题目...');

    try {
      const nextQuestions = await fetchQuestions({ knowledgePointId: 'co-cache' });
      setTeacherQuestionList(nextQuestions);
      setApiState('connected');
      setTeacherStatus(`已筛选出 ${nextQuestions.length} 道 Cache 映射与替换相关题目。`);
    } catch {
      if (isMockAllowed()) {
        setTeacherQuestionList(teacherQuestionList.filter((question) => question.knowledgePointIds.includes('co-cache')));
        setTeacherStatus('已使用本地演示题库筛选 Cache 相关题目。');
        setApiState('mock');
      } else {
        setTeacherStatus('题目筛选失败，当前列表保持不变，请稍后重试。');
        setApiState('error');
      }
    }
  }

  async function handleUpdateTeacherQuestion() {
    const target = teacherQuestionList.find((question) => question.id.startsWith('q-')) ?? teacherQuestionList[0];
    if (!target) {
      setTeacherStatus('当前没有可编辑的演示题目。');
      return;
    }

    setTeacherStatus('正在编辑演示题目...');

    if (isStaticDemoMode()) {
      const updated = {
        ...target,
        difficulty: '困难' as typeof target.difficulty,
        analysis: '更新后的解析用于教师维护题目质量。',
        expectedTimeSec: 150,
      };
      setTeacherQuestionList(teacherQuestionList.map((question) => question.id === target.id ? updated : question));
      setTeacherStatus(`已使用静态演示数据更新 ${target.id}：难度改为困难，预计 150 秒。`);
      setApiState('mock');
      return;
    }

    try {
      const updated = await updateTeacherQuestion(target.id, {
        difficulty: '困难',
        analysis: '更新后的解析用于教师维护题目质量。',
        expectedTimeSec: 150,
      });
      const nextQuestions = await fetchQuestions();
      setTeacherQuestionList(nextQuestions);
      setApiState('connected');
      setTeacherStatus(`已更新 ${updated.id}：难度 ${updated.difficulty}，预计 ${updated.expectedTimeSec} 秒。`);
    } catch {
      setTeacherStatus('题目编辑失败，请稍后重试。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleDeleteTeacherQuestion() {
    const target = teacherQuestionList.find((question) => !['q-001', 'q-002'].includes(question.id)) ?? teacherQuestionList[0];
    if (!target) {
      setTeacherStatus('当前没有可删除的演示题目。');
      return;
    }

    setTeacherStatus('正在删除演示题目...');

    if (isStaticDemoMode()) {
      setTeacherQuestionList(teacherQuestionList.filter((question) => question.id !== target.id));
      setTeacherStatus(`已使用静态演示数据删除 ${target.id}。`);
      setApiState('mock');
      return;
    }

    try {
      const deleted = await deleteTeacherQuestion(target.id);
      const nextQuestions = await fetchQuestions();
      setTeacherQuestionList(nextQuestions);
      setApiState('connected');
      setTeacherStatus(`已删除 ${deleted.id}，筛选列表已刷新。`);
    } catch {
      setTeacherStatus('题目删除失败，请稍后重试。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleCreateKnowledgePoint() {
    setKnowledgeStatus('正在新增知识点...');

    try {
      const point = await createKnowledgePoint({
        id: `os-memory-${Date.now()}`,
        subject: '操作系统',
        chapter: '内存管理',
        title: '分页与地址转换',
        importance: 5,
        frequency: 4,
        prerequisites: ['进程地址空间'],
      });
      setApiState('connected');
      setKnowledgeStatus(`已新增知识点：${point.title}。`);
    } catch {
      setKnowledgeStatus('知识点新增失败，请检查 ID、科目、章节和标题。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleGeneratePaper() {
    setPaperStatus('正在生成专项卷...');

    if (isStaticDemoMode()) {
      const mockPaper = createMockGeneratedPaper({
        title: '存储系统专项卷',
        paperType: '专项卷',
        knowledgePointIds: ['co-cache'],
        questionCount: 2,
        createdBy: 'teacher-001',
      });
      setLatestPaper(mockPaper);
      setPaperSession(createInitialPaperSession(mockPaper));
      setPaperResult(null);
      setApiState('mock');
      setPaperStatus(`已使用静态演示数据生成 ${mockPaper.title}，共 ${mockPaper.questionCount} 题，可继续提交查看报告。`);
      return;
    }

    try {
      const paper = await generatePaper({
        title: '存储系统专项卷',
        paperType: '专项卷',
        knowledgePointIds: ['co-cache'],
        questionCount: 2,
        createdBy: 'teacher-001',
      });
      setLatestPaper(paper);
      setPaperSession(createInitialPaperSession(paper));
      setPaperResult(null);
      setApiState('connected');
      setPaperStatus(`已生成 ${paper.title}，共 ${paper.questionCount} 题，预计 ${paper.estimatedMinutes} 分钟。`);
    } catch {
      if (!isMockAllowed()) {
        setPaperStatus('试卷生成失败，请检查 API 连接后重试。');
        setApiState('error');
        return;
      }
      const mockPaper = createMockGeneratedPaper({
        title: '存储系统专项卷',
        paperType: '专项卷',
        knowledgePointIds: ['co-cache'],
        questionCount: 2,
        createdBy: 'teacher-001',
      });
      setLatestPaper(mockPaper);
      setPaperSession(createInitialPaperSession(mockPaper));
      setPaperResult(null);
      setPaperStatus(`已使用静态演示数据生成 ${mockPaper.title}，共 ${mockPaper.questionCount} 题，可继续提交查看报告。`);
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  function handleStartPaperSession() {
    const paper = latestPaper;
    if (!paper) {
      setPaperStatus('请先生成一套演示试卷。');
      return;
    }

    const elapsedSec = paper.questions.reduce((sum, question) => sum + question.expectedTimeSec + 15, 0);
    const session = {
      answeredCount: paper.questions.length,
      unansweredCount: 0,
      totalQuestions: paper.questions.length,
      elapsedSec,
      timeLimitSec: paper.estimatedMinutes * 60,
      overtime: elapsedSec > paper.estimatedMinutes * 60,
      progressRate: 100,
    };
    setPaperSession(session);
    setPaperStatus(`已完成演示答卷：${session.answeredCount}/${session.totalQuestions} 题，用时 ${Math.round(session.elapsedSec / 60)} 分钟，可提交查看报告。`);
  }

  async function handleSubmitPaper() {
    const paper = latestPaper;
    if (!paper) {
      setPaperStatus('请先生成一套演示试卷。');
      return;
    }

    setPaperStatus('正在提交演示试卷...');

    if (isStaticDemoMode()) {
      const mockResult = createMockPaperSubmitResult(paper, student.id);
      setPaperResult(mockResult);
      setPaperSession(mockResult?.examSession ?? null);
      if (mockResult) addMockPaperResultToHistory(mockResult, paper);
      setApiState('mock');
      setPaperStatus(mockResult
        ? `已使用静态演示数据提交：${mockResult.score} 分，正确率 ${mockResult.accuracyRate}%，可查看试卷报告。`
        : '试卷提交失败，请稍后重试。');
      return;
    }

    try {
      const result = await submitPaper({
paperId: paper.id,
        answers: paper.questions.map((question, index) => ({
          questionId: question.id,
          selectedAnswer: index === 0 ? (question.answer === 'A' ? 'B' : 'A') : question.answer,
          timeSpentSec: question.expectedTimeSec + 15,
        })),
      });
      const nextOverview = await fetchDashboardOverview();
      setPaperResult(result);
      setPaperSession(result.examSession);
      setOverview(nextOverview);
      await refreshMasteryMap();
      await refreshWrongQuestionSummary();
      await refreshAssessmentHistory();
      setApiState('connected');
      setPaperStatus(`试卷已提交：${result.score} 分，正确率 ${result.accuracyRate}%，已同步 ${result.syncedPracticeRecordCount} 条练习记录。`);
    } catch {
      if (!isMockAllowed()) {
        setPaperStatus('试卷提交失败，未生成任何演示成绩，请稍后重试。');
        setApiState('error');
        return;
      }
      const mockResult = createMockPaperSubmitResult(paper, student.id);
      setPaperResult(mockResult);
      setPaperSession(mockResult?.examSession ?? null);
      if (mockResult) addMockPaperResultToHistory(mockResult, paper);
      setPaperStatus(mockResult
        ? `已使用静态演示数据提交：${mockResult.score} 分，正确率 ${mockResult.accuracyRate}%，可查看试卷报告。`
        : '试卷提交失败，请稍后重试。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleApplySprintConfig() {
    setConfigStatus('正在应用冲刺期推荐策略...');

    try {
      const nextConfig = await updateSystemConfig({
        updatedBy: 'admin-001',
        recommendation: {
          stageAssessmentQuestionLimit: 2,
          dailyTargetQuestionCount: 35,
          speedRiskMultiplier: 1.25,
        },
      });
      const nextAssessment = await fetchStageAssessment();
      setSystemConfig(nextConfig);
      setOverview((current) => ({
        ...current,
        stageAssessment: nextAssessment,
      }));
      setApiState('connected');
      setConfigStatus(`已应用冲刺策略：阶段测评 ${nextConfig.recommendation.stageAssessmentQuestionLimit} 题，每日 ${nextConfig.recommendation.dailyTargetQuestionCount} 题。`);
    } catch {
      setConfigStatus('系统配置更新失败，请稍后重试。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleSubmitFeedback(draft: FeedbackDraft): Promise<boolean> {
    setFeedbackStatus('正在提交体验反馈...');

    try {
      const feedback = await submitFeedback(draft);
      setApiState('connected');
      setFeedbackStatus(`已提交反馈 ${feedback.id}，也可以继续填写详细问卷。`);
      await Promise.allSettled([
        refreshTrialProgress(),
        refreshStudyReminders(),
        refreshSprintPlan(),
      ]);
      return true;
    } catch {
      setFeedbackStatus('反馈提交失败，请稍后重试或直接填写问卷。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
      return false;
    }
  }

  async function handlePrepareStudentExam(input: PrepareExamPaperInput) {
    const paper = isStaticDemoMode()
      ? createMockGeneratedPaper({
          title: input.paperType === '专项卷' ? `${input.subject}专项卷` : '408 模拟卷',
          paperType: input.paperType,
          questionCount: input.questionCount,
          createdBy: student.id,
        })
      : await prepareExamPaper(input);
    setLatestPaper(paper);
    setPaperResult(null);
    setResumedLearningSession(null);
    setExamReportSessionId(null);
    setLearningSessionType('paper');
    setLearningSessionMode(false);
    setApiState(isStaticDemoMode() ? 'mock' : 'connected');
  }

  function handleRetryActiveWorkspace() {
    if (sessionUser?.role === 'teacher') {
      void Promise.allSettled([roleWorkspace.refreshQuestions(), roleWorkspace.refreshClassAnalytics()]);
      return;
    }
    if (sessionUser?.role === 'admin') {
      void Promise.allSettled([
        roleWorkspace.refreshAdminMetrics(),
        roleWorkspace.refreshAdminUsers(),
        roleWorkspace.refreshReviewQueue(),
        roleWorkspace.refreshSystemConfig(),
        roleWorkspace.refreshFeedback(),
      ]);
      return;
    }
    void Promise.allSettled([refreshOverview(), studentContext.refresh()]);
  }

  const activeDataSource = sessionUser?.role === 'teacher'
    ? roleWorkspace.classAnalytics.data?.source
    : sessionUser?.role === 'admin'
      ? roleWorkspace.adminMetrics.data?.source
      : dashboardOverview.overview.data?.source;
  const hasAuthenticatedSession = Boolean(authSession?.refreshToken || authSession?.accessToken || authSession?.token || sessionUser);
  const shouldShowAuthGate = !hasAuthenticatedSession || Boolean(sessionUser?.mustChangePassword);
  const shouldShowRegistrationActivation = lastAuthAction === 'registered' && sessionUser?.role === 'student' && !activationDismissed;

  useEffect(() => {
    if (!sessionUser) setActivationDismissed(false);
  }, [sessionUser]);

  if (shouldShowRegistrationActivation) {
    return <OnboardingFlow userName={sessionUser?.name ?? ''} onEnterDashboard={() => setActivationDismissed(true)} />;
  }

  if (shouldShowAuthGate) {
    return (
      <AuthExperience
        user={sessionUser}
        hasRefreshToken={Boolean(authSession?.refreshToken)}
        authMode={authMode}
        status={authStatus}
        staticDemoMode={isStaticDemoMode()}
        showDemoRoles={isStaticDemoMode() || import.meta.env.DEV}
        onSubmit={handleAccountSubmit}
        onPasswordChangeSubmit={handlePasswordChangeSubmit}
        onToggleMode={() => setAuthMode((current) => current === 'login' ? 'register' : 'login')}
        onLogout={() => void handleLogout()}
        onRoleSwitch={(role) => void handleRoleSwitch(role)}
      />
    );
  }

  return (
    <main className="app-shell">
      <aside className={(sessionUser?.role ?? 'student') === 'student' ? 'sidebar sidebar-student' : 'sidebar'}>
        <div className="sidebar-brand">
          <p className="eyebrow">408 Score Boost</p>
          <h1>计算机考研 408 提分系统</h1>
        </div>
        <RoleNavigation role={sessionUser?.role} activeSection={activeSection} onNavigate={setActiveSection} />
      </aside>
      <StudentBottomNav role={sessionUser?.role} activeSection={activeSection} onNavigate={setActiveSection} />

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{roleLabel[sessionUser?.role ?? 'student']}工作区</p>
            <h2>
              {sessionUser?.role === 'student' || !sessionUser
                ? studentOverviewReady
                  ? `${student.name}，当前处于${student.stage}阶段`
                  : sessionUser
                    ? `${sessionUser.name}，学习数据待同步`
                    : '登录后载入个人学习数据'
                : `${sessionUser.name}，欢迎回来`}
            </h2>
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
            <span className="role-pill">{roleLabel[sessionUser?.role ?? 'student']}</span>
            <ApiStateIndicator
              state={apiState}
              lastSyncAt={lastSyncAt}
              source={activeDataSource}
              onRetry={handleRetryActiveWorkspace}
            />
          </div>
        </header>
        {apiState === 'mock' ? (
          <div className="demo-mode-banner" role="status">
            演示模式：数据保存在本地，未连接真实后端；生产环境不会出现此提示。
          </div>
        ) : null}

        {(sessionUser?.role ?? 'student') === 'student' ? (
          <StudentLoopGuide activeSection={visibleSection} onNavigate={setActiveSection} />
        ) : null}

        <StudentLayout role={sessionUser?.role}>
          <StudentSections
            visibleSection={visibleSection}
            studentOverviewReady={studentOverviewReady}
            overviewResource={dashboardOverview.overview}
            onRetryOverview={refreshOverview}
            student={student}
            questions={questions}
            report={report}
            plan={plan}
            wrongQuestions={wrongQuestions}
            learningCalendar={learningCalendar}
            canonicalOverview={canonicalOverview.overview.data}
            canonicalOverviewError={canonicalOverview.overview.error}
            studentContext={studentContext.context}
            stageReport={stageReport}
            masteryMap={studentProgress.masteryMap.data}
            masteryMapResource={studentProgress.masteryMap}
            trialProgress={studentProgress.trialProgress}
            studyReminders={studentProgress.studyReminders}
            sprintPlan={studentProgress.sprintPlan}
            learningProfile={studentProgress.learningProfile}
            reviewResources={studentLearning.reviewResources}
            assessmentHistory={studentLearning.assessmentHistory}
            practiceSet={studentLearning.practiceSet}
            practiceSetResult={practiceSetResult}
            wrongQuestionSummary={studentLearning.wrongQuestionSummary}
            dueReviews={dueReviews}
            dueReviewsLoading={dueReviewsLoading}
            dueReviewsError={dueReviewsError}
            onRetryDueReviews={refreshDueReviews}
            showOnboarding={showOnboarding}
            todayPlan={todayPlan}
            todayPlanLoading={todayPlanLoading}
            todayPlanError={todayPlanError}
            todayTaskLaunchingId={todayTaskLaunchingId}
            todayTaskLaunchError={todayTaskLaunchError}
            todayTaskLaunchContext={todayTaskLaunchContext}
            latestPaper={latestPaper}
            examResult={paperResult}
            examQuestionCount={examQuestions.length}
            remoteSessionsEnabled={!isStaticDemoMode()}
            redoQuestionId={redoQuestionId}
            practiceStatus={practiceStatus}
            practiceSubmitting={practiceSubmitting}
            practiceAnswerResult={practiceAnswerResult}
            currentQuestion={currentQuestion}
            currentQuestionProgress={{
              current: activePracticeQuestionPosition + 1,
              total: activePracticeQuestions.length,
            }}
            hasNextQuestion={hasNextActivePracticeQuestion}
            detailQuestionId={detailQuestionId}
            wrongStatus={wrongStatus}
            stageResult={stageResult}
            stageAssessment={stageAssessment}
            assessmentStatus={assessmentStatus}
            onSubmitAssessment={handleSubmitAssessment}
            onGenerateAssessment={handleGenerateAssessment}
            planFocusTaskId={planFocusTaskId}
            diagnosticStatus={diagnosticStatus}
            feedbackStatus={feedbackStatus}
            tutorReply={tutorReply}
            aiFollowUp={aiFollowUp}
            tutorStatus={tutorStatus}
            tutorFailed={tutorFailed}
            onNavigate={handleStudentNavigate}
            onLaunchTodayTask={handleLaunchTodayTask}
            onRetryTodayPlan={refreshTodayPlan}
            onOnboardingComplete={handleOnboardingComplete}
            onOpenReview={(questionId, command) => {
              if (command?.kind === 'assessment' && command.assessmentId !== stageResult?.id) return;
              setDetailQuestionId(questionId);
              setActiveSection('wrong-book');
            }}
            onResumeSession={(session) => {
              setResumedLearningSession(session);
              setExamReportSessionId(null);
              setLearningSessionType(session.type);
              setLearningSessionMode(false);
            }}
            onStartExam={handlePrepareStudentExam}
            onRetryStageReport={refreshStageReport}
            onRetryTrial={refreshTrialProgress}
            onRetryReminders={refreshStudyReminders}
            onRetrySprint={refreshSprintPlan}
            onRetryMastery={refreshMasteryMap}
            onRetryLearningProfile={refreshLearningProfile}
            onRetryReviewResources={refreshReviewResources}
            onRetryAssessmentHistory={refreshAssessmentHistory}
            onSubmitFeedback={handleSubmitFeedback}
            onSubmitDiagnostic={handleSubmitDiagnostic}
            onSubmitAnswer={handleSubmitAnswer}
            onNextQuestion={handleNextQuestion}
            onSubmitPracticeSet={handleSubmitPracticeSet}
            onStartLearningMode={handleStartLearningMode}
            onRestartPracticeSet={handleRestartPracticeSet}
            onRestartQuestionBank={handleRestartQuestionBank}
            onRetryPracticeSet={refreshPracticeSet}
            onQuickPracticeSet={refreshPracticeSet}
            onExamAlignedPractice={(enabled) => refreshPracticeSet(undefined, enabled ? 'exam_aligned' : undefined)}
            onOpenDetail={setDetailQuestionId}
            onCloseDetail={() => setDetailQuestionId(null)}
            onOpenCatalog={handleOpenCatalogNode}
            onReviewWrongQuestion={handleReviewWrongQuestion}
            onRetryWrongQuestionSummary={refreshWrongQuestionSummary}
            onRedo={(questionId, knowledgePointTitle) => {
              invalidatePracticeAttempt(practiceSubmissionGateRef.current);
              applyPracticeAttemptState(beginRedo(readPracticeAttemptState(), questionId));
              setDetailQuestionId(null);
              if (knowledgePointTitle) setPracticeStatus(`正在重做：${knowledgePointTitle}。请选择答案。`);
              setActiveSection('question');
            }}
            onPracticeVariant={(questionId, variantQuestionId) => {
              invalidatePracticeAttempt(practiceSubmissionGateRef.current);
              applyPracticeAttemptState(beginVariantRetest(readPracticeAttemptState(), questionId, variantQuestionId));
              setDetailQuestionId(null);
              setPracticeStatus('正在复测变式题：答对可推动原错题掌握度。');
              setActiveSection('question');
            }}
            onAskTutor={handleAskTutor}
            onAskFollowUp={handleAskFollowUp}
          />
        </StudentLayout>

        <AccountPanel
          user={sessionUser}
          fallbackName={studentOverviewReady ? student.name : undefined}
          hasRefreshToken={Boolean(authSession?.refreshToken)}
          authMode={authMode}
          status={authStatus}
          staticDemoMode={isStaticDemoMode()}
          showDemoRoles={isStaticDemoMode() || import.meta.env.DEV}
          onSubmit={handleAccountSubmit}
          onPasswordChangeSubmit={handlePasswordChangeSubmit}
          onToggleMode={() => setAuthMode((current) => current === 'login' ? 'register' : 'login')}
          onLogout={() => void onLogout()}
          onRoleSwitch={(role) => void onRoleSwitch(role)}
        />

        <AdminLayout role={sessionUser?.role}>
          <Suspense fallback={sectionFallback('管理端')}>
          <AdminWorkspace
            activeSection={visibleSection}
            metrics={roleWorkspace.adminMetrics}
            users={roleWorkspace.adminUsers}
            feedback={roleWorkspace.feedback}
            reviewQueue={roleWorkspace.reviewQueue}
            systemConfig={roleWorkspace.systemConfig}
            teacherAuthorizations={roleWorkspace.teacherAuthorizations}
            userStatus={adminActions.userStatus}
            reviewStatus={adminActions.reviewStatus}
            configStatus={configStatus}
            onRetryMetrics={roleWorkspace.refreshAdminMetrics}
            onRetryUsers={roleWorkspace.refreshAdminUsers}
            onRetryFeedback={roleWorkspace.refreshFeedback}
            onRetryReviewQueue={roleWorkspace.refreshReviewQueue}
            onRetrySystemConfig={roleWorkspace.refreshSystemConfig}
            onRetryTeacherAuthorizations={roleWorkspace.refreshTeacherAuthorizations}
            onGrantTeacherAuthorization={roleWorkspace.grantAuthorization}
            onRevokeTeacherAuthorization={roleWorkspace.revokeAuthorization}
            onUpdateTrialStatus={adminActions.updateTrialStatus}
            onSetAccountStatus={adminActions.setAccountStatus}
            onCreateTemporaryPassword={adminActions.createUserTemporaryPassword}
            onCreateManagedUser={adminActions.createInternalUser}
            onApproveReviewItem={adminActions.approveItem}
            onMarkReviewItemNeedsRecheck={adminActions.markNeedsRecheck}
            onApplySprintConfig={handleApplySprintConfig}
          />
          </Suspense>
        </AdminLayout>

        <StudentLayout role={sessionUser?.role}>
        {visibleSection === 'knowledge-catalog' ? (
          <Suspense fallback={sectionFallback('408知识图谱')}>
            <KnowledgeCatalog
              onNavigate={setActiveSection}
              onPracticeQuestion={handlePracticeQuestionFromCatalog}
              onStartQuest={handleStartQuestFromCatalog}
              onCompleteQuest={() => void handleCompleteQuest()}
              questContext={questContext !== null}
              questState={questState}
              questError={questError}
              questVersion={questVersion}
              focusNodeId={catalogFocusNodeId}
            />
          </Suspense>
        ) : null}
        </StudentLayout>

        <TeacherLayout role={sessionUser?.role}>
          <Suspense fallback={sectionFallback('教师端')}>
          <TeacherWorkspace
            activeSection={visibleSection}
            questions={roleWorkspace.questions}
            classAnalytics={roleWorkspace.classAnalytics}
            latestPaper={latestPaper}
            paperSession={paperSession}
            paperResult={paperResult}
            knowledgeStatus={knowledgeStatus}
            teacherStatus={teacherStatus}
            paperStatus={paperStatus}
            onRetryQuestions={roleWorkspace.refreshQuestions}
            onRetryClassAnalytics={roleWorkspace.refreshClassAnalytics}
            onCreateKnowledgePoint={handleCreateKnowledgePoint}
            onCreateQuestion={handleCreateTeacherQuestion}
            onFilterQuestions={handleFilterTeacherQuestions}
            onUpdateQuestion={handleUpdateTeacherQuestion}
            onDeleteQuestion={handleDeleteTeacherQuestion}
            onGeneratePaper={handleGeneratePaper}
            onStartPaperSession={handleStartPaperSession}
            onSubmitPaper={handleSubmitPaper}
          />
          </Suspense>
        </TeacherLayout>

      </section>
      {(sessionUser?.role ?? 'student') === 'student' && !learningSessionType ? (
        <SpriteWidget accountKey={sessionUser?.id ?? null} />
      ) : null}
      {learningSessionType ? (
        <div className="exam-workspace-overlay">
          <div className="training-room-session-intro">
            <TrainingHero model={sessionTrainingModel} />
          </div>
          <Suspense fallback={sectionFallback('考试界面')}>
          <ExamSession
            sessionType={learningSessionType}
            questionIds={activeLearningQuestionIds}
            questions={activeLearningQuestions}
            resourceId={activeLearningResourceId}
            timeLimitMin={activeLearningTimeLimit}
            localMode={isStaticDemoMode()}
            learningMode={learningSessionMode}
            onCheckAnswer={handleLearningCheckAnswer}
            onExit={() => {
              setLearningSessionType(null);
              setLearningSessionMode(false);
            }}
            onSubmit={(result) => {
              const completedType = learningSessionType;
              setLearningSessionType(null);
              setResumedLearningSession(null);
              setLearningSessionMode(false);
              if (isStaticDemoMode() && completedType === 'paper') {
                const mockResult = createMockPaperSubmitResult(latestPaper ?? undefined, student.id);
                setPaperResult(mockResult);
                setPaperSession(mockResult?.examSession ?? null);
                if (mockResult && latestPaper) addMockPaperResultToHistory(mockResult, latestPaper);
                setPaperStatus(mockResult
                  ? `模拟考试已完成：${mockResult.score} 分，正确率 ${mockResult.accuracyRate}%，报告已生成。`
                  : '模拟考试已提交。');
                setApiState('mock');
              } else if (isStaticDemoMode() && completedType === 'practice_set') {
                setPracticeStatus(`专项练习已完成：正确率 ${result.accuracyRate}%，错题已进入复盘队列。`);
                setApiState('mock');
              } else if (isStaticDemoMode() && completedType === 'stage_assessment') {
                setAssessmentStatus(`阶段测评已完成：${Math.round(result.accuracyRate)} 分，需复盘 ${result.records.filter((record) => !record.correct).length} 处。`);
                setApiState('mock');
              } else if (completedType === 'paper') {
                setExamReportSessionId(result.sessionId);
              } else if (completedType === 'practice_set' && result.workflowResult) {
                const practiceResult = result.workflowResult as PracticeSetResult;
                setPracticeSetResult(practiceResult);
                setPracticeStatus(`专项练习完成：正确率 ${practiceResult.accuracyRate}%，练习记录和错题本已更新。`);
              } else if (completedType === 'stage_assessment' && result.workflowResult) {
                const assessmentResult = result.workflowResult as StageAssessmentResult;
                setStageResult(assessmentResult);
                setAssessmentStatus(`阶段测评完成：${assessmentResult.score} 分，需复盘 ${assessmentResult.reviewItems.length} 处。`);
              }
              if (completedType !== 'paper') {
                setReasonQueue(result.records
                  .filter((record) => !record.correct)
                  .map((record) => ({
                    questionId: record.questionId,
                    correct: false,
                    timeSpentSec: record.timeSpentSec,
                    isReview: false,
                    mistakeReason: record.mistakeReason,
                  })));
              }
              void Promise.allSettled([
                refreshOverview(),
                refreshTodayPlan(),
                refreshPracticeSet(),
                refreshLearningProfile(),
                refreshTrialProgress(),
                refreshStudyReminders(),
                refreshSprintPlan(),
                refreshMasteryMap(),
                refreshWrongQuestionSummary(),
                refreshAssessmentHistory(),
              ]);
            }}
          />
          </Suspense>
        </div>
      ) : null}
      {examReportSessionId ? (
        <OverlayDialog label="考试报告" onClose={() => setExamReportSessionId(null)}>
          <Suspense fallback={sectionFallback('考试报告')}>
            <ExamReportView sessionId={examReportSessionId} onClose={() => setExamReportSessionId(null)} />
          </Suspense>
        </OverlayDialog>
      ) : null}
      {reasonPrompt ? (
        <ErrorReasonSelector
          key={reasonPrompt.questionId}
          questionId={reasonPrompt.questionId}
          correct={reasonPrompt.correct}
          timeSpentSec={reasonPrompt.timeSpentSec}
          isReview={reasonPrompt.isReview}
          inferredReason={reasonPrompt.mistakeReason ?? null}
          onClose={() => {
            invalidatePracticeAttempt(practiceSubmissionGateRef.current);
            if (reasonPrompt.correct && reasonPrompt.isReview) {
              setRedoQuestionId(null);
              setPracticeAnswerResult(null);
            }
            setReasonQueue((current) => current.slice(1));
            if (reasonQueue.length === 1) restartPracticeTimer();
            setPracticeStatus('已跳过错因自评，系统仍会保留本次练习记录。');
          }}
          onReported={(result) => {
            invalidatePracticeAttempt(practiceSubmissionGateRef.current);
            if (reasonPrompt.correct && reasonPrompt.isReview) {
              setRedoQuestionId(null);
              setPracticeAnswerResult(null);
            }
            setReasonQueue((current) => current.slice(1));
            if (reasonQueue.length === 1) restartPracticeTimer();
            setPracticeStatus(result.message);
            void Promise.allSettled([
              refreshOverview(),
              refreshTodayPlan(),
              refreshStudyReminders(),
              refreshMasteryMap(),
              refreshWrongQuestionSummary(),
              refreshDueReviews(),
            ]);
          }}
        />
      ) : null}
    </main>
  );
}
