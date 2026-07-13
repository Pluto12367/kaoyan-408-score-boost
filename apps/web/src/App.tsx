import { useEffect, useState } from 'react';
import { Brain, ClipboardCheck, Target } from 'lucide-react';
import { ApiStateIndicator, type ApiState } from './components/ApiStateIndicator';
import { OnboardingWizard } from './components/OnboardingWizard';
import { TodayPlan } from './components/TodayPlan';
import { WrongQuestionDetailView } from './components/WrongQuestionDetail';
import { ExamSession } from './components/ExamSession';
import { ExamReportView } from './components/ExamReport';
import { ResumeSessionBanner } from './components/ResumeSessionBanner';
import { RoleNavigation } from './layouts/RoleNavigation';
import { AdminLayout, StudentLayout, TeacherLayout } from './layouts/RoleLayouts';
import { AdminWorkspace } from './features/admin/AdminWorkspace';
import { TeacherWorkspace } from './features/teacher/TeacherWorkspace';
import type { SessionView } from './api/endpoints/sessions';
import { isMockAllowed } from './api/env';
import { fetchOnboardingStatus, fetchTodayPlan, type TodayPlan as TodayPlanType } from './api/endpoints/onboarding';
import {
  approveReviewItem,
  completeStudyTask,
  createKnowledgePoint,
  createTeacherQuestion,
  deleteTeacherQuestion,
  createMockAssessmentHistory,
  createMockAdminUserManagement,
  createMockAdminMetrics,
  createMockAiFollowUp,
  createMockFeedbackList,
  createMockGeneratedPaper,
  createMockMasteryMap,
  createMockOverview,
  createMockPaperSubmitResult,
  createMockLearningProfile,
  createMockPracticeSet,
  createMockReviewResourceRecommendations,
  createMockStudyReminders,
  createMockSprintPlan,
  createMockTrialProgress,
  createMockReviewQueue,
  createMockSystemConfig,
  createMockTeacherClassAnalytics,
  createMockWrongQuestionSummary,
  fetchAdminMetrics,
  fetchAdminUsers,
  fetchAssessmentHistory,
  fetchDashboardOverview,
  fetchFeedbackList,
  fetchLearningProfile,
  fetchMasteryMap,
  fetchQuestions,
  fetchRecommendedPracticeSet,
  fetchReviewResourceRecommendations,
  fetchReviewQueue,
  fetchStageAssessment,
  fetchStudyReminders,
  fetchSprintPlan,
  fetchSystemConfig,
  fetchTeacherClassAnalytics,
  fetchTrialProgress,
  fetchWrongQuestionSummary,
  generatePaper,
  markReviewItemNeedsRecheck,
  requestAiFollowUp,
  requestTutorReply,
  reviewWrongQuestion,
  submitDiagnosticProfile,
  submitFeedback,
  submitPaper,
  submitPracticeAnswer,
  submitPracticeSet,
  submitStageAssessment,
  updateAdminUserTrialStatus,
  updateTeacherQuestion,
  updateSystemConfig,
  isStaticDemoMode,
  type AdminMetrics,
  type AdminUserManagement,
  type AssessmentHistory,
  type AiFollowUp,
  type DashboardOverview,
  type GeneratedPaper,
  type FeedbackList,
  type LearningProfile,
  type MasteryMap,
  type PaperSubmitResult,
  type PracticeSet,
  type PracticeSetResult,
  type ReviewResourceRecommendation,
  type ReviewQueue,
  type StageAssessmentResult,
  type StudyReminders,
  type SprintPlan,
  type SystemConfig,
  type TaskCompletionAdjustment,
  type TeacherClassAnalytics,
  type TutorReply,
  type TrialProgress,
  type WrongQuestionSummary,
} from './api';
import type { UserProfile, UserRole } from '@kaoyan408/shared';
import { useAuth } from './hooks/useAuth';
import {
  priorityLabel,
  masteryStatusLabel,
  reviewCardTypeLabel,
  reviewResourceTypeLabel,
  roleLabel,
  permissionHint,
  createInitialPaperSession,
} from './constants';
import { DashboardProvider } from './hooks/useDashboard';

export function App() {
  const {
    authSession, sessionUser, authMode, authStatus,
    setAuthSession, setSessionUser, setAuthMode, setAuthStatus,
    handleRoleSwitch, handleAccountSubmit, handleLogout,
  } = useAuth();

  const [overview, setOverview] = useState<DashboardOverview>(() => createMockOverview());
  const [adminMetrics, setAdminMetrics] = useState<AdminMetrics>(() => createMockAdminMetrics());
  const [adminUsers, setAdminUsers] = useState<AdminUserManagement>(() => createMockAdminUserManagement());
  const [teacherClassAnalytics, setTeacherClassAnalytics] = useState<TeacherClassAnalytics>(() => createMockTeacherClassAnalytics());
  const [reviewQueue, setReviewQueue] = useState<ReviewQueue>(() => createMockReviewQueue());
  const [systemConfig, setSystemConfig] = useState<SystemConfig>(() => createMockSystemConfig());
  const [apiState, setApiState] = useState<ApiState>('connecting');
  const [lastSyncAt, setLastSyncAt] = useState<string | undefined>();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [todayPlan, setTodayPlan] = useState<TodayPlanType | null>(null);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [diagnosticStatus, setDiagnosticStatus] = useState('完成入学诊断后，系统会更新备考阶段、目标和学习计划。');
  const [assessmentStatus, setAssessmentStatus] = useState('等待生成阶段测评');
  const [practiceStatus, setPracticeStatus] = useState('选择一个选项后，系统会自动判题并更新提分报告。');
  const [taskStatus, setTaskStatus] = useState('今日任务等待完成。');
  const [redoQuestionId, setRedoQuestionId] = useState<string | null>(null);
  const [detailQuestionId, setDetailQuestionId] = useState<string | null>(null);
  const [wrongStatus, setWrongStatus] = useState('错题复盘后，系统会给出同考点练习建议。');
  const [stageResult, setStageResult] = useState<StageAssessmentResult | null>(null);
  const [tutorReply, setTutorReply] = useState<TutorReply | null>(null);
  const [aiFollowUp, setAiFollowUp] = useState<AiFollowUp>(() => createMockAiFollowUp());
  const [tutorStatus, setTutorStatus] = useState('选择一道题后，可以让 AI 助教按标准解析拆解思路。');
  const [teacherStatus, setTeacherStatus] = useState('教师可以新增题目，学生端会立即用于检索和练习。');
  const [reviewStatus, setReviewStatus] = useState('教师题目和 AI 生成内容会进入审核队列。');
  const [configStatus, setConfigStatus] = useState('推荐策略参数会影响阶段测评和每日训练建议。');
  const [knowledgeStatus, setKnowledgeStatus] = useState('教研可以维护 408 知识树，新增考点后可用于题目绑定。');
  const [paperStatus, setPaperStatus] = useState('教师可以按知识点生成专项卷、阶段卷或模拟卷。');
  const [latestPaper, setLatestPaper] = useState<GeneratedPaper | null>(null);
  const [paperResult, setPaperResult] = useState<PaperSubmitResult | null>(() => createMockPaperSubmitResult());
  const [paperSession, setPaperSession] = useState<PaperSubmitResult['examSession'] | null>(null);
  const [examOpen, setExamOpen] = useState(false);
  const [examReportSessionId, setExamReportSessionId] = useState<string | null>(null);
  const [resumedExamSession, setResumedExamSession] = useState<SessionView | null>(null);
  const [assessmentHistory, setAssessmentHistory] = useState<AssessmentHistory>(() => createMockAssessmentHistory());
  const [teacherQuestionList, setTeacherQuestionList] = useState(() => createMockOverview().questions);
  const [practiceSet, setPracticeSet] = useState<PracticeSet>(() => createMockPracticeSet());
  const [reviewResources, setReviewResources] = useState<ReviewResourceRecommendation>(() => createMockReviewResourceRecommendations());
  const [practiceSetResult, setPracticeSetResult] = useState<PracticeSetResult | null>(null);
  const [taskAdjustment, setTaskAdjustment] = useState<TaskCompletionAdjustment | null>(null);
  const [learningProfile, setLearningProfile] = useState<LearningProfile>(() => createMockLearningProfile());
  const [feedbackList, setFeedbackList] = useState<FeedbackList>(() => createMockFeedbackList());
  const [feedbackStatus, setFeedbackStatus] = useState('可以提交站内反馈，也可以打开问卷继续补充详细建议。');
  const [userStatus, setUserStatus] = useState('管理员可以跟踪试用名单状态，方便后续邀请填写问卷。');
  const [trialProgress, setTrialProgress] = useState<TrialProgress>(() => createMockTrialProgress());
  const [studyReminders, setStudyReminders] = useState<StudyReminders>(() => createMockStudyReminders());
  const [sprintPlan, setSprintPlan] = useState<SprintPlan>(() => createMockSprintPlan());
  const [masteryMap, setMasteryMap] = useState<MasteryMap>(() => createMockMasteryMap());
  const [wrongQuestionSummary, setWrongQuestionSummary] = useState<WrongQuestionSummary>(() => createMockWrongQuestionSummary());

  useEffect(() => {
    let active = true;

    Promise.all([fetchDashboardOverview(), fetchRecommendedPracticeSet(), fetchReviewResourceRecommendations(), fetchLearningProfile(sessionUser?.id ?? 'u-001'), fetchTrialProgress(), fetchStudyReminders(), fetchSprintPlan(), fetchMasteryMap(), fetchWrongQuestionSummary(), fetchAssessmentHistory()])
      .then(([data, recommendedSet, resources, profile, trial, reminders, sprint, mastery, wrongSummary, history]) => {
        if (!active) return;
        setOverview(data);
        setTeacherQuestionList(data.questions.filter((question) => question.knowledgePointIds.includes('co-cache')));
        setPracticeSet(recommendedSet);
        setReviewResources(resources);
        setLearningProfile(profile);
        setTrialProgress(trial);
        setStudyReminders(reminders);
        setSprintPlan(sprint);
        setMasteryMap(mastery);
        setWrongQuestionSummary(wrongSummary);
        setAssessmentHistory(history);
        setSessionUser((current) => current ?? data.student);
        setApiState('connected');
        setLastSyncAt(new Date().toISOString());
      })
      .catch(() => {
        if (!active) return;
        if (isMockAllowed()) {
          setOverview(createMockOverview());
          setPracticeSet(createMockPracticeSet());
          setReviewResources(createMockReviewResourceRecommendations());
          setLearningProfile(createMockLearningProfile());
          setTrialProgress(createMockTrialProgress());
          setStudyReminders(createMockStudyReminders());
          setSprintPlan(createMockSprintPlan());
          setMasteryMap(createMockMasteryMap());
          setWrongQuestionSummary(createMockWrongQuestionSummary());
          setAssessmentHistory(createMockAssessmentHistory());
          setApiState('mock');
        } else {
          setApiState('error');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const role = sessionUser?.role;

    if (role === 'teacher') {
      fetchTeacherClassAnalytics()
        .then((classAnalytics) => {
          if (!active) return;
          setTeacherClassAnalytics(classAnalytics);
        })
        .catch(() => {
          if (active) setTeacherStatus('教师数据加载失败，请重新登录后重试。');
        });
    }

    if (role === 'admin') {
      Promise.all([fetchAdminMetrics(), fetchAdminUsers(), fetchTeacherClassAnalytics(), fetchReviewQueue(), fetchSystemConfig(), fetchFeedbackList()])
        .then(([metrics, users, classAnalytics, queue, config, feedback]) => {
          if (!active) return;
          setAdminMetrics(metrics);
          setAdminUsers(users);
          setTeacherClassAnalytics(classAnalytics);
          setReviewQueue(queue);
          setSystemConfig(config);
          setFeedbackList(feedback);
        })
        .catch(() => {
          if (active) setReviewStatus('管理数据加载失败，请重新登录后重试。');
        });
    }

    return () => {
      active = false;
    };
  }, [sessionUser?.role]);

  // Phase 3: Check onboarding status on mount
  useEffect(() => {
    if (isStaticDemoMode()) { setOnboardingChecked(true); return; }
    fetchOnboardingStatus()
      .then((status) => {
        if (!status.completed) setShowOnboarding(true);
        setOnboardingChecked(true);
      })
      .catch(() => setOnboardingChecked(true));
  }, []);

  // Phase 3: Load today plan when onboarding is done
  useEffect(() => {
    if (!onboardingChecked || showOnboarding) return;
    if (isStaticDemoMode()) return;
    fetchTodayPlan()
      .then((plan) => setTodayPlan(plan))
      .catch(() => { /* show plan from dashboard overview */ });
  }, [onboardingChecked, showOnboarding]);

  async function handleOnboardingComplete(result: Awaited<ReturnType<typeof import('./api/endpoints/onboarding').completeOnboarding>>) {
    setShowOnboarding(false);
    if (result.todayPlan) {
      setTodayPlan(result.todayPlan as TodayPlanType);
    }
    // Reload dashboard to reflect new profile
    try {
      const data = await fetchDashboardOverview();
      setOverview(data);
      setApiState('connected');
      setLastSyncAt(new Date().toISOString());
    } catch { /* keep existing data */ }
  }

  async function refreshTodayPlan() {
    try {
      const plan = await fetchTodayPlan();
      setTodayPlan(plan);
    } catch { /* keep existing */ }
  }

  const { student, questions, report, plan, wrongQuestions, learningCalendar, stageAssessment } = overview;
  const examQuestions = latestPaper?.questions.length ? latestPaper.questions : questions;
  const examResourceId = latestPaper?.id ?? `mock-exam-${examQuestions.map((question) => question.id).join('-')}`;
  const activeExamQuestionIds = resumedExamSession?.questionIds ?? examQuestions.map((question) => question.id);
  const activeExamQuestions = questions.filter((question) => activeExamQuestionIds.includes(question.id));
  const currentQuestion = questions[0];

  async function refreshTrialProgress() {
    const nextTrialProgress = await fetchTrialProgress();
    setTrialProgress(nextTrialProgress);
  }

  async function refreshStudyReminders() {
    const nextStudyReminders = await fetchStudyReminders();
    setStudyReminders(nextStudyReminders);
  }

  async function refreshSprintPlan() {
    const nextSprintPlan = await fetchSprintPlan();
    setSprintPlan(nextSprintPlan);
  }

  async function refreshMasteryMap() {
    const nextMasteryMap = await fetchMasteryMap();
    setMasteryMap(nextMasteryMap);
  }

  async function refreshWrongQuestionSummary() {
    const nextWrongQuestionSummary = await fetchWrongQuestionSummary();
    setWrongQuestionSummary(nextWrongQuestionSummary);
  }

  async function refreshAssessmentHistory() {
    const nextAssessmentHistory = await fetchAssessmentHistory();
    setAssessmentHistory(nextAssessmentHistory);
  }

  function addMockPaperResultToHistory(result: PaperSubmitResult, paper: GeneratedPaper) {
    setAssessmentHistory((current) => {
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
    setApiState(result);
  }

  async function onLogout() {
    await handleLogout();
    setApiState('mock');
  }

  async function handleSubmitDiagnostic() {
    setDiagnosticStatus('正在生成入学诊断...');

    try {
      const profile = await submitDiagnosticProfile({
        targetScore: 118,
        currentScore: 58,
        remainingDays: 120,
        dailyHours: 2.5,
        weakestSubject: '操作系统',
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
    setPracticeStatus('正在提交答案...');

    try {
      const record = await submitPracticeAnswer({
        questionId: currentQuestion.id,
        knowledgePointId: currentQuestion.knowledgePointIds[0],
        selectedAnswer,
        timeSpentSec: 135,
      });
      const nextOverview = await fetchDashboardOverview();
      setOverview(nextOverview);
      setApiState('connected');
      await refreshStudyReminders();
      await refreshSprintPlan();
      await refreshMasteryMap();
      await refreshWrongQuestionSummary();
      if (record.correct && redoQuestionId === currentQuestion.id) {
        setRedoQuestionId(null);
        setPracticeStatus('回答正确，已从错题本移除。');
      } else {
        setPracticeStatus(record.correct ? '回答正确，已记录本次练习。' : `回答错误，错因：${record.mistakeReason ?? '待复盘'}。`);
      }
    } catch {
      setPracticeStatus('提交失败，当前显示本地演示数据。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleSubmitPracticeSet() {
    setPracticeStatus('正在提交推荐题组...');

    try {
      const result = await submitPracticeSet({
practiceSetId: practiceSet.id,
        answers: practiceSet.questions.slice(0, 3).map((question, index) => ({
          questionId: question.id,
          selectedAnswer: index === 0 ? question.answer : 'A',
          timeSpentSec: question.expectedTimeSec + 10,
        })),
      });
      const nextOverview = await fetchDashboardOverview();
      const nextPracticeSet = await fetchRecommendedPracticeSet();
      const nextProfile = await fetchLearningProfile(sessionUser?.id ?? student.id);
      setOverview(nextOverview);
      setPracticeSet(nextPracticeSet);
      setLearningProfile(nextProfile);
      setPracticeSetResult(result);
      setApiState('connected');
      await refreshTrialProgress();
      await refreshStudyReminders();
      await refreshSprintPlan();
      await refreshMasteryMap();
      await refreshWrongQuestionSummary();
      setPracticeStatus(`推荐题组已提交：正确率 ${result.accuracyRate}%，练习记录和错题本已更新。`);
    } catch {
      setPracticeStatus('推荐题组提交失败，请稍后重试。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleCompleteTask(taskId: string) {
    setTaskStatus('正在记录任务完成状态...');
    const currentTask = plan.dailyTasks.find((task) => task.id === taskId);
    const completedQuestionCount = currentTask?.questionCount ?? 12;

    if (isStaticDemoMode() && currentTask) {
      const mockAdjustment: TaskCompletionAdjustment = {
        accuracyRate: 58,
        completedQuestionCount,
        correctCount: Math.max(1, Math.round(completedQuestionCount * 0.58)),
        minutesSpent: currentTask.minutes + 12,
        selfRating: 2,
        intensity: 'decrease',
        tomorrowQuestionTarget: Math.max(6, completedQuestionCount - 2),
        reviewTarget: 4,
        focusKnowledgePointId: currentTask.knowledgePointId,
        focusTitle: currentTask.title,
        reasons: [
          `本任务正确率 58%，说明 ${currentTask.title} 仍需要先复盘再加题。`,
          '自评掌握度偏低，明日优先安排概念复述和错题重做。',
        ],
        nextActions: [
          `先复盘 ${currentTask.title} 的错题和概念，再做 4 道回炉题。`,
          '完成后用一句话写下本考点最容易混淆的条件。',
        ],
      };
      const nextTasks = plan.dailyTasks.map((task) => task.id === taskId ? { ...task, completed: true } : task);
      const completedTaskCount = nextTasks.filter((task) => task.completed).length;
      setOverview({
        ...overview,
        plan: {
          ...plan,
          dailyTasks: nextTasks,
          completedTaskCount,
          totalTaskCount: nextTasks.length,
          completionRate: nextTasks.length ? Math.round((completedTaskCount / nextTasks.length) * 100) : 0,
        },
      });
      setTaskAdjustment(mockAdjustment);
      setApiState('mock');
      setTaskStatus(`已使用静态演示数据完成 ${currentTask.title}，并生成明日调整建议。`);
      return;
    }

    try {
      const completedTask = await completeStudyTask({
taskId,
        completedQuestionCount,
        correctCount: Math.max(1, Math.round(completedQuestionCount * 0.58)),
        minutesSpent: (currentTask?.minutes ?? 45) + 12,
        selfRating: 2,
      });
      const nextOverview = await fetchDashboardOverview();
      const nextProfile = await fetchLearningProfile(sessionUser?.id ?? student.id);
      setOverview(nextOverview);
      setLearningProfile(nextProfile);
      setApiState('connected');
      await refreshTrialProgress();
      await refreshStudyReminders();
      await refreshSprintPlan();
      await refreshMasteryMap();
      await refreshWrongQuestionSummary();
      setTaskAdjustment(completedTask.adjustment);
      setTaskStatus(`今日已完成 ${nextOverview.plan.completedTaskCount ?? 0}/${nextOverview.plan.totalTaskCount ?? nextOverview.plan.dailyTasks.length} 项任务。`);
      setTaskStatus(`${completedTask.feedback.message} ${completedTask.feedback.nextAction}`);
    } catch {
      setTaskStatus('任务完成状态记录失败，请稍后重试。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleReviewWrongQuestion(questionId: string) {
    setWrongStatus('正在记录错题复盘...');

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

    try {
      const assessment = await fetchStageAssessment();
      setOverview((current) => ({
        ...current,
        stageAssessment: assessment,
      }));
      setStageResult(null);
      setApiState('connected');
      setAssessmentStatus(`已生成 ${assessment.questions.length} 题阶段测评，预计 ${assessment.estimatedMinutes} 分钟。`);
      document.getElementById('assessment')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      setAssessmentStatus('阶段测评生成失败，当前显示本地演示数据。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleSubmitAssessment() {
    setAssessmentStatus('正在提交阶段测评...');

    try {
      const result = await submitStageAssessment({
answers: stageAssessment.questions.map((question, index) => ({
          questionId: question.id,
          selectedAnswer: index === 0 ? question.answer : 'A',
          timeSpentSec: question.expectedTimeSec + 20,
        })),
      });
      const nextOverview = await fetchDashboardOverview();
      const nextProfile = await fetchLearningProfile(sessionUser?.id ?? student.id);
      setOverview(nextOverview);
      setStageResult(result);
      setLearningProfile(nextProfile);
      setApiState('connected');
      await refreshStudyReminders();
      await refreshSprintPlan();
      await refreshMasteryMap();
      setAssessmentStatus(`阶段测评完成：${result.score} 分，计划已调整为${result.adjustment.planPhase}。`);
      setAssessmentStatus(`阶段测评完成：${result.score} 分，需复盘 ${result.reviewItems.length} 处。`);
    } catch {
      setAssessmentStatus('阶段测评提交失败，请稍后重试。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleAskTutor() {
    setTutorStatus('AI 助教正在整理解析...');

    try {
      const reply = await requestTutorReply({
        questionId: currentQuestion.id,
        selectedAnswer: 'A',
        prompt: '请解释这道题的考点和易错点。',
      });
      setTutorReply(reply);
      setApiState('connected');
      setTutorStatus(`已生成 ${reply.knowledgePointTitle} 的答疑解析。`);
      document.getElementById('ai')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      setTutorStatus('AI 答疑暂时不可用，请先查看标准解析。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleAskFollowUp(message: string) {
    setTutorStatus('AI 正在整理追问解释和复习卡片...');

    try {
      const reply = await requestAiFollowUp({
        questionId: currentQuestion.id,
        message,
      });
      setAiFollowUp(reply);
      setApiState('connected');
      setTutorStatus(`已生成 ${reply.reviewCards.length} 张复习卡片：${reply.relatedKnowledgePoint.title}`);
      document.getElementById('ai')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      setTutorStatus('AI 追问暂时不可用，请先查看标准解析和错题复盘建议。');
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
      const nextOverview = await fetchDashboardOverview();
      const nextQuestions = await fetchQuestions({ knowledgePointId: 'co-cache' });
      setOverview(nextOverview);
      setTeacherQuestionList(nextQuestions);
      setApiState('connected');
      setTeacherStatus(`已新增 ${created.id}，当前题库共 ${nextOverview.questions.length} 题。`);
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
      setTeacherQuestionList(questions.filter((question) => question.knowledgePointIds.includes('co-cache')));
      setTeacherStatus('已使用静态演示数据筛选 Cache 相关题目。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
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
      const nextOverview = await fetchDashboardOverview();
      const nextQuestions = await fetchQuestions({ knowledgePointId: 'co-cache' });
      setOverview(nextOverview);
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
      const nextOverview = await fetchDashboardOverview();
      const nextQuestions = await fetchQuestions({ knowledgePointId: 'co-cache' });
      setOverview(nextOverview);
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
      const nextOverview = await fetchDashboardOverview();
      setOverview(nextOverview);
      setApiState('connected');
      setKnowledgeStatus(`已新增 ${point.title}，当前知识点共 ${nextOverview.knowledgePoints.length} 个。`);
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

  async function handleApproveReviewItem(reviewItemId: string) {
    setReviewStatus('正在提交审核结果...');

    try {
      await approveReviewItem({
        reviewItemId,
        reviewerId: 'admin-001',
      });
      const nextQueue = await fetchReviewQueue();
      const nextMetrics = await fetchAdminMetrics();
      setReviewQueue(nextQueue);
      setAdminMetrics(nextMetrics);
      setApiState('connected');
      setReviewStatus(`审核已通过，当前仍有 ${nextQueue.pendingCount} 项待处理。`);
    } catch {
      setReviewStatus('审核提交失败，请稍后重试。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleMarkReviewItemNeedsRecheck(reviewItemId: string) {
    setReviewStatus('正在标记复查...');

    try {
      await markReviewItemNeedsRecheck({
        reviewItemId,
        reviewerId: 'admin-001',
      });
      const nextQueue = await fetchReviewQueue();
      setReviewQueue(nextQueue);
      setApiState('connected');
      setReviewStatus(`已标记复查，当前仍有 ${nextQueue.pendingCount} 项待处理。`);
    } catch {
      setReviewStatus('复查标记失败，请稍后重试。');
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

  async function handleSubmitFeedback() {
    setFeedbackStatus('正在提交体验反馈...');

    try {
      const feedback = await submitFeedback({
rating: 4,
        scene: '原型试用',
        message: '推荐题组和学习档案对备考路径有帮助，希望继续完善移动端体验。',
        surveyUrl: 'https://wj.qq.com/s2/27160624/40fe/',
      });
      await refreshTrialProgress();
      await refreshStudyReminders();
      await refreshSprintPlan();
      setApiState('connected');
      setFeedbackStatus(`已提交反馈 ${feedback.id}，也可以继续填写详细问卷。`);
    } catch {
      setFeedbackStatus('反馈提交失败，请稍后重试或直接填写问卷。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  async function handleMarkTrialFollowUp() {
    const studentUser = adminUsers.users.find((user) => user.role === 'student');
    if (!studentUser) {
      setUserStatus('暂无可标记的学生账号。');
      return;
    }

    setUserStatus('正在更新试用名单状态...');

    if (isStaticDemoMode()) {
      const nextUsers = adminUsers.users.map((user) => user.id === studentUser.id
        ? { ...user, trialStatus: 'follow_up' as const, nextAction: '联系学生填写问卷，并追问最影响备考效率的功能缺口。' }
        : user);
      setAdminUsers({
        ...adminUsers,
        generatedAt: new Date().toISOString(),
        summary: {
          totalUsers: nextUsers.length,
          studentCount: nextUsers.filter((user) => user.role === 'student').length,
          activeTrialCount: nextUsers.filter((user) => user.trialStatus === 'active').length,
          followUpCount: nextUsers.filter((user) => user.trialStatus === 'follow_up').length,
        },
        users: nextUsers,
      });
      setUserStatus(`已将 ${studentUser.name} 标记为待回访，可邀请填写问卷。`);
      return;
    }

    try {
      const updated = await updateAdminUserTrialStatus({
        userId: studentUser.id,
        trialStatus: 'follow_up',
      });
      const nextAdminUsers = await fetchAdminUsers();
      setAdminUsers(nextAdminUsers);
      setApiState('connected');
      setUserStatus(`已将 ${updated.name} 标记为待回访，可邀请填写问卷。`);
    } catch {
      setUserStatus('试用状态更新失败，当前保留原名单。');
      setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }

  return (
    <DashboardProvider sessionUserId={sessionUser?.id}>
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">408 Score Boost</p>
          <h1>计算机考研 408 提分系统</h1>
        </div>
        <RoleNavigation role={sessionUser?.role} />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{roleLabel[sessionUser?.role ?? 'student']}工作区</p>
            <h2>
              {sessionUser?.role === 'student' || !sessionUser
                ? `${student.name}，当前处于${student.stage}阶段`
                : `${sessionUser.name}，欢迎回来`}
            </h2>
          </div>
          <div className="topbar-actions">
            <span className="role-pill">{roleLabel[sessionUser?.role ?? 'student']}</span>
            <ApiStateIndicator
              state={apiState}
              lastSyncAt={lastSyncAt}
              source={overview.source}
              onRetry={() => window.location.reload()}
            />
            {sessionUser?.role === 'student' || !sessionUser ? (
              <button type="button" onClick={handleGenerateAssessment}>生成阶段测评</button>
            ) : null}
          </div>
        </header>

        <StudentLayout role={sessionUser?.role}>
        <>
        {/* Phase 3: Onboarding wizard for new users */}
        {showOnboarding ? (
          <OnboardingWizard onComplete={handleOnboardingComplete} />
        ) : null}

        {/* Phase 3: Today's Learning Plan */}
        {!showOnboarding && todayPlan ? (
          <TodayPlan
            plan={todayPlan}
            onRefresh={refreshTodayPlan}
            onOpenReview={(questionId) => {
              setDetailQuestionId(questionId);
              window.setTimeout(() => document.getElementById('wrong-question-detail')?.scrollIntoView({ behavior: 'smooth' }), 0);
            }}
          />
        ) : null}

        {!showOnboarding ? (
          <ResumeSessionBanner
            allowedTypes={['paper']}
            onResume={(session) => {
              setResumedExamSession(session);
              setExamReportSessionId(null);
              setExamOpen(true);
            }}
          />
        ) : null}

        {!showOnboarding ? (
          <section className="panel exam-entry-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">408 模拟考试</p>
                <h3>{latestPaper?.title ?? '当前题库模拟卷'}</h3>
              </div>
              <span>{examQuestions.length} 题 · 180 分钟</span>
            </div>
            <p>支持答题卡、题目标记、自动保存、断点恢复和未答题检查。</p>
            <button
              type="button"
              className="primary-action"
              disabled={examQuestions.length === 0}
              onClick={() => {
                setResumedExamSession(null);
                setExamReportSessionId(null);
                setExamOpen(true);
              }}
            >
              <ClipboardCheck size={18} /> 开始模拟考试
            </button>
          </section>
        ) : null}
        </>
        </StudentLayout>

        <section className="panel role-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">账号与角色权限</p>
              <h3>{sessionUser?.name ?? student.name}</h3>
            </div>
            {authSession?.refreshToken ? (
              <button type="button" className="secondary-action" onClick={onLogout}>退出登录</button>
            ) : null}
          </div>
          <p className="task-status">{authStatus} {permissionHint[sessionUser?.role ?? 'student']}</p>
          {!authSession?.refreshToken && !isStaticDemoMode() ? (
            <form className="account-form" onSubmit={handleAccountSubmit}>
              {authMode === 'register' ? (
                <label>
                  <span>姓名</span>
                  <input name="name" autoComplete="name" required maxLength={40} />
                </label>
              ) : null}
              <label>
                <span>邮箱</span>
                <input name="email" type="email" autoComplete="email" required />
              </label>
              <label>
                <span>密码</span>
                <input
                  name="password"
                  type="password"
                  autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                  required
                  minLength={8}
                  maxLength={128}
                />
              </label>
              <div className="account-actions">
                <button type="submit">{authMode === 'register' ? '创建学生账号' : '登录'}</button>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => setAuthMode((current) => current === 'login' ? 'register' : 'login')}
                >
                  {authMode === 'register' ? '已有账号' : '注册账号'}
                </button>
              </div>
            </form>
          ) : null}
          {isStaticDemoMode() || import.meta.env.DEV ? (
            <div className="demo-role-actions">
              <span>演示身份</span>
              <div className="panel-actions">
                <button type="button" className="secondary-action" onClick={() => onRoleSwitch('student')}>学生</button>
                <button type="button" className="secondary-action" onClick={() => onRoleSwitch('teacher')}>教师</button>
                <button type="button" className="secondary-action" onClick={() => onRoleSwitch('admin')}>管理员</button>
              </div>
            </div>
          ) : null}
        </section>

        <StudentLayout role={sessionUser?.role}>
        <>
        <section id="trial" className="panel trial-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">试用引导</p>
              <h3>{trialProgress.title}</h3>
            </div>
            <span>{trialProgress.completedCount}/{trialProgress.totalCount} 已完成 · {trialProgress.completionRate}%</span>
          </div>
          <p className="task-status">下一步：{trialProgress.nextAction}</p>
          <div className="trial-list">
            {trialProgress.items.map((item) => (
              <article key={item.id} className={item.completed ? 'completed' : ''}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </div>
                <a href={item.actionAnchor}>{item.completed ? '已完成' : '去体验'}</a>
              </article>
            ))}
          </div>
        </section>

        <section className="panel reminder-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">今日提分提醒</p>
              <h3>{studyReminders.title}</h3>
            </div>
            <span>更新于 {new Date(studyReminders.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="reminder-list">
            {studyReminders.items.map((item) => (
              <article key={item.id} className={`reminder-row priority-${item.priority}`}>
                <div>
                  <span>{priorityLabel[item.priority]}</span>
                  <strong>{item.title}</strong>
                  <p>{item.reason}</p>
                </div>
                <a href={item.actionAnchor}>{item.actionText}</a>
              </article>
            ))}
          </div>
        </section>

        <section className="panel sprint-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">7 天冲刺计划</p>
              <h3>{sprintPlan.title}</h3>
            </div>
            <span>差 {sprintPlan.scoreGap} 分 · 剩余 {sprintPlan.remainingDays ?? 0} 天</span>
          </div>
          <div className="sprint-summary">
            <article>
              <strong>{sprintPlan.weeklyQuestionTarget}</strong>
              <span>本周目标题量</span>
            </article>
            <article>
              <strong>{sprintPlan.weeklyReviewTarget}</strong>
              <span>本周复盘目标</span>
            </article>
            <article>
              <strong>{sprintPlan.currentStage ?? '待诊断'}</strong>
              <span>当前阶段</span>
            </article>
          </div>
          <div className="risk-list">
            {sprintPlan.risks.map((risk) => (
              <span key={risk}>{risk}</span>
            ))}
          </div>
          <div className="sprint-days">
            {sprintPlan.days.map((day) => (
              <article key={day.date}>
                <div>
                  <strong>第 {day.dayIndex} 天 · {day.focus}</strong>
                  <span>{day.date} · {day.minutes} 分钟</span>
                </div>
                <p>{day.reason}</p>
                <footer>
                  <span>{day.questionTarget} 题</span>
                  <span>{day.reviewTarget} 道复盘</span>
                </footer>
              </article>
            ))}
          </div>
        </section>

        <section className="panel mastery-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">408 掌握度地图</p>
              <h3>{masteryMap.title}</h3>
            </div>
            <span>薄弱点 {masteryMap.weakestPoints.length} 个</span>
          </div>
          <div className="mastery-subjects">
            {masteryMap.subjects.map((subject) => (
              <article key={subject.subject} className="mastery-subject">
                <header>
                  <div>
                    <strong>{subject.subject}</strong>
                    <span>平均掌握度 {subject.averageMastery}%</span>
                  </div>
                  <small>{subject.weakCount} 薄弱 · {subject.reviewCount} 巩固 · {subject.masteredCount} 掌握</small>
                </header>
                <div className="mastery-points">
                  {subject.points.length ? subject.points.map((point) => (
                    <div key={point.knowledgePointId} className={`mastery-point status-${point.status}`}>
                      <div>
                        <strong>{point.title}</strong>
                        <span>{point.chapter} · 掌握 {point.masteryRate}% · 正确率 {point.accuracyRate}%</span>
                      </div>
                      <p>{point.practiceCount} 次练习 · {point.wrongCount} 次错误 · {point.nextAction}</p>
                      <a href={point.actionAnchor}>{masteryStatusLabel[point.status]}</a>
                    </div>
                  )) : (
                    <div className="mastery-empty">
                      <strong>暂无知识点数据</strong>
                      <span>后续补充题库和知识树后会自动进入掌握度统计。</span>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="dashboard" className="metrics-grid">
          <Metric title="目标分" value={`${student.targetScore ?? 0}`} caption={student.targetSchool ?? '目标院校未设置'} />
          <Metric title="正确率" value={`${report.accuracyRate}%`} caption="近 20 次练习统计" />
          <Metric title="预计提分空间" value={`${report.estimatedGain} 分`} caption="基于薄弱点和目标分估算" />
          <Metric title="剩余天数" value={`${student.remainingDays ?? 0} 天`} caption={`每日 ${student.dailyHours ?? 0} 小时`} />
        </section>

        <section className="panel profile-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">学习档案</p>
              <h3>{learningProfile.summary.name} 的提分闭环轨迹</h3>
            </div>
            <span>{learningProfile.summary.currentStage} · 连续 {learningProfile.summary.streakDays} 天</span>
          </div>
          <div className="profile-grid">
            <article>
              <strong>{learningProfile.loopStats.practiceSetCount}</strong>
              <span>题组练习</span>
            </article>
            <article>
              <strong>{learningProfile.loopStats.stageAssessmentCount}</strong>
              <span>阶段测评</span>
            </article>
            <article>
              <strong>{learningProfile.loopStats.reviewedWrongQuestionCount}</strong>
              <span>错题复盘</span>
            </article>
            <article>
              <strong>{learningProfile.summary.accuracyRate}%</strong>
              <span>综合正确率</span>
            </article>
          </div>
          <p className="task-status">{learningProfile.nextMilestone}</p>
          <div className="timeline-list">
            {learningProfile.timeline.slice(0, 5).map((item) => (
              <article key={item.id}>
                <time>{item.date}</time>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.summary}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="feedback" className="panel feedback-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">体验反馈</p>
              <h3>邀请备考同学试用后收集改进建议</h3>
            </div>
            <div className="panel-actions">
              <button type="button" className="secondary-action" onClick={handleSubmitFeedback}>提交演示反馈</button>
              <a className="secondary-link" href={feedbackList.surveyUrl} target="_blank" rel="noreferrer">打开问卷</a>
            </div>
          </div>
          <p className="task-status">{feedbackStatus}</p>
          <div className="feedback-grid">
            <article>
              <strong>{feedbackList.totalCount}</strong>
              <span>反馈数量</span>
            </article>
            <article>
              <strong>{feedbackList.averageRating}</strong>
              <span>平均评分</span>
            </article>
            <article>
              <strong>{feedbackList.items[0]?.scene ?? '待收集'}</strong>
              <span>最近场景</span>
            </article>
          </div>
          {feedbackList.items[0] ? <p className="feedback-note">{feedbackList.items[0].message}</p> : null}
        </section>

        <section className="panel diagnostic-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">入学诊断</p>
              <h3>根据目标和基础生成阶段计划</h3>
            </div>
            <button type="button" className="secondary-action" onClick={handleSubmitDiagnostic}>
              <Target size={18} /> 提交演示诊断
            </button>
          </div>
          <p className="task-status">{diagnosticStatus}</p>
          <div className="diagnostic-grid">
            <article>
              <strong>{student.currentScore ?? 0}</strong>
              <span>当前估分</span>
            </article>
            <article>
              <strong>{student.targetScore ?? 0}</strong>
              <span>目标分</span>
            </article>
            <article>
              <strong>{student.weakestSubject ?? '待诊断'}</strong>
              <span>最弱科目</span>
            </article>
            <article>
              <strong>{plan.phase}</strong>
              <span>当前计划阶段</span>
            </article>
          </div>
        </section>
        </>
        </StudentLayout>

        <AdminLayout role={sessionUser?.role}>
          <AdminWorkspace
            metrics={adminMetrics}
            users={adminUsers}
            feedback={feedbackList}
            reviewQueue={reviewQueue}
            systemConfig={systemConfig}
            userStatus={userStatus}
            reviewStatus={reviewStatus}
            configStatus={configStatus}
            onMarkTrialFollowUp={handleMarkTrialFollowUp}
            onApproveReviewItem={handleApproveReviewItem}
            onMarkReviewItemNeedsRecheck={handleMarkReviewItemNeedsRecheck}
            onApplySprintConfig={handleApplySprintConfig}
          />
        </AdminLayout>

        <StudentLayout role={sessionUser?.role}>
        <>
        <section id="wrong-book" className="panel">
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

        <section id="assessment" className="panel assessment-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">阶段测评</p>
              <h3>{stageAssessment.title}</h3>
            </div>
            <span>{stageAssessment.questions.length} 题 · 预计 {stageAssessment.estimatedMinutes} 分钟</span>
          </div>
          <p className="task-status">{assessmentStatus}</p>
          <div className="assessment-grid">
            <article>
              <strong>聚焦知识点</strong>
              <div className="tag-list">
                {stageAssessment.focusKnowledgePoints.map((point) => (
                  <span key={point.id}>{point.title}</span>
                ))}
              </div>
            </article>
            <article>
              <strong>测评说明</strong>
              <p>{stageAssessment.description}</p>
            </article>
            <article>
              <strong>提交后产出</strong>
              <p>系统会同步练习记录、错题本和薄弱点报告，并给出下一步复习建议。</p>
            </article>
          </div>
          <div className="assessment-actions">
            <button type="button" onClick={handleSubmitAssessment}>
              <ClipboardCheck size={18} /> 提交演示测评
            </button>
          </div>
          {stageResult ? (
            <div className="assessment-result">
              <strong>本次得分 {stageResult.score} / 100</strong>
              <p>{stageResult.adjustment.message}</p>
              <p>下一阶段：{stageResult.adjustment.stage} / {stageResult.adjustment.planPhase}</p>
              <p>答对 {stageResult.correctCount}/{stageResult.totalQuestions} 题，复盘项 {stageResult.reviewItems.length} 个。</p>
              <ul>
                {stageResult.nextActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section id="plan" className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{plan.phase}</p>
              <h3>今日推荐任务</h3>
            </div>
            <span>{plan.completedTaskCount ?? 0}/{plan.totalTaskCount ?? plan.dailyTasks.length} 已完成 · {plan.completionRate ?? 0}%</span>
          </div>
          <p className="task-status">{taskStatus} {assessmentStatus}</p>
          {taskAdjustment ? (
            <div className={`task-adjustment intensity-${taskAdjustment.intensity}`}>
              <div>
                <strong>{taskAdjustment.focusTitle}</strong>
                <span>完成正确率 {taskAdjustment.accuracyRate}% · 明日 {taskAdjustment.tomorrowQuestionTarget} 题 · 复盘 {taskAdjustment.reviewTarget} 题</span>
              </div>
              <ul>
                {taskAdjustment.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p>{taskAdjustment.nextActions.join(' ')}</p>
            </div>
          ) : null}
          <div className="task-list">
            {plan.dailyTasks.map((task) => (
              <article key={task.id} className={`task-row ${task.completed ? 'completed' : ''}`}>
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.subject} / {task.chapter} / {task.mode}</p>
                  <div className="task-reason">
                    <span className={`priority priority-${task.priority}`}>{task.priority}优先级</span>
                    <span>{task.reason}</span>
                  </div>
                  <small>{task.nextAction}</small>
                </div>
                <div className="task-actions">
                  <span>{task.minutes} 分钟 · {task.questionCount} 题</span>
                  <button type="button" disabled={task.completed} onClick={() => handleCompleteTask(task.id)}>
                    {task.completed ? '已完成' : '完成'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="two-column">
          <article id="question" className="panel">
            <p className="eyebrow">题库训练</p>
            <h3>{currentQuestion.stem}</h3>
            <div className="options">
              {currentQuestion.options.map((option, index) => (
                <button key={option} type="button" onClick={() => handleSubmitAnswer(String.fromCharCode(65 + index))}>
                  {String.fromCharCode(65 + index)}. {option}
                </button>
              ))}
            </div>
            {redoQuestionId === currentQuestion.id ? <p className="redo-badge">错题重做模式</p> : null}
            <p className="practice-status">{practiceStatus}</p>
            <div className="practice-set">
              <strong>{practiceSet.title}</strong>
              <p>{practiceSet.focus} · 预计 {practiceSet.estimatedMinutes} 分钟</p>
              <span>{practiceSet.reason}</span>
              <ol>
                {practiceSet.questions.slice(0, 3).map((question) => (
                  <li key={question.id}>{question.stem}</li>
                ))}
              </ol>
              <button type="button" className="secondary-action" onClick={handleSubmitPracticeSet}>
                提交演示题组
              </button>
              {practiceSetResult ? (
                <p>最近一组：答对 {practiceSetResult.correctCount}/{practiceSetResult.totalQuestions}，正确率 {practiceSetResult.accuracyRate}%</p>
              ) : null}
            </div>
            <p className="muted">答案解析会由标准解析优先提供，AI 只负责补充讲解和相似题推荐。</p>
          </article>

          <article id="report" className="panel">
            <p className="eyebrow">提分报告</p>
            <h3>{report.summary}</h3>
            <div className="weak-list">
              {report.weakPoints.map((point) => (
                <div key={point.knowledgePointId}>
                  <strong>{point.title}</strong>
                  <span>{point.topReason ?? '待诊断'} · {point.suggestion}</span>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section id="review-resources" className="panel review-resources-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">复习资源推荐</p>
              <h3>把薄弱点变成下一步复习动作</h3>
            </div>
            <span>{reviewResources.weakPointCount} 个薄弱点</span>
          </div>
          <p className="task-status">
            更新时间 {new Date(reviewResources.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}，
            优先处理当前报告和错题本里最容易提分的知识点。
          </p>
          <div className="review-resource-grid">
            {reviewResources.items.map((item) => (
              <article key={item.id} className={`review-resource-card resource-${item.resourceType}`}>
                <div>
                  <span>{reviewResourceTypeLabel[item.resourceType]}</span>
                  <small>{item.subject} / {item.difficulty} / {item.estimatedMinutes} 分钟</small>
                </div>
                <strong>{item.title}</strong>
                <p>{item.summary}</p>
                <a href={item.actionAnchor}>{item.actionText}</a>
              </article>
            ))}
          </div>
        </section>

        <section id="assessment-history" className="panel assessment-history-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">测评历史</p>
              <h3>最近测评与复盘建议</h3>
            </div>
            <span>{assessmentHistory.summary.improvementText}</span>
          </div>
          <div className="assessment-history-summary">
            <article>
              <strong>{assessmentHistory.summary.attemptCount}</strong>
              <span>最近测评</span>
            </article>
            <article>
              <strong>{assessmentHistory.summary.bestScore}</strong>
              <span>最高得分</span>
            </article>
            <article>
              <strong>{assessmentHistory.summary.latestAccuracyRate}%</strong>
              <span>最近正确率</span>
            </article>
            <article>
              <strong>{assessmentHistory.items[0]?.unansweredCount ?? 0}</strong>
              <span>最近未答</span>
            </article>
          </div>
          {assessmentHistory.items.length ? (
            <div className="assessment-history-list">
              {assessmentHistory.items.slice(0, 4).map((item, index) => (
                <article key={item.id} className={index === 0 ? 'latest' : ''}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{new Date(item.submittedAt).toLocaleDateString('zh-CN')} · 用时 {Math.round(item.elapsedSec / 60)} 分钟 · 未答 {item.unansweredCount} 题</span>
                  </div>
                  <div className="assessment-score">
                    <strong>{item.score}/{item.totalScore}</strong>
                    <span>正确率 {item.accuracyRate}%</span>
                  </div>
                  <p>薄弱点：{item.weakPointTitle}</p>
                  <small>{item.reviewSuggestion}</small>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">完成一套模拟卷后，这里会沉淀得分、耗时、薄弱点和下一步复盘建议。</p>
          )}
        </section>

        <section id="ai" className="panel tutor-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">AI 答疑</p>
              <h3>基于标准解析的助教讲解</h3>
            </div>
            <button type="button" className="secondary-action" onClick={handleAskTutor}>
              <Brain size={18} /> 讲解当前题
            </button>
          </div>
          <p className="task-status">{tutorStatus}</p>
          <p className="ai-safety-note">AI 解释仅作辅助，最终以标准答案、标准解析和教师审核内容为准。</p>
          <div className="follow-up-actions">
            <button type="button" onClick={() => handleAskFollowUp('为什么我选 A 不对？')}>
              为什么选 A 不对
            </button>
            <button type="button" onClick={() => handleAskFollowUp('这个考点和相邻考点有什么区别？')}>
              对比易混考点
            </button>
            <button type="button" onClick={() => handleAskFollowUp('帮我整理成复习卡片。')}>
              生成复习卡片
            </button>
          </div>
          {tutorReply ? (
            <div className="tutor-result">
              <article>
                <strong>{tutorReply.knowledgePointTitle}</strong>
                <p>{tutorReply.answerCheck}</p>
              </article>
              <article>
                <strong>思路拆解</strong>
                <ol>
                  {tutorReply.explanationSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </article>
              <article>
                <strong>相似题推荐</strong>
                <div className="similar-list">
                  {tutorReply.similarQuestions.map((question) => (
                    <span key={question.id}>{question.source} · {question.difficulty} · {question.stem}</span>
                  ))}
                </div>
              </article>
              <article>
                <strong>下一步</strong>
                <ul>
                  {tutorReply.nextActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </article>
            </div>
          ) : null}
          <div className="follow-up-result">
            <article>
              <strong>{aiFollowUp.relatedKnowledgePoint.title}</strong>
              <p>{aiFollowUp.message}</p>
              <ol>
                {aiFollowUp.replySteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>
            <article>
              <strong>易错点提醒</strong>
              <ul>
                {aiFollowUp.misconceptionTips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </article>
            <div className="review-card-list">
              {aiFollowUp.reviewCards.map((card) => (
                <article key={card.id} className={`review-card card-${card.type}`}>
                  <span>{reviewCardTypeLabel[card.type]}</span>
                  <strong>{card.title}</strong>
                  <p>{card.content}</p>
                  <small>{card.nextAction}</small>
                </article>
              ))}
            </div>
          </div>
        </section>
        </>
        </StudentLayout>

        <TeacherLayout role={sessionUser?.role}>
          <TeacherWorkspace
            questionCount={questions.length}
            knowledgePointCount={overview.knowledgePoints.length}
            questionList={teacherQuestionList}
            classAnalytics={teacherClassAnalytics}
            latestPaper={latestPaper}
            paperSession={paperSession}
            paperResult={paperResult}
            knowledgeStatus={knowledgeStatus}
            teacherStatus={teacherStatus}
            paperStatus={paperStatus}
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
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">错题本</p>
              <h3>自动收集需要回炉的题目</h3>
            </div>
            <span>{wrongQuestions.length} 道待复盘</span>
          </div>
          <p className="task-status">{wrongStatus}</p>
          <div className="wrong-summary-grid">
            <article>
              <strong>{wrongQuestionSummary.pendingCount}</strong>
              <span>待复盘</span>
            </article>
            <article>
              <strong>{wrongQuestionSummary.reviewedCount}</strong>
              <span>已复盘</span>
            </article>
            <article>
              <strong>{wrongQuestionSummary.resolvedCount}</strong>
              <span>重做解决</span>
            </article>
            <article>
              <strong>{wrongQuestionSummary.totalWrongCount}</strong>
              <span>当前错题</span>
            </article>
          </div>
          <div className="wrong-loop-panel">
            <article>
              <strong>高频错因</strong>
              <div className="mistake-stat-list">
                {wrongQuestionSummary.mistakeReasonStats.map((item) => (
                  <span key={item.reason}>{item.reason} · {item.count}</span>
                ))}
              </div>
            </article>
            <article>
              <strong>优先重做</strong>
              {wrongQuestionSummary.priorityRedoItems[0] ? (
                <p>{wrongQuestionSummary.priorityRedoItems[0].knowledgePointTitle} · 错 {wrongQuestionSummary.priorityRedoItems[0].wrongCount} 次 · {wrongQuestionSummary.priorityRedoItems[0].nextAction}</p>
              ) : (
                <p>当前没有待重做错题，可以进入限时训练。</p>
              )}
            </article>
            <article>
              <strong>闭环建议</strong>
              <ul>
                {wrongQuestionSummary.nextReviewActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </article>
          </div>
          <div className="wrong-list">
            {wrongQuestions.map((item) => (
              <article key={item.questionId} className="wrong-row">
                <div>
                  <strong>{item.knowledgePointTitle}</strong>
                  <p>{item.subject} / {item.chapter} / 错 {item.wrongCount} 次 / {item.latestMistakeReason ?? '待诊断'}</p>
                  <small>{item.reviewStatus === 'reviewed' ? '已复盘' : '待复盘'}{item.reviewedAt ? ` · ${item.reviewedAt.slice(0, 10)}` : ''}</small>
                  <span>{item.stem}</span>
                </div>
                <button type="button" onClick={() => setDetailQuestionId(item.questionId)}>
                  详情与笔记
                </button>
                <button
                  type="button"
                  disabled={item.reviewStatus === 'reviewed'}
                  onClick={() => handleReviewWrongQuestion(item.questionId)}
                >
                  {item.reviewStatus === 'reviewed' ? '已复盘' : '标记复盘'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRedoQuestionId(item.questionId);
                    setPracticeStatus(`正在重做：${item.knowledgePointTitle}。请选择答案。`);
                    document.getElementById('question')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  重做
                </button>
              </article>
            ))}
          </div>
          {detailQuestionId ? (
            <WrongQuestionDetailView
              questionId={detailQuestionId}
              onClose={() => setDetailQuestionId(null)}
              onRedo={(questionId) => {
                setRedoQuestionId(questionId);
                setDetailQuestionId(null);
                document.getElementById('question')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          ) : null}
        </section>
        </StudentLayout>
      </section>
      {examOpen ? (
        <div className="exam-workspace-overlay">
          <ExamSession
            questionIds={activeExamQuestionIds}
            questions={resumedExamSession ? activeExamQuestions : examQuestions}
            resourceId={resumedExamSession?.resourceId ?? examResourceId}
            timeLimitMin={180}
            onExit={() => setExamOpen(false)}
            onSubmit={(result) => {
              setExamOpen(false);
              setExamReportSessionId(result.sessionId);
            }}
          />
        </div>
      ) : null}
      {examReportSessionId ? (
        <div className="exam-workspace-overlay">
          <ExamReportView sessionId={examReportSessionId} onClose={() => setExamReportSessionId(null)} />
        </div>
      ) : null}
    </main>
    </DashboardProvider>
  );
}

function Metric({ title, value, caption }: { title: string; value: string; caption: string }) {
  return (
    <article className="metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{caption}</p>
    </article>
  );
}
