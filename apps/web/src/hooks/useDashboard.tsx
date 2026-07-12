import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  fetchDashboardOverview, fetchAdminMetrics, fetchAdminUsers,
  fetchTeacherClassAnalytics, fetchReviewQueue, fetchSystemConfig,
  fetchLearningProfile, fetchRecommendedPracticeSet, fetchReviewResourceRecommendations,
  fetchTrialProgress, fetchStudyReminders, fetchSprintPlan, fetchMasteryMap,
  fetchWrongQuestionSummary, fetchAssessmentHistory,
  submitPracticeAnswer, submitPracticeSet, submitStageAssessment,
  submitDiagnosticProfile, completeStudyTask, reviewWrongQuestion,
  fetchFeedbackList, submitFeedback, approveReviewItem, markReviewItemNeedsRecheck,
  updateSystemConfig, requestTutorReply, requestAiFollowUp,
  fetchStageAssessment, fetchQuestions, generatePaper, submitPaper,
  createTeacherQuestion, updateTeacherQuestion, deleteTeacherQuestion,
  createKnowledgePoint, updateAdminUserTrialStatus,
  createMockOverview, createMockAdminMetrics, createMockAdminUserManagement,
  createMockTeacherClassAnalytics, createMockReviewQueue, createMockSystemConfig,
  createMockLearningProfile, createMockPracticeSet, createMockReviewResourceRecommendations,
  createMockTrialProgress, createMockStudyReminders, createMockSprintPlan,
  createMockMasteryMap, createMockWrongQuestionSummary, createMockAssessmentHistory,
  createMockAiFollowUp, createMockFeedbackList, createMockGeneratedPaper,
  createMockPaperSubmitResult,
  type DashboardOverview, type AdminMetrics, type AdminUserManagement,
  type TeacherClassAnalytics, type ReviewQueue, type SystemConfig,
  type LearningProfile, type PracticeSet, type ReviewResourceRecommendation,
  type TrialProgress, type StudyReminders, type SprintPlan, type MasteryMap,
  type WrongQuestionSummary, type AssessmentHistory, type AiFollowUp,
  type FeedbackList, type GeneratedPaper, type PaperSubmitResult,
  type StageAssessmentResult, type TutorReply, type TaskCompletionAdjustment,
} from '../api';
import { isMockAllowed, isStaticDemoMode } from '../api/env';
import { fetchTodayPlan, type TodayPlan as TodayPlanType } from '../api/endpoints/onboarding';
import type { ApiState } from '../components/ApiStateIndicator';

interface DashboardCtx {
  // Data
  overview: DashboardOverview;
  adminMetrics: AdminMetrics;
  adminUsers: AdminUserManagement;
  teacherClassAnalytics: TeacherClassAnalytics;
  reviewQueue: ReviewQueue;
  systemConfig: SystemConfig;
  learningProfile: LearningProfile;
  practiceSet: PracticeSet;
  reviewResources: ReviewResourceRecommendation;
  trialProgress: TrialProgress;
  studyReminders: StudyReminders;
  sprintPlan: SprintPlan;
  masteryMap: MasteryMap;
  wrongQuestionSummary: WrongQuestionSummary;
  assessmentHistory: AssessmentHistory;
  feedbackList: FeedbackList;
  todayPlan: TodayPlanType | null;
  showOnboarding: boolean;
  onboardingChecked: boolean;
  // UI state
  apiState: ApiState;
  lastSyncAt?: string;
  diagnosticStatus: string;
  assessmentStatus: string;
  practiceStatus: string;
  taskStatus: string;
  wrongStatus: string;
  tutorStatus: string;
  teacherStatus: string;
  reviewStatus: string;
  configStatus: string;
  knowledgeStatus: string;
  paperStatus: string;
  feedbackStatus: string;
  userStatus: string;
  stageResult: StageAssessmentResult | null;
  tutorReply: TutorReply | null;
  aiFollowUp: AiFollowUp;
  redoQuestionId: string | null;
  taskAdjustment: TaskCompletionAdjustment | null;
  practiceSetResult: unknown;
  teacherQuestionList: ReturnType<typeof createMockOverview>['questions'];
  latestPaper: GeneratedPaper | null;
  paperResult: PaperSubmitResult | null;
  paperSession: PaperSubmitResult['examSession'] | null;
  // Actions
  setShowOnboarding: (v: boolean) => void;
  setRedoQuestionId: (v: string | null) => void;
  setPracticeStatus: (v: string) => void;
  handleSubmitDiagnostic: () => Promise<void>;
  handleSubmitAnswer: (selectedAnswer: string) => Promise<void>;
  handleSubmitPracticeSet: () => Promise<void>;
  handleCompleteTask: (taskId: string) => Promise<void>;
  handleReviewWrongQuestion: (questionId: string) => Promise<void>;
  handleGenerateAssessment: () => Promise<void>;
  handleSubmitAssessment: () => Promise<void>;
  handleAskTutor: () => Promise<void>;
  handleAskFollowUp: (message: string) => Promise<void>;
  handleCreateTeacherQuestion: () => Promise<void>;
  handleUpdateTeacherQuestion: () => Promise<void>;
  handleDeleteTeacherQuestion: () => Promise<void>;
  handleCreateKnowledgePoint: () => Promise<void>;
  handleGeneratePaper: () => Promise<void>;
  handleStartPaperSession: () => void;
  handleSubmitPaper: () => Promise<void>;
  handleApproveReviewItem: (id: string) => Promise<void>;
  handleMarkReviewItemNeedsRecheck: (id: string) => Promise<void>;
  handleApplySprintConfig: () => Promise<void>;
  handleSubmitFeedback: () => Promise<void>;
  handleMarkTrialFollowUp: () => Promise<void>;
  handleFilterTeacherQuestions: () => Promise<void>;
  refreshTodayPlan: () => Promise<void>;
  handleOnboardingComplete: (result: Awaited<ReturnType<typeof import('../api/endpoints/onboarding').completeOnboarding>>) => Promise<void>;
  addMockPaperResultToHistory: (result: PaperSubmitResult, paper: GeneratedPaper) => void;
}

const Ctx = createContext<DashboardCtx | null>(null);

export function useDashboard() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}

export function DashboardProvider({ children, sessionUserId }: { children: ReactNode; sessionUserId?: string }) {
  // ---- All state (extracted from App.tsx) ----
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
  const [assessmentHistory, setAssessmentHistory] = useState<AssessmentHistory>(() => createMockAssessmentHistory());
  const [teacherQuestionList, setTeacherQuestionList] = useState(() => createMockOverview().questions);
  const [practiceSet, setPracticeSet] = useState<PracticeSet>(() => createMockPracticeSet());
  const [reviewResources, setReviewResources] = useState<ReviewResourceRecommendation>(() => createMockReviewResourceRecommendations());
  const [practiceSetResult, setPracticeSetResult] = useState<unknown>(null);
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

  const studentId = sessionUserId ?? overview.student.id;

  // ---- Data loading ----
  useEffect(() => {
    let active = true;
    Promise.all([
      fetchDashboardOverview(), fetchRecommendedPracticeSet(), fetchReviewResourceRecommendations(),
      fetchLearningProfile(studentId), fetchTrialProgress(), fetchStudyReminders(),
      fetchSprintPlan(), fetchMasteryMap(), fetchWrongQuestionSummary(), fetchAssessmentHistory(),
    ]).then(([data, recSet, resources, profile, trial, reminders, sprint, mastery, wrongSum, history]) => {
      if (!active) return;
      setOverview(data);
      setTeacherQuestionList(data.questions.filter((q) => q.knowledgePointIds.includes('co-cache')));
      setPracticeSet(recSet);
      setReviewResources(resources);
      setLearningProfile(profile);
      setTrialProgress(trial);
      setStudyReminders(reminders);
      setSprintPlan(sprint);
      setMasteryMap(mastery);
      setWrongQuestionSummary(wrongSum);
      setAssessmentHistory(history);
      setApiState('connected');
      setLastSyncAt(new Date().toISOString());
    }).catch(() => {
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
    return () => { active = false; };
  }, [studentId]);

  // Role-based data loading
  useEffect(() => {
    let active = true;
    if (sessionUserId === 'teacher-001') {
      fetchTeacherClassAnalytics().then((a) => { if (active) setTeacherClassAnalytics(a); })
        .catch(() => { if (active) setTeacherStatus('教师数据加载失败'); });
    }
    if (sessionUserId === 'admin-001') {
      Promise.all([fetchAdminMetrics(), fetchAdminUsers(), fetchTeacherClassAnalytics(), fetchReviewQueue(), fetchSystemConfig(), fetchFeedbackList()])
        .then(([m, u, c, q, cfg, f]) => { if (active) { setAdminMetrics(m); setAdminUsers(u); setTeacherClassAnalytics(c); setReviewQueue(q); setSystemConfig(cfg); setFeedbackList(f); } })
        .catch(() => { if (active) setReviewStatus('管理数据加载失败'); });
    }
    return () => { active = false; };
  }, [sessionUserId]);

  // Onboarding check
  useEffect(() => {
    if (isStaticDemoMode()) { setOnboardingChecked(true); return; }
    import('../api/endpoints/onboarding').then(({ fetchOnboardingStatus }) =>
      fetchOnboardingStatus().then((s) => { if (!s.completed) setShowOnboarding(true); setOnboardingChecked(true); })
        .catch(() => setOnboardingChecked(true)),
    );
  }, []);

  useEffect(() => {
    if (!onboardingChecked || showOnboarding || isStaticDemoMode()) return;
    fetchTodayPlan().then(setTodayPlan).catch(() => {});
  }, [onboardingChecked, showOnboarding]);

  // ---- Handlers (abbreviated — key ones extracted) ----
  const { student } = overview;
  const currentQuestion = overview.questions[0];

  async function refreshTodayPlan() { try { setTodayPlan(await fetchTodayPlan()); } catch {} }

  async function handleOnboardingComplete(result: Awaited<ReturnType<typeof import('../api/endpoints/onboarding').completeOnboarding>>) {
    setShowOnboarding(false);
    if (result.todayPlan) setTodayPlan(result.todayPlan as TodayPlanType);
    try { setOverview(await fetchDashboardOverview()); setApiState('connected'); setLastSyncAt(new Date().toISOString()); } catch {}
  }

  async function handleSubmitDiagnostic() {
    setDiagnosticStatus('正在生成入学诊断...');
    try {
      await submitDiagnosticProfile({ targetScore: 118, currentScore: 58, remainingDays: 120, dailyHours: 2.5, weakestSubject: '操作系统' });
      setOverview(await fetchDashboardOverview()); setApiState('connected');
      setDiagnosticStatus('已切换到新阶段计划。');
    } catch { setDiagnosticStatus('提交失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }

  async function handleSubmitAnswer(selectedAnswer: string) {
    setPracticeStatus('正在提交...');
    try {
      const record = await submitPracticeAnswer({ questionId: currentQuestion.id, knowledgePointId: currentQuestion.knowledgePointIds[0], selectedAnswer, timeSpentSec: 135 });
      setOverview(await fetchDashboardOverview()); setApiState('connected');
      setPracticeStatus(record.correct ? '回答正确' : `错因：${record.mistakeReason ?? '待复盘'}`);
    } catch { setPracticeStatus('提交失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }

  const handleSubmitPracticeSet = useCallback(async () => {
    setPracticeStatus('正在提交...');
    try {
      const result = await submitPracticeSet({ practiceSetId: practiceSet.id, answers: practiceSet.questions.slice(0, 3).map((q: { id: string; answer: string; expectedTimeSec: number }, i: number) => ({ questionId: q.id, selectedAnswer: i === 0 ? q.answer : 'A', timeSpentSec: q.expectedTimeSec + 10 })) });
      setOverview(await fetchDashboardOverview()); setPracticeSet(await fetchRecommendedPracticeSet()); setPracticeSetResult(result); setApiState('connected');
      setPracticeStatus(`正确率 ${result.accuracyRate}%`);
    } catch { setPracticeStatus('提交失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, [practiceSet.id]);

  const handleCompleteTask = useCallback(async (taskId: string) => {
    setTaskStatus('正在记录...');
    const task = overview.plan.dailyTasks.find((t) => t.id === taskId);
    try {
      await completeStudyTask({ taskId, completedQuestionCount: task?.questionCount, minutesSpent: task?.minutes });
      setOverview(await fetchDashboardOverview()); setApiState('connected');
      setTaskStatus('任务已完成');
    } catch { setTaskStatus('记录失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, [overview.plan]);

  const handleReviewWrongQuestion = useCallback(async (questionId: string) => {
    setWrongStatus('正在记录...');
    try {
      await reviewWrongQuestion(questionId);
      setOverview(await fetchDashboardOverview()); setApiState('connected');
      setWrongStatus('已复盘');
    } catch { setWrongStatus('记录失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, []);

  const handleGenerateAssessment = useCallback(async () => {
    setAssessmentStatus('正在生成...');
    try {
      const a = await fetchStageAssessment();
      setOverview((c) => ({ ...c, stageAssessment: a })); setStageResult(null); setApiState('connected');
      setAssessmentStatus(`已生成 ${a.questions.length} 题`);
    } catch { setAssessmentStatus('生成失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, []);

  const handleSubmitAssessment = useCallback(async () => {
    setAssessmentStatus('正在提交...');
    try {
      const result = await submitStageAssessment({ answers: overview.stageAssessment.questions.map((q, i) => ({ questionId: q.id, selectedAnswer: i === 0 ? q.answer : 'A', timeSpentSec: q.expectedTimeSec + 20 })) });
      setOverview(await fetchDashboardOverview()); setStageResult(result); setApiState('connected');
      setAssessmentStatus(`得分 ${result.score}`);
    } catch { setAssessmentStatus('提交失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, [overview.stageAssessment]);

  const handleAskTutor = useCallback(async () => {
    setTutorStatus('AI 正在整理...');
    try {
      setTutorReply(await requestTutorReply({ questionId: currentQuestion.id, selectedAnswer: 'A' }));
      setApiState('connected'); setTutorStatus('已生成答疑');
    } catch { setTutorStatus('AI 暂不可用'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, [currentQuestion.id]);

  const handleAskFollowUp = useCallback(async (message: string) => {
    setTutorStatus('AI 正在整理...');
    try {
      setAiFollowUp(await requestAiFollowUp({ questionId: currentQuestion.id, message }));
      setApiState('connected'); setTutorStatus('已生成复习卡片');
    } catch { setTutorStatus('AI 暂不可用'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, [currentQuestion.id]);

  const handleSubmitFeedback = useCallback(async () => {
    setFeedbackStatus('正在提交...');
    try {
      await submitFeedback({ rating: 4, scene: '原型试用', message: '推荐题组和学习档案有帮助。' });
      setApiState('connected'); setFeedbackStatus('已提交反馈');
    } catch { setFeedbackStatus('提交失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, []);

  // Teacher handlers
  const handleCreateTeacherQuestion = useCallback(async () => {
    setTeacherStatus('正在新增...');
    try {
      await createTeacherQuestion({ stem: 'Cache 命中率提高后，平均访存时间通常会如何变化？', options: ['增大', '不变', '减小', '无法判断'], answer: 'C', analysis: '命中率提高，访问更多落在高速 Cache 中。', knowledgePointIds: ['co-cache'], difficulty: '中等', type: '选择题', source: '教师新增', year: 2026 });
      setOverview(await fetchDashboardOverview()); setTeacherQuestionList(await fetchQuestions({ knowledgePointId: 'co-cache' })); setApiState('connected');
      setTeacherStatus('已新增题目');
    } catch { setTeacherStatus('录入失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, []);

  const handleDeleteTeacherQuestion = useCallback(async () => {
    const target = teacherQuestionList.find((q) => !['q-001', 'q-002'].includes(q.id)) ?? teacherQuestionList[0];
    if (!target) return;
    setTeacherStatus('正在删除...');
    try {
      await deleteTeacherQuestion(target.id);
      setOverview(await fetchDashboardOverview()); setTeacherQuestionList(await fetchQuestions({ knowledgePointId: 'co-cache' })); setApiState('connected');
      setTeacherStatus('已删除');
    } catch { setTeacherStatus('删除失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, [teacherQuestionList]);

  const handleUpdateTeacherQuestion = useCallback(async () => {
    const target = teacherQuestionList.find((q) => q.id.startsWith('q-')) ?? teacherQuestionList[0];
    if (!target) return;
    setTeacherStatus('正在编辑...');
    try {
      await updateTeacherQuestion(target.id, { difficulty: '困难' as const, analysis: '更新后的解析。' });
      setOverview(await fetchDashboardOverview()); setTeacherQuestionList(await fetchQuestions({ knowledgePointId: 'co-cache' })); setApiState('connected');
      setTeacherStatus('已更新');
    } catch { setTeacherStatus('编辑失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, [teacherQuestionList]);

  const handleCreateKnowledgePoint = useCallback(async () => {
    setKnowledgeStatus('正在新增...');
    try {
      await createKnowledgePoint({ id: `os-mem-${Date.now()}`, subject: '操作系统', chapter: '内存管理', title: '分页与地址转换', importance: 5, frequency: 4, prerequisites: ['进程地址空间'] });
      setOverview(await fetchDashboardOverview()); setApiState('connected');
      setKnowledgeStatus('已新增');
    } catch { setKnowledgeStatus('新增失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, []);

  const handleFilterTeacherQuestions = useCallback(async () => {
    try { setTeacherQuestionList(await fetchQuestions({ knowledgePointId: 'co-cache' })); setApiState('connected'); setTeacherStatus('已筛选'); }
    catch { setTeacherQuestionList(overview.questions.filter((q) => q.knowledgePointIds.includes('co-cache'))); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, [overview.questions]);

  const handleGeneratePaper = useCallback(async () => {
    setPaperStatus('正在生成...');
    try {
      setLatestPaper(await generatePaper({ title: '存储系统专项卷', paperType: '专项卷', knowledgePointIds: ['co-cache'], questionCount: 2, createdBy: 'teacher-001' }));
      setApiState('connected'); setPaperStatus('已生成');
    } catch {
      setLatestPaper(createMockGeneratedPaper()); setPaperStatus('使用演示数据'); setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }, []);

  const handleStartPaperSession = useCallback(() => {
    if (!latestPaper) return;
    setPaperSession({ answeredCount: 0, unansweredCount: latestPaper.questionCount, totalQuestions: latestPaper.questionCount, elapsedSec: 0, timeLimitSec: latestPaper.estimatedMinutes * 60, overtime: false, progressRate: 0 });
  }, [latestPaper]);

  const handleSubmitPaper = useCallback(async () => {
    if (!latestPaper) return;
    setPaperStatus('正在提交...');
    try {
      const result = await submitPaper({ paperId: latestPaper.id, answers: latestPaper.questions.map((q, i) => ({ questionId: q.id, selectedAnswer: i === 0 ? (q.answer === 'A' ? 'B' : 'A') : q.answer, timeSpentSec: q.expectedTimeSec + 15 })) });
      setPaperResult(result); setPaperSession(result.examSession); setOverview(await fetchDashboardOverview()); setApiState('connected');
      setPaperStatus(`得分 ${result.score}`);
    } catch {
      const mock = createMockPaperSubmitResult(latestPaper, student.id);
      setPaperResult(mock); setPaperSession(mock?.examSession ?? null); setPaperStatus('使用演示数据'); setApiState(isMockAllowed() ? 'mock' : 'error');
    }
  }, [latestPaper, student.id]);

  // Admin handlers
  const handleApproveReviewItem = useCallback(async (id: string) => {
    setReviewStatus('正在提交...');
    try { await approveReviewItem({ reviewItemId: id, reviewerId: 'admin-001' }); setReviewQueue(await fetchReviewQueue()); setAdminMetrics(await fetchAdminMetrics()); setApiState('connected'); setReviewStatus('已通过'); }
    catch { setReviewStatus('提交失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, []);

  const handleMarkReviewItemNeedsRecheck = useCallback(async (id: string) => {
    setReviewStatus('正在标记...');
    try { await markReviewItemNeedsRecheck({ reviewItemId: id, reviewerId: 'admin-001' }); setReviewQueue(await fetchReviewQueue()); setApiState('connected'); setReviewStatus('已标记复查'); }
    catch { setReviewStatus('标记失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, []);

  const handleApplySprintConfig = useCallback(async () => {
    setConfigStatus('正在应用...');
    try { setSystemConfig(await updateSystemConfig({ updatedBy: 'admin-001', recommendation: { stageAssessmentQuestionLimit: 2, dailyTargetQuestionCount: 35, speedRiskMultiplier: 1.25 } })); setApiState('connected'); setConfigStatus('已应用冲刺策略'); }
    catch { setConfigStatus('更新失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, []);

  const handleMarkTrialFollowUp = useCallback(async () => {
    const target = adminUsers.users.find((u) => u.role === 'student');
    if (!target) return;
    setUserStatus('正在更新...');
    try { await updateAdminUserTrialStatus({ userId: target.id, trialStatus: 'follow_up' }); setAdminUsers(await fetchAdminUsers()); setApiState('connected'); setUserStatus('已标记待回访'); }
    catch { setUserStatus('更新失败'); setApiState(isMockAllowed() ? 'mock' : 'error'); }
  }, [adminUsers]);

  function addMockPaperResultToHistory(result: PaperSubmitResult, paper: GeneratedPaper) {
    setAssessmentHistory((c) => {
      const next = { id: `h-${Date.now()}`, paperId: paper.id, userId: result.userId, title: paper.title, submittedAt: result.submittedAt, score: result.score, totalScore: 100, accuracyRate: result.accuracyRate, elapsedSec: result.examSession.elapsedSec, unansweredCount: result.examSession.unansweredCount, weakPointTitle: result.weakKnowledgePoints[0] ?? '限时整卷训练', reviewSuggestion: result.accuracyRate >= 80 ? '表现较好' : '先处理薄弱点' };
      return { userId: result.userId, items: [next, ...c.items].slice(0, 5), summary: { attemptCount: c.items.length + 1, bestScore: Math.max(...c.items.map((i) => i.score), next.score), latestAccuracyRate: next.accuracyRate, improvementText: '已更新' } };
    });
  }

  const ctx: DashboardCtx = {
    overview, adminMetrics, adminUsers, teacherClassAnalytics, reviewQueue, systemConfig,
    learningProfile, practiceSet, reviewResources, trialProgress, studyReminders, sprintPlan,
    masteryMap, wrongQuestionSummary, assessmentHistory, feedbackList, todayPlan,
    showOnboarding, onboardingChecked,
    apiState, lastSyncAt,
    diagnosticStatus, assessmentStatus, practiceStatus, taskStatus, wrongStatus,
    tutorStatus, teacherStatus, reviewStatus, configStatus, knowledgeStatus, paperStatus,
    feedbackStatus, userStatus,
    stageResult, tutorReply, aiFollowUp, redoQuestionId, taskAdjustment,
    practiceSetResult, teacherQuestionList, latestPaper, paperResult, paperSession,
    setShowOnboarding, setRedoQuestionId, setPracticeStatus,
    handleSubmitDiagnostic, handleSubmitAnswer, handleSubmitPracticeSet, handleCompleteTask,
    handleReviewWrongQuestion, handleGenerateAssessment, handleSubmitAssessment,
    handleAskTutor, handleAskFollowUp, handleCreateTeacherQuestion, handleUpdateTeacherQuestion,
    handleDeleteTeacherQuestion, handleCreateKnowledgePoint, handleGeneratePaper,
    handleStartPaperSession, handleSubmitPaper,
    handleApproveReviewItem, handleMarkReviewItemNeedsRecheck, handleApplySprintConfig,
    handleSubmitFeedback, handleMarkTrialFollowUp, handleFilterTeacherQuestions,
    refreshTodayPlan, handleOnboardingComplete, addMockPaperResultToHistory,
  };

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}
