import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiStateIndicator, type ApiState } from './components/ApiStateIndicator';
import { ExamSession } from './components/ExamSession';
import { ErrorReasonSelector } from './components/ErrorReasonSelector';
import { ExamReportView } from './components/ExamReport';
import {
  RoleNavigation,
  StudentBottomNav,
  type RoleSection,
} from './layouts/RoleNavigation';
import { useRoleSectionNavigation, withTimeout } from './features/navigation/useRoleSectionNavigation';
import { AdminLayout, StudentLayout, TeacherLayout } from './layouts/RoleLayouts';
import { AdminWorkspace } from './features/admin/AdminWorkspace';
import { useAdminWorkspaceActions } from './features/admin/useAdminWorkspaceActions';
import { AccountPanel } from './features/auth/AccountPanel';
import { TeacherWorkspace } from './features/teacher/TeacherWorkspace';
import { StudentLaunchpad } from './features/onboarding/StudentLaunchpad';
import { DiagnosticSummary } from './features/diagnostic/DiagnosticSummary';
import { StudyPlanOverview } from './features/plan/StudyPlanOverview';
import { PracticePanel } from './features/practice/PracticePanel';
import {
  advanceQuestion,
  beginRedo,
  beginVariantRetest,
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
import { WeaknessReportPanel } from './features/report/WeaknessReportPanel';
import { MistakeWorkspace } from './features/mistakes/MistakeWorkspace';
import { StageAssessmentPanel } from './features/assessment/StageAssessmentPanel';
import { AssessmentHistoryPanel } from './features/assessment/AssessmentHistoryPanel';
import { ReviewResourcesPanel } from './features/report/ReviewResourcesPanel';
import { StageReportPanel } from './features/report/StageReportPanel';
import { ReportSummaryPanel } from './features/report/ReportSummaryPanel';
import { TutorPanel } from './features/tutor/TutorPanel';
import { StudentProgressOverview } from './features/dashboard/StudentProgressOverview';
import { LearningProfilePanel } from './features/report/LearningProfilePanel';
import { FeedbackPanel } from './features/feedback/FeedbackPanel';
import { useStudentProgressData } from './hooks/useStudentProgressData';
import { useStudentLearningData } from './hooks/useStudentLearningData';
import { useDashboardOverviewData } from './hooks/useDashboardOverviewData';
import { useRoleWorkspaceData } from './hooks/useRoleWorkspaceData';
import { ModuleUnavailable } from './components/ModuleResourceState';
import { TodayPlan } from './components/TodayPlan';
import type { SessionView } from './api/endpoints/sessions';
import type { PracticeAnswerResult } from './api/endpoints/practice';
import { isMockAllowed } from './api/env';
import { trackEvent } from './api/events';
import { fetchOnboardingStatus, fetchTodayPlan, type TodayPlan as TodayPlanType } from './api/endpoints/onboarding';
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

export function App() {
  const {
    authSession, sessionUser, authMode, authStatus,
    setAuthSession, setSessionUser, setAuthMode, setAuthStatus,
    handleRoleSwitch, handleAccountSubmit, handlePasswordChangeSubmit, handleLogout,
  } = useAuth();

  const authKey = authSession?.accessToken ?? authSession?.token;
  const studentDataEnabled = isStaticDemoMode() || sessionUser?.role === 'student';
  const dashboardOverview = useDashboardOverviewData(studentDataEnabled, authKey);
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
  const [todayPlan, setTodayPlan] = useState<TodayPlanType | null>(null);
  const [todayPlanLoading, setTodayPlanLoading] = useState(false);
  const [todayPlanError, setTodayPlanError] = useState('');
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

  async function handleOnboardingComplete(result: Awaited<ReturnType<typeof import('./api/endpoints/onboarding').completeOnboarding>>) {
    setShowOnboarding(false);
    setTodayPlanError('');
    if (result.todayPlan) {
      setTodayPlan(result.todayPlan as TodayPlanType);
    }
    await Promise.allSettled([refreshOverview(), refreshStudentProgress()]);
  }

  async function refreshTodayPlan() {
    setTodayPlanLoading(true);
    setTodayPlanError('');
    try {
      const plan = await fetchTodayPlan();
      setTodayPlan(plan);
      await Promise.allSettled([refreshOverview(), refreshStudentProgress()]);
    } catch (error) {
      setTodayPlanError(error instanceof Error ? error.message : '今日计划更新失败，请重试。');
    } finally {
      setTodayPlanLoading(false);
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
  const currentQuestion = (redoQuestionId ? questions.find((question) => question.id === redoQuestionId) : undefined) ?? questions[Math.min(practiceIndex, Math.max(0, questions.length - 1))];

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
    resetSectionForRole(role);
    const result = await handleRoleSwitch(role);
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
    if (questions.length === 0) return;
    invalidatePracticeAttempt(practiceSubmissionGateRef.current);
    if (practiceIndex >= questions.length - 1) {
      applyPracticeAttemptState(advanceQuestion(readPracticeAttemptState()));
      setPracticeStatus('已到当前题库末尾，可开始专项练习或前往错题本复习。');
      return;
    }
    applyPracticeAttemptState(advanceQuestion(readPracticeAttemptState(), practiceIndex + 1));
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

  function handleContinueToday() {
    const incomplete = todayPlan?.priorityTasks.find((task) => task.status !== 'completed' && !task.completed);
    setPlanFocusTaskId(incomplete?.id ?? null);
    setActiveSection('plan');
    void trackEvent('nav.continue_today');
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
      setApiState('connected');
      setWrongStatus(`已复盘 ${reviewed.knowledgePointTitle}。${reviewed.nextAction}`);
    } catch {
      setWrongStatus('错题复盘记录失败，请稍后重试。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
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
      setAssessmentStatus(`已生成 ${assessment.questions.length} 题阶段测评，预计 ${assessment.estimatedMinutes} 分钟，可在下方点击「开始阶段测评」。`);
      setActiveSection('plan');
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
    void refreshOverview();
  }

  const activeDataSource = sessionUser?.role === 'teacher'
    ? roleWorkspace.classAnalytics.data?.source
    : sessionUser?.role === 'admin'
      ? roleWorkspace.adminMetrics.data?.source
      : dashboardOverview.overview.data?.source;
  const hasAuthenticatedSession = Boolean(authSession?.refreshToken || authSession?.accessToken || authSession?.token || sessionUser);
  const shouldShowAuthGate = !hasAuthenticatedSession || Boolean(sessionUser?.mustChangePassword);

  if (shouldShowAuthGate) {
    return (
      <main className="app-shell auth-shell auth-shell-redesign">
        <section className="auth-gate">
          <div className="auth-brand">
            <span className="auth-orb" aria-hidden="true">408</span>
            <p className="eyebrow">408 SCORE BOOST</p>
            <h1>计算机考研 408 提分系统</h1>
            <p>登录后同步学习计划、题库训练、错题复盘、学情分析和 AI 辅助，让备考路径更清楚。</p>
            <div className="auth-feature-grid" aria-label="系统能力">
              <span>题库训练</span>
              <span>错题复盘</span>
              <span>学情分析</span>
              <span>AI 辅助</span>
            </div>
            <p className="auth-role-copy">学生 / 教师 / 管理员均可进入对应工作台。</p>
          </div>
          <AccountPanel
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
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className={(sessionUser?.role ?? 'student') === 'student' ? 'sidebar sidebar-student' : 'sidebar'}>
        <div>
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
            <span className="role-pill">{roleLabel[sessionUser?.role ?? 'student']}</span>
            <ApiStateIndicator
              state={apiState}
              lastSyncAt={lastSyncAt}
              source={activeDataSource}
              onRetry={handleRetryActiveWorkspace}
            />
            {(sessionUser?.role === 'student' || !sessionUser) && studentOverviewReady ? (
              <button type="button" onClick={handleGenerateAssessment}>生成阶段测评</button>
            ) : null}
          </div>
        </header>
        {apiState === 'mock' ? (
          <div className="demo-mode-banner" role="status">
            演示模式：数据保存在本地，未连接真实后端；生产环境不会出现此提示。
          </div>
        ) : null}

        <StudentLayout role={sessionUser?.role}>
          {studentOverviewReady && visibleSection === 'dashboard' ? (
          <StudentLaunchpad
            showOnboarding={showOnboarding}
            todayPlan={todayPlan}
            todayPlanLoading={todayPlanLoading}
            todayPlanError={todayPlanError}
            latestPaper={latestPaper}
            examResult={paperResult}
            examQuestionCount={examQuestions.length}
            remoteSessionsEnabled={!isStaticDemoMode()}
            report={report}
            masteryMap={studentProgress.masteryMap.data}
            learningCalendar={learningCalendar}
            wrongQuestionSummary={studentLearning.wrongQuestionSummary.data}
            onNavigate={setActiveSection}
            onContinueToday={handleContinueToday}
            onOnboardingComplete={handleOnboardingComplete}
            onOpenReview={(questionId) => {
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
          />
          ) : null}
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

        <StudentLayout role={sessionUser?.role}>
          {!studentOverviewReady ? (
            <ModuleUnavailable title="学习概览" resource={dashboardOverview.overview} onRetry={refreshOverview} />
          ) : null}
        </StudentLayout>

        <StudentLayout role={sessionUser?.role}>
        {studentOverviewReady && visibleSection === 'report' ? <>
        <ReportSummaryPanel
          student={student}
          report={report}
          stageReport={stageReport}
          masteryMap={studentProgress.masteryMap.data}
          onRetry={refreshStageReport}
        />
        <StudentProgressOverview
          trialProgress={studentProgress.trialProgress}
          studyReminders={studentProgress.studyReminders}
          sprintPlan={studentProgress.sprintPlan}
          masteryMap={studentProgress.masteryMap}
          student={student}
          report={report}
          onRetryTrial={refreshTrialProgress}
          onRetryReminders={refreshStudyReminders}
          onRetrySprint={refreshSprintPlan}
          onRetryMastery={refreshMasteryMap}
          onNavigate={setActiveSection}
        />
        <LearningProfilePanel profile={studentProgress.learningProfile} onRetry={refreshLearningProfile} />
        <FeedbackPanel status={feedbackStatus} onSubmit={handleSubmitFeedback} />
        <DiagnosticSummary student={student} plan={plan} status={diagnosticStatus} onSubmit={handleSubmitDiagnostic} />
        <ReviewResourcesPanel resources={studentLearning.reviewResources} onRetry={refreshReviewResources} />
        <StageReportPanel report={stageReport} onRetry={refreshStageReport} />
        <AssessmentHistoryPanel history={studentLearning.assessmentHistory} onRetry={refreshAssessmentHistory} />
        </> : null}
        </StudentLayout>

        <AdminLayout role={sessionUser?.role}>
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
        </AdminLayout>

        <StudentLayout role={sessionUser?.role}>
        {studentOverviewReady && visibleSection === 'plan' ? <>
        <section id="study-calendar" className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">学习日历</p>
              <h3>连续学习 {learningCalendar.streakDays} 天</h3>
            </div>
            <span>今日 {learningCalendar.today.completedTaskCount} 项任务 · {learningCalendar.today.practiceCount} 次练习</span>
          </div>
          <div className="calendar-strip">
            {learningCalendar.days.map((day) => (
              <div key={day.date} className={`calendar-day ${day.isActive ? 'active' : ''}`}>
                <strong>{day.date.slice(5)}</strong>
                <span>{day.completedTaskCount + day.practiceCount}</span>
              </div>
            ))}
          </div>
        </section>

        {todayPlan ? (
          <TodayPlan
            plan={todayPlan}
            focusTaskId={planFocusTaskId}
            onRefresh={refreshTodayPlan}
            onOpenReview={(questionId) => {
              setDetailQuestionId(questionId);
              setActiveSection('wrong-book');
            }}
          />
        ) : todayPlanLoading || todayPlanError ? (
          <ModuleUnavailable
            title="今日计划"
            resource={{ data: null, state: todayPlanLoading ? 'loading' : 'error', error: todayPlanError || undefined }}
            onRetry={refreshTodayPlan}
          />
        ) : (
          <section className="panel">
            <div className="panel-heading">
              <div><p className="eyebrow">今日计划</p><h3>暂未生成今日计划</h3></div>
            </div>
            <p className="empty-state">完成入学引导和入学诊断后，系统会自动生成今日学习任务。</p>
          </section>
        )}

        <StageAssessmentPanel assessment={stageAssessment} result={stageResult} status={assessmentStatus} onSubmit={handleSubmitAssessment} />

        {!todayPlan && isMockAllowed() ? <StudyPlanOverview plan={plan} /> : null}
        </> : null}
        </StudentLayout>

        <StudentLayout role={sessionUser?.role}>
        {studentOverviewReady && visibleSection === 'question' ? (
          questions.length > 0 ? <>
          <section className="two-column">
            <PracticePanel
              question={currentQuestion}
              practiceSet={studentLearning.practiceSet}
              practiceSetResult={practiceSetResult}
              redoQuestionId={redoQuestionId}
              status={practiceStatus}
              submitting={practiceSubmitting}
              answerResult={practiceAnswerResult}
              hasNextQuestion={practiceIndex < questions.length - 1}
              onSubmitAnswer={handleSubmitAnswer}
              onNextQuestion={handleNextQuestion}
              onSubmitPracticeSet={handleSubmitPracticeSet}
              onStartLearningMode={handleStartLearningMode}
              onRestartPracticeSet={handleRestartPracticeSet}
              onRestartQuestionBank={handleRestartQuestionBank}
              onRetryPracticeSet={refreshPracticeSet}
            />
            <WeaknessReportPanel report={report} />
          </section>
          <ReviewResourcesPanel resources={studentLearning.reviewResources} onRetry={refreshReviewResources} />
          </> : (
            <div className="panel">
              <div className="panel-heading"><div><p className="eyebrow">题库训练</p><h3>暂无可用题目</h3></div></div>
              <p className="empty-state">题库暂未就绪，请先完成入学诊断，或等待教研更新题目后重试。</p>
            </div>
          )
        ) : null}
        </StudentLayout>

        <StudentLayout role={sessionUser?.role}>
        {studentOverviewReady && visibleSection === 'ai' ? <>
        <TutorPanel reply={tutorReply} followUp={aiFollowUp} status={tutorStatus} failed={tutorFailed} onRetry={handleAskTutor} onAskTutor={handleAskTutor} onAskFollowUp={handleAskFollowUp} />
        </> : null}
        </StudentLayout>

        <TeacherLayout role={sessionUser?.role}>
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
        </TeacherLayout>

        <StudentLayout role={sessionUser?.role}>
          {studentOverviewReady && visibleSection === 'wrong-book' ? (
          <MistakeWorkspace
            wrongQuestions={wrongQuestions}
            summary={studentLearning.wrongQuestionSummary}
            status={wrongStatus}
            detailQuestionId={detailQuestionId}
            onOpenDetail={setDetailQuestionId}
            onCloseDetail={() => setDetailQuestionId(null)}
            onReview={handleReviewWrongQuestion}
            onRetrySummary={refreshWrongQuestionSummary}
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
          />
          ) : null}
        </StudentLayout>
      </section>
      {learningSessionType ? (
        <div className="exam-workspace-overlay">
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
        </div>
      ) : null}
      {examReportSessionId ? (
        <div className="exam-workspace-overlay">
          <ExamReportView sessionId={examReportSessionId} onClose={() => setExamReportSessionId(null)} />
        </div>
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
            ]);
          }}
        />
      ) : null}
    </main>
  );
}
