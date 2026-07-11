import {
  buildStudyPlan,
  computeWeaknessReport,
  type KnowledgePoint,
  type PracticeRecord,
  type Question,
  type StudyPlan,
  type UserProfile,
  type UserRole,
  type WeaknessReport,
  type DiagnosticProfile,
  type Subject,
} from '@kaoyan408/shared';
import { knowledgePoints, practiceRecords, questions, student } from './mockData';

export interface DashboardOverview {
  source: 'memory-api' | 'postgresql' | 'mock';
  student: UserProfile;
  knowledgePoints: KnowledgePoint[];
  questions: Question[];
  practiceRecords: PracticeRecord[];
  wrongQuestions: WrongQuestion[];
  learningCalendar: LearningCalendar;
  stageAssessment: StageAssessment;
  report: WeaknessReport;
  plan: StudyPlan;
}

export interface AdminMetrics {
  source: 'memory-api' | 'postgresql';
  activeStudentCount: number;
  questionCount: number;
  knowledgePointCount: number;
  practiceRecordCount: number;
  todayPracticeCount: number;
  todayCompletedTaskCount: number;
  completedTaskCount: number;
  accuracyRate: number;
  weakPointCount: number;
  pendingWrongQuestionCount: number;
  pendingReviewCount: number;
  averagePracticeTimeSec: number;
  retentionDays: number;
  topWeakPoint: string | null;
  generatedAt: string;
}

export interface TeacherClassAnalytics {
  source: 'memory-api' | 'postgresql' | 'mock';
  className: string;
  generatedAt: string;
  overview: {
    studentCount: number;
    activeStudentCount: number;
    averageAccuracyRate: number;
    averageCompletionRate: number;
    pendingWrongQuestionCount: number;
  };
  subjectWeakness: Array<{
    subject: string;
    weakPointCount: number;
    averageMastery: number;
    recommendation: string;
  }>;
  weakKnowledgePoints: Array<{
    knowledgePointId: string;
    title: string;
    subject: string;
    accuracyRate: number;
    wrongCount: number;
    recommendedAction: string;
  }>;
  atRiskStudents: Array<{
    userId: string;
    name: string;
    riskType: string;
    reason: string;
    nextAction: string;
  }>;
  teachingActions: string[];
}

export type TrialStatus = 'invited' | 'active' | 'completed' | 'follow_up';

export interface AdminManagedUser {
  id: string;
  name: string;
  role: 'student' | 'teacher' | 'admin';
  trialStatus: TrialStatus;
  stage?: string;
  targetScore?: number;
  targetSchool?: string;
  lastActiveAt: string;
  nextAction: string;
}

export interface AdminUserManagement {
  source: 'memory-api' | 'postgresql' | 'mock';
  generatedAt: string;
  summary: {
    totalUsers: number;
    studentCount: number;
    activeTrialCount: number;
    followUpCount: number;
  };
  users: AdminManagedUser[];
}

export interface ReviewQueue {
  source: 'memory-api' | 'postgresql';
  pendingCount: number;
  approvedCount: number;
  items: ReviewItem[];
  generatedAt: string;
}

export interface FeedbackItem {
  id: string;
  userId: string;
  rating: number;
  scene: string;
  message: string;
  surveyUrl: string;
  status: 'new' | 'reviewed';
  createdAt: string;
}

export interface FeedbackList {
  totalCount: number;
  averageRating: number;
  surveyUrl: string;
  items: FeedbackItem[];
}

export interface TrialProgress {
  userId: string;
  title: string;
  completedCount: number;
  totalCount: number;
  completionRate: number;
  items: Array<{
    id: string;
    title: string;
    description: string;
    completed: boolean;
    actionAnchor: string;
  }>;
  nextAction: string;
}

export interface StudyReminders {
  userId: string;
  title: string;
  generatedAt: string;
  items: Array<{
    id: string;
    type: 'weakness' | 'wrong-question' | 'daily-task' | 'habit' | 'trial' | 'feedback';
    priority: 'high' | 'medium' | 'low';
    title: string;
    reason: string;
    actionText: string;
    actionAnchor: string;
  }>;
}

export interface SprintPlan {
  userId: string;
  title: string;
  currentStage?: string;
  scoreGap: number;
  targetScore?: number;
  currentScore?: number;
  remainingDays?: number;
  weeklyQuestionTarget: number;
  weeklyReviewTarget: number;
  risks: string[];
  generatedAt: string;
  days: Array<{
    dayIndex: number;
    date: string;
    focus: string;
    minutes: number;
    questionTarget: number;
    reviewTarget: number;
    reason: string;
  }>;
}

export interface MasteryMap {
  userId: string;
  title: string;
  generatedAt: string;
  subjects: Array<{
    subject: string;
    averageMastery: number;
    weakCount: number;
    reviewCount: number;
    masteredCount: number;
    points: MasteryPoint[];
  }>;
  weakestPoints: Array<MasteryPoint & { subject: string }>;
}

export interface MasteryPoint {
  knowledgePointId: string;
  title: string;
  chapter: string;
  importance: number;
  frequency: number;
  masteryRate: number;
  accuracyRate: number;
  practiceCount: number;
  wrongCount: number;
  status: 'weak' | 'review' | 'mastered';
  nextAction: string;
  actionAnchor: string;
}

export interface ReviewItem {
  id: string;
  contentType: 'question' | 'ai_reply';
  relatedId: string;
  title: string;
  summary: string;
  status: 'pending' | 'approved' | 'needs_recheck';
  riskLevel: 'low' | 'medium' | 'high';
  reviewReason: string;
  suggestedAction: string;
  createdAt: string;
  reviewerId?: string;
  reviewedAt?: string;
}

export interface SystemConfig {
  source: 'memory-api' | 'postgresql';
  recommendation: {
    stageAssessmentQuestionLimit: number;
    dailyTargetQuestionCount: number;
    speedRiskMultiplier: number;
  };
  updatedBy: string;
  updatedAt: string;
}

export interface LearningCalendar {
  days: LearningCalendarDay[];
  today: LearningCalendarDay;
  streakDays: number;
}

export interface LearningCalendarDay {
  date: string;
  completedTaskCount: number;
  practiceCount: number;
  isActive: boolean;
}

export interface StageAssessment {
  id: string;
  title: string;
  userId: string;
  description: string;
  estimatedMinutes: number;
  focusKnowledgePoints: KnowledgePoint[];
  questions: Question[];
}

export interface StageAssessmentResult {
  id: string;
  userId: string;
  submittedAt: string;
  totalQuestions: number;
  correctCount: number;
  score: number;
  adjustment: {
    previousStage: string;
    stage: string;
    planPhase: string;
    scoreBand: string;
    message: string;
  };
  reviewItems: Array<{
    questionId: string;
    stem: string;
    selectedAnswer?: string;
    correctAnswer?: string;
    knowledgePointId: string;
    knowledgePointTitle: string;
    mistakeReason: string | null;
    analysis?: string;
  }>;
  nextActions: string[];
}

export interface PracticeSet {
  id: string;
  userId: string;
  title: string;
  stage: string;
  focus: string;
  reason: string;
  knowledgePointIds: string[];
  questionCount: number;
  estimatedMinutes: number;
  questions: Question[];
}

export interface PracticeSetResult {
  id: string;
  practiceSetId: string;
  userId: string;
  submittedAt: string;
  totalQuestions: number;
  correctCount: number;
  accuracyRate: number;
  results: Array<{
    questionId: string;
    stem: string;
    selectedAnswer?: string;
    correctAnswer?: string;
    correct: boolean;
    mistakeReason: string | null;
  }>;
  nextActions: string[];
}

export interface ReviewResourceRecommendation {
  source: 'memory-api' | 'postgresql';
  userId: string;
  generatedAt: string;
  weakPointCount: number;
  items: ReviewResource[];
}

export interface ReviewResource {
  id: string;
  knowledgePointId: string;
  knowledgePointTitle: string;
  subject: string;
  resourceType: 'concept_card' | 'mistake_checklist' | 'example_walkthrough' | 'practice_set';
  title: string;
  summary: string;
  estimatedMinutes: number;
  difficulty: '基础' | '中等' | '提高';
  actionText: string;
  actionAnchor: string;
}

export interface LearningProfile {
  userId: string;
  summary: {
    name: string;
    currentStage?: string;
    targetScore?: number;
    currentScore?: number;
    weakestSubject?: string;
    accuracyRate: number;
    streakDays: number;
  };
  loopStats: {
    diagnosticCompleted: boolean;
    practiceSetCount: number;
    stageAssessmentCount: number;
    reviewedWrongQuestionCount: number;
    wrongQuestionCount: number;
  };
  timeline: Array<{
    id: string;
    type: string;
    title: string;
    date: string;
    summary: string;
  }>;
  nextMilestone: string;
}

export interface TutorReply {
  id: string;
  userId: string;
  questionId: string;
  prompt?: string;
  knowledgePointId: string;
  knowledgePointTitle: string;
  answerCheck: string;
  explanationSteps: string[];
  similarQuestions: Array<{
    id: string;
    stem: string;
    difficulty: string;
    source: string;
  }>;
  nextActions: string[];
  source: string;
}

export interface AiFollowUp {
  id: string;
  userId: string;
  questionId: string;
  message: string;
  relatedKnowledgePoint: {
    id?: string;
    title: string;
    subject: string;
    chapter: string;
  };
  replySteps: string[];
  misconceptionTips: string[];
  reviewCards: Array<{
    id: string;
    type: 'concept' | 'rule' | 'confusion';
    title: string;
    content: string;
    nextAction: string;
  }>;
  nextActions: string[];
  source: string;
}

export interface CreateTeacherQuestionInput {
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  knowledgePointIds: string[];
  difficulty: string;
  type: string;
  source: string;
  year?: number;
  expectedTimeSec?: number;
}

export interface CreateKnowledgePointInput {
  id: string;
  subject: KnowledgePoint['subject'];
  chapter: string;
  title: string;
  importance: number;
  frequency: number;
  prerequisites: string[];
}

export interface GeneratedPaper {
  id: string;
  title: string;
  paperType: '模拟卷' | '阶段卷' | '专项卷';
  questionCount: number;
  knowledgePointIds: string[];
  questions: Question[];
  estimatedMinutes: number;
  createdBy: string;
  createdAt: string;
}

export interface PaperSubmitResult {
  id: string;
  paperId: string;
  userId: string;
  submittedAt: string;
  totalQuestions: number;
  correctCount: number;
  score: number;
  accuracyRate: number;
  subjectBreakdown: Array<{
    subject: string;
    totalQuestions: number;
    correctCount: number;
    accuracyRate: number;
  }>;
  reviewItems: Array<{
    questionId: string;
    stem: string;
    selectedAnswer?: string;
    correctAnswer?: string;
    correct: boolean;
    knowledgePointId: string;
    knowledgePointTitle: string;
    subject: string;
    mistakeReason: string | null;
  }>;
  weakKnowledgePoints: string[];
  syncedPracticeRecordCount: number;
  examSession: {
    answeredCount: number;
    unansweredCount: number;
    totalQuestions: number;
    elapsedSec: number;
    timeLimitSec: number;
    overtime: boolean;
    progressRate: number;
  };
  nextActions: string[];
}

export interface AssessmentHistoryItem {
  id: string;
  paperId?: string;
  userId: string;
  title: string;
  submittedAt: string;
  score: number;
  totalScore: number;
  accuracyRate: number;
  elapsedSec: number;
  unansweredCount: number;
  weakPointTitle: string;
  reviewSuggestion: string;
}

export interface AssessmentHistory {
  userId: string;
  items: AssessmentHistoryItem[];
  summary: {
    attemptCount: number;
    bestScore: number;
    latestAccuracyRate: number;
    improvementText: string;
  };
}

export interface GeneratePaperInput {
  title: string;
  paperType: GeneratedPaper['paperType'];
  knowledgePointIds: string[];
  questionCount: number;
  createdBy: string;
}

export interface AuthSession {
  token: string;
  user: UserProfile;
}

export interface DiagnosticInput {
  targetScore: number;
  currentScore: number;
  remainingDays: number;
  dailyHours: number;
  weakestSubject: Subject;
}

export interface WrongQuestion {
  questionId: string;
  stem: string;
  answer?: string;
  analysis?: string;
  knowledgePointId: string;
  knowledgePointTitle: string;
  subject: string;
  chapter: string;
  wrongCount: number;
  latestMistakeReason: string | null;
  latestSubmittedAt: string;
  reviewStatus: 'pending' | 'reviewed';
  reviewedAt?: string | null;
  nextAction?: string;
  similarQuestions?: Array<{
    id: string;
    stem: string;
    difficulty: string;
    source: string;
  }>;
}

export interface WrongQuestionSummary {
  userId: string;
  pendingCount: number;
  reviewedCount: number;
  resolvedCount: number;
  totalWrongCount: number;
  mistakeReasonStats: Array<{
    reason: string;
    count: number;
  }>;
  priorityRedoItems: Array<{
    questionId: string;
    stem: string;
    knowledgePointTitle: string;
    wrongCount: number;
    latestMistakeReason: string | null;
    reviewStatus: 'pending' | 'reviewed';
    nextAction: string;
  }>;
  nextReviewActions: string[];
  generatedAt: string;
}

export interface TaskCompletionAdjustment {
  accuracyRate: number;
  completedQuestionCount: number;
  correctCount: number;
  minutesSpent: number;
  selfRating: number;
  intensity: 'increase' | 'hold' | 'decrease';
  tomorrowQuestionTarget: number;
  reviewTarget: number;
  focusKnowledgePointId: string;
  focusTitle: string;
  reasons: string[];
  nextActions: string[];
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000';

export function createMockOverview(): DashboardOverview {
  const report = computeWeaknessReport({
    knowledgePoints,
    records: practiceRecords,
    targetScore: student.targetScore ?? 110,
  });
  const plan = buildStudyPlan({
    targetScore: student.targetScore ?? 110,
    remainingDays: student.remainingDays ?? 90,
    dailyHours: student.dailyHours ?? 3,
    stage: student.stage ?? '强化',
    knowledgePoints,
    records: practiceRecords,
  });

  return {
    source: 'mock',
    student,
    knowledgePoints,
    questions,
    practiceRecords,
    wrongQuestions: [
      {
        questionId: questions[0].id,
        stem: questions[0].stem,
        answer: questions[0].answer,
        analysis: questions[0].analysis,
        knowledgePointId: 'co-cache',
        knowledgePointTitle: 'Cache 映射与替换',
        subject: '计算机组成原理',
        chapter: '存储系统',
        wrongCount: 2,
        latestMistakeReason: '概念不清',
        latestSubmittedAt: '2026-06-22',
        reviewStatus: 'pending',
        reviewedAt: null,
      },
    ],
    learningCalendar: createMockLearningCalendar(),
    stageAssessment: createMockStageAssessment(),
    report,
    plan,
  };
}

export function createMockAdminMetrics(): AdminMetrics {
  return {
    source: 'memory-api',
    activeStudentCount: 1,
    questionCount: questions.length,
    knowledgePointCount: knowledgePoints.length,
    practiceRecordCount: practiceRecords.length,
    todayPracticeCount: 1,
    todayCompletedTaskCount: 1,
    completedTaskCount: 1,
    accuracyRate: 66.7,
    weakPointCount: 1,
    pendingWrongQuestionCount: 1,
    pendingReviewCount: 0,
    averagePracticeTimeSec: 140,
    retentionDays: 3,
    topWeakPoint: 'Cache 映射与替换',
    generatedAt: new Date().toISOString(),
  };
}

export function createMockTeacherClassAnalytics(): TeacherClassAnalytics {
  return {
    source: 'mock',
    className: '408 强化体验班',
    generatedAt: new Date().toISOString(),
    overview: {
      studentCount: 1,
      activeStudentCount: 1,
      averageAccuracyRate: 66.7,
      averageCompletionRate: 40,
      pendingWrongQuestionCount: 1,
    },
    subjectWeakness: [
      { subject: '数据结构', weakPointCount: 0, averageMastery: 72, recommendation: '保持树与图的真题巩固。' },
      { subject: '计算机组成原理', weakPointCount: 1, averageMastery: 38, recommendation: '安排 Cache 映射与替换专题讲解。' },
      { subject: '操作系统', weakPointCount: 1, averageMastery: 58, recommendation: '补一次进程同步与 PV 操作小课。' },
      { subject: '计算机网络', weakPointCount: 0, averageMastery: 70, recommendation: '继续做 TCP 可靠传输限时训练。' },
    ],
    weakKnowledgePoints: [
      {
        knowledgePointId: 'co-cache',
        title: 'Cache 映射与替换',
        subject: '计算机组成原理',
        accuracyRate: 0,
        wrongCount: 2,
        recommendedAction: '围绕 Cache 映射与替换做 15 分钟概念串讲，再布置 5 道变式题。',
      },
      {
        knowledgePointId: 'os-sync',
        title: '进程同步与互斥',
        subject: '操作系统',
        accuracyRate: 50,
        wrongCount: 1,
        recommendedAction: '用生产者消费者模型串讲 PV 操作，再做同类题。',
      },
    ],
    atRiskStudents: [
      {
        userId: student.id,
        name: student.name,
        riskType: '正确率偏低',
        reason: '最近练习正确率低于 70%，错题集中在高频考点。',
        nextAction: '本周优先跟进 Cache 映射与替换，要求完成错题复盘和同考点训练。',
      },
    ],
    teachingActions: [
      '本周小课优先讲 Cache 映射与替换，讲完立即做变式题检验。',
      '安排一次错题复盘课，要求学生写出错因而不是只看答案。',
      '保持测评后复盘节奏，用历史记录观察连续两次趋势。',
    ],
  };
}

export function createMockAdminUserManagement(): AdminUserManagement {
  const users: AdminManagedUser[] = [
    {
      id: student.id,
      name: student.name,
      role: 'student',
      trialStatus: 'active',
      stage: student.stage,
      targetScore: student.targetScore,
      targetSchool: student.targetSchool,
      lastActiveAt: new Date().toISOString().slice(0, 10),
      nextAction: '完成核心试用流程后，邀请填写问卷并追问真实备考痛点。',
    },
    {
      id: 'teacher-001',
      name: '王老师',
      role: 'teacher',
      trialStatus: 'active',
      stage: '教研维护',
      lastActiveAt: new Date().toISOString().slice(0, 10),
      nextAction: '继续维护题库、知识点和班级学情分析。',
    },
    {
      id: 'admin-001',
      name: '管理员',
      role: 'admin',
      trialStatus: 'active',
      stage: '平台运营',
      lastActiveAt: new Date().toISOString().slice(0, 10),
      nextAction: '查看试用名单、内容审核和运营数据。',
    },
  ];

  return {
    source: 'mock',
    generatedAt: new Date().toISOString(),
    summary: {
      totalUsers: users.length,
      studentCount: users.filter((user) => user.role === 'student').length,
      activeTrialCount: users.filter((user) => user.trialStatus === 'active').length,
      followUpCount: users.filter((user) => user.trialStatus === 'follow_up').length,
    },
    users,
  };
}

export function createMockReviewQueue(): ReviewQueue {
  return {
    source: 'memory-api',
    pendingCount: 0,
    approvedCount: 0,
    generatedAt: new Date().toISOString(),
    items: [],
  };
}

export function createMockSystemConfig(): SystemConfig {
  return {
    source: 'memory-api',
    recommendation: {
      stageAssessmentQuestionLimit: 6,
      dailyTargetQuestionCount: 30,
      speedRiskMultiplier: 1.4,
    },
    updatedBy: 'system',
    updatedAt: new Date().toISOString(),
  };
}

function createMockStageAssessment(): StageAssessment {
  return {
    id: `stage-${new Date().toISOString().slice(0, 10)}`,
    title: '强化阶段测评',
    userId: student.id,
    description: '根据当前薄弱点生成的小测，用于判断本阶段是否需要继续专项突破。',
    estimatedMinutes: 12,
    focusKnowledgePoints: knowledgePoints.slice(0, 2),
    questions: questions.slice(0, 2),
  };
}

function createMockLearningCalendar(): LearningCalendar {
  const today = new Date().toISOString().slice(0, 10);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);

    return {
      date: key,
      completedTaskCount: index === 6 ? 1 : 0,
      practiceCount: index >= 4 ? 1 : 0,
      isActive: index >= 4,
    };
  });

  return {
    days,
    today: days[days.length - 1],
    streakDays: 3,
  };
}

export function createMockFeedbackList(): FeedbackList {
  return {
    totalCount: 0,
    averageRating: 0,
    surveyUrl: 'https://wj.qq.com/s2/27160624/40fe/',
    items: [],
  };
}

export function createMockTrialProgress(): TrialProgress {
  return {
    userId: student.id,
    title: '15 分钟体验任务',
    completedCount: 0,
    totalCount: 5,
    completionRate: 0,
    nextAction: '提交入学诊断',
    items: [
      { id: 'diagnostic', title: '提交入学诊断', description: '生成阶段计划。', completed: false, actionAnchor: '#dashboard' },
      { id: 'daily-task', title: '完成一个今日任务', description: '记录今日进度。', completed: false, actionAnchor: '#plan' },
      { id: 'practice-set', title: '提交推荐题组', description: '体验题组作答。', completed: false, actionAnchor: '#question' },
      { id: 'wrong-review', title: '标记一次错题复盘', description: '体验错题闭环。', completed: false, actionAnchor: '#wrong-book' },
      { id: 'feedback', title: '提交体验反馈', description: '提交站内反馈或问卷。', completed: false, actionAnchor: '#feedback' },
    ],
  };
}

export function createMockStudyReminders(): StudyReminders {
  return {
    userId: student.id,
    title: '今日提分提醒',
    generatedAt: new Date().toISOString(),
    items: [
      {
        id: 'mock-weakness',
        type: 'weakness',
        priority: 'high',
        title: '优先补强 Cache 映射与替换',
        reason: '当前薄弱点集中在高频章节，建议先做一组推荐题。',
        actionText: '去练推荐题组',
        actionAnchor: '#question',
      },
      {
        id: 'mock-task',
        type: 'daily-task',
        priority: 'medium',
        title: '完成一个今日任务',
        reason: '先完成计划中的小任务，能更快看到报告变化。',
        actionText: '去看计划',
        actionAnchor: '#plan',
      },
      {
        id: 'mock-feedback',
        type: 'feedback',
        priority: 'low',
        title: '体验后补充真实建议',
        reason: '走完核心流程后填写问卷，有助于完善后续功能。',
        actionText: '去反馈',
        actionAnchor: '#feedback',
      },
    ],
  };
}

export function createMockSprintPlan(): SprintPlan {
  const today = new Date().toISOString().slice(0, 10);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + index);

    return {
      dayIndex: index + 1,
      date: date.toISOString().slice(0, 10),
      focus: index === 6 ? '阶段小测与错题回看' : index % 2 === 0 ? 'Cache 映射与替换' : '操作系统进程同步',
      minutes: 150,
      questionTarget: index === 6 ? 40 : 30,
      reviewTarget: index % 3 === 2 ? 4 : 2,
      reason: index === 6 ? '用小测检查本周补弱效果。' : '围绕当前薄弱点做短周期补强。',
    };
  });

  return {
    userId: student.id,
    title: '7 天冲刺计划',
    currentStage: student.stage,
    scoreGap: Math.max(0, (student.targetScore ?? 0) - (student.currentScore ?? 0)),
    targetScore: student.targetScore,
    currentScore: student.currentScore,
    remainingDays: student.remainingDays,
    weeklyQuestionTarget: days.reduce((sum, day) => sum + day.questionTarget, 0),
    weeklyReviewTarget: days.reduce((sum, day) => sum + day.reviewTarget, 0),
    risks: ['错题复盘不足时，本周提分会更依赖重复刷题而不是消化。'],
    generatedAt: new Date().toISOString(),
    days,
  };
}

export function createMockMasteryMap(): MasteryMap {
  const points: MasteryPoint[] = knowledgePoints.map((point, index) => ({
    knowledgePointId: point.id,
    title: point.title,
    chapter: point.chapter,
    importance: point.importance,
    frequency: point.frequency,
    masteryRate: index === 1 ? 38 : 72,
    accuracyRate: index === 1 ? 0 : 75,
    practiceCount: index === 1 ? 2 : 1,
    wrongCount: index === 1 ? 2 : 0,
    status: index === 1 ? 'weak' : 'review',
    nextAction: index === 1 ? '先复盘错题，再做 5 道同考点基础题。' : '补 3 道变式题，并记录易混点。',
    actionAnchor: index === 1 ? '#wrong-book' : '#question',
  }));
  const subjects = ['数据结构', '计算机组成原理', '操作系统', '计算机网络'].map((subject) => {
    const subjectPoints = points.filter((point) => knowledgePoints.find((item) => item.id === point.knowledgePointId)?.subject === subject);

    return {
      subject,
      averageMastery: subjectPoints.length ? Math.round(subjectPoints.reduce((sum, point) => sum + point.masteryRate, 0) / subjectPoints.length) : 0,
      weakCount: subjectPoints.filter((point) => point.status === 'weak').length,
      reviewCount: subjectPoints.filter((point) => point.status === 'review').length,
      masteredCount: subjectPoints.filter((point) => point.status === 'mastered').length,
      points: subjectPoints,
    };
  });

  return {
    userId: student.id,
    title: '408 掌握度地图',
    generatedAt: new Date().toISOString(),
    subjects,
    weakestPoints: points.filter((point) => point.status === 'weak').map((point) => ({ ...point, subject: '计算机组成原理' })),
  };
}

export function createMockPracticeSet(): PracticeSet {
  return {
    id: 'practice-set-mock',
    userId: student.id,
    title: '薄弱专题突破',
    stage: student.stage ?? '强化',
    focus: '相似考点辨析、变式题组、错因复盘',
    reason: '根据当前错题和薄弱知识点生成演示题组。',
    knowledgePointIds: ['co-cache'],
    questionCount: Math.min(questions.length, 4),
    estimatedMinutes: 10,
    questions: questions.slice(0, 4),
  };
}

export function createMockReviewResourceRecommendations(): ReviewResourceRecommendation {
  return {
    source: 'memory-api',
    userId: student.id,
    generatedAt: new Date().toISOString(),
    weakPointCount: 1,
    items: [
      {
        id: 'resource-co-cache-concept',
        knowledgePointId: 'co-cache',
        knowledgePointTitle: 'Cache 映射与替换',
        subject: '计算机组成原理',
        resourceType: 'concept_card',
        title: 'Cache 映射与替换核心概念卡',
        summary: '先复述直接映射、组相联和全相联的地址划分、命中判断与替换条件。',
        estimatedMinutes: 15,
        difficulty: '基础',
        actionText: '看完后做同考点题',
        actionAnchor: '#question',
      },
      {
        id: 'resource-co-cache-mistake',
        knowledgePointId: 'co-cache',
        knowledgePointTitle: 'Cache 映射与替换',
        subject: '计算机组成原理',
        resourceType: 'mistake_checklist',
        title: 'Cache 映射与替换错因检查清单',
        summary: '依次检查地址位数、组号计算、替换范围和写策略，定位最近错误发生在哪一步。',
        estimatedMinutes: 8,
        difficulty: '基础',
        actionText: '去错题本复盘',
        actionAnchor: '#wrong-book',
      },
      {
        id: 'resource-co-cache-practice',
        knowledgePointId: 'co-cache',
        knowledgePointTitle: 'Cache 映射与替换',
        subject: '计算机组成原理',
        resourceType: 'practice_set',
        title: 'Cache 映射与替换专项验证训练',
        summary: '完成 3 到 5 道变式题，用正确率和耗时判断薄弱点是否已经补上。',
        estimatedMinutes: 15,
        difficulty: '中等',
        actionText: '进入专项训练',
        actionAnchor: '#question',
      },
    ],
  };
}

export function createMockLearningProfile(): LearningProfile {
  return {
    userId: student.id,
    summary: {
      name: student.name,
      currentStage: student.stage,
      targetScore: student.targetScore,
      currentScore: student.currentScore,
      weakestSubject: student.weakestSubject,
      accuracyRate: 42.9,
      streakDays: 1,
    },
    loopStats: {
      diagnosticCompleted: true,
      practiceSetCount: 1,
      stageAssessmentCount: 1,
      reviewedWrongQuestionCount: 1,
      wrongQuestionCount: 1,
    },
    timeline: [
      { id: 'mock-profile-1', type: 'diagnostic', title: '入学诊断完成', date: '2026-06-30', summary: '系统已生成阶段计划。' },
      { id: 'mock-profile-2', type: 'practice_set', title: '推荐题组练习', date: '2026-06-30', summary: '完成推荐题组并同步练习记录。' },
      { id: 'mock-profile-3', type: 'wrong_review', title: '错题复盘', date: '2026-06-30', summary: '已复盘错题并获得相似题建议。' },
    ],
    nextMilestone: '继续完成推荐题组，并复盘本组错因。',
  };
}

export function createMockAiFollowUp(): AiFollowUp {
  return {
    id: 'follow-up-mock',
    userId: student.id,
    questionId: questions[0].id,
    message: '为什么我选 A 不对？',
    relatedKnowledgePoint: {
      id: 'co-cache',
      title: 'Cache 映射与替换',
      subject: '计算机组成原理',
      chapter: '存储系统',
    },
    replySteps: [
      '先定位考点：本题考查 Cache 映射与替换，不能只凭关键词判断。',
      '再对照标准答案：逐项检查题干条件和选项是否匹配。',
    ],
    misconceptionTips: ['不要把直接映射和组相联映射的条件混用。'],
    reviewCards: [
      {
        id: 'card-mock-concept',
        type: 'concept',
        title: '核心概念',
        content: '复习 Cache 映射时先区分映射方式、替换发生位置和命中条件。',
        nextAction: '用自己的话写出三种映射方式的区别。',
      },
      {
        id: 'card-mock-rule',
        type: 'rule',
        title: '判断规则',
        content: '先看题干给出的块号、组号或标记位，再判断选项是否符合。',
        nextAction: '重做 2 道同考点题。',
      },
    ],
    nextActions: ['回到错题本复盘本题，再做一组同知识点题。'],
    source: 'mock',
  };
}

export function createMockWrongQuestionSummary(): WrongQuestionSummary {
  return {
    userId: student.id,
    pendingCount: 1,
    reviewedCount: 0,
    resolvedCount: 0,
    totalWrongCount: 1,
    mistakeReasonStats: [
      { reason: '概念不清', count: 2 },
      { reason: '审题问题', count: 1 },
    ],
    priorityRedoItems: [
      {
        questionId: questions[0].id,
        stem: questions[0].stem,
        knowledgePointTitle: 'Cache 映射与替换',
        wrongCount: 2,
        latestMistakeReason: '概念不清',
        reviewStatus: 'pending',
        nextAction: '先标记复盘，写出错误原因后再重做。',
      },
    ],
    nextReviewActions: [
      '先复盘 1 道待处理错题，补全错因。',
      '优先重做 Cache 映射与替换，它的错误次数最高。',
    ],
    generatedAt: new Date().toISOString(),
  };
}

export function createMockGeneratedPaper(input?: Partial<GeneratePaperInput>): GeneratedPaper {
  const selectedQuestions = questions.slice(0, input?.questionCount ?? 2);

  return {
    id: `paper-mock-${new Date().toISOString().slice(0, 10)}`,
    title: input?.title ?? '存储系统专项卷',
    paperType: input?.paperType ?? '专项卷',
    questionCount: selectedQuestions.length,
    knowledgePointIds: input?.knowledgePointIds ?? ['co-cache'],
    questions: selectedQuestions,
    estimatedMinutes: Math.max(8, selectedQuestions.length * 4),
    createdBy: input?.createdBy ?? 'teacher-001',
    createdAt: new Date().toISOString(),
  };
}

export function createMockPaperSubmitResult(paper?: GeneratedPaper, userId = student.id): PaperSubmitResult | null {
  if (!paper) {
    return null;
  }

  const reviewQuestion = paper.questions[0];
  const reviewPoint = knowledgePoints.find((point) => reviewQuestion.knowledgePointIds.includes(point.id)) ?? knowledgePoints[0];
  const correctCount = Math.max(0, paper.questions.length - 1);
  const accuracyRate = Math.round((correctCount / paper.questions.length) * 100);
  const timeLimitSec = paper.estimatedMinutes * 60;
  const elapsedSec = paper.questions.reduce((sum, question) => sum + question.expectedTimeSec + 15, 0);

  return {
    id: `paper-result-mock-${new Date().toISOString().slice(0, 10)}`,
    paperId: paper.id,
    userId,
    submittedAt: new Date().toISOString(),
    totalQuestions: paper.questions.length,
    correctCount,
    score: accuracyRate,
    accuracyRate,
    subjectBreakdown: [
      {
        subject: reviewPoint.subject,
        totalQuestions: paper.questions.length,
        correctCount,
        accuracyRate,
      },
    ],
    reviewItems: [
      {
        questionId: reviewQuestion.id,
        stem: reviewQuestion.stem,
        selectedAnswer: reviewQuestion.answer === 'A' ? 'B' : 'A',
        correctAnswer: reviewQuestion.answer,
        correct: false,
        knowledgePointId: reviewPoint.id,
        knowledgePointTitle: reviewPoint.title,
        subject: reviewPoint.subject,
        mistakeReason: '概念不清',
      },
    ],
    weakKnowledgePoints: [reviewPoint.title],
    syncedPracticeRecordCount: paper.questions.length,
    examSession: {
      answeredCount: paper.questions.length,
      unansweredCount: 0,
      totalQuestions: paper.questions.length,
      elapsedSec,
      timeLimitSec,
      overtime: elapsedSec > timeLimitSec,
      progressRate: 100,
    },
    nextActions: [
      '先复盘本套卷错题，再按薄弱知识点补一组专项题。',
      '已同步 1 道需要复盘的题目到错题闭环。',
      `优先处理：${reviewPoint.title}。`,
    ],
  };
}

export function createMockAssessmentHistory(): AssessmentHistory {
  const now = new Date().toISOString();

  return {
    userId: student.id,
    summary: {
      attemptCount: 2,
      bestScore: 76,
      latestAccuracyRate: 76,
      improvementText: '较上次提升 14 分，继续巩固 Cache 映射与替换。',
    },
    items: [
      {
        id: 'assessment-history-mock-002',
        paperId: 'paper-mock-latest',
        userId: student.id,
        title: '存储系统专项卷',
        submittedAt: now,
        score: 76,
        totalScore: 100,
        accuracyRate: 76,
        elapsedSec: 38 * 60,
        unansweredCount: 0,
        weakPointTitle: 'Cache 映射与替换',
        reviewSuggestion: '先处理 Cache 映射与替换，再补 1 组变式题验证是否真正掌握。',
      },
      {
        id: 'assessment-history-mock-001',
        paperId: 'paper-mock-baseline',
        userId: student.id,
        title: '408 基础诊断卷',
        submittedAt: '2026-06-25T09:30:00.000Z',
        score: 62,
        totalScore: 100,
        accuracyRate: 62,
        elapsedSec: 42 * 60,
        unansweredCount: 1,
        weakPointTitle: '进程同步与互斥',
        reviewSuggestion: '回到 PV 操作和临界区概念，先复盘错因再做同考点基础题。',
      },
    ],
  };
}

export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  const response = await fetch(`${API_BASE_URL}/dashboard/overview`);
  if (!response.ok) {
    throw new Error(`API request failed with ${response.status}`);
  }

  return response.json() as Promise<DashboardOverview>;
}

export async function fetchTrialProgress(userId: string): Promise<TrialProgress> {
  const response = await fetch(`${API_BASE_URL}/trial-progress?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) {
    throw new Error(`Trial progress request failed with ${response.status}`);
  }

  return response.json() as Promise<TrialProgress>;
}

export async function fetchStudyReminders(userId: string): Promise<StudyReminders> {
  const response = await fetch(`${API_BASE_URL}/study-reminders?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) {
    throw new Error(`Study reminders request failed with ${response.status}`);
  }

  return response.json() as Promise<StudyReminders>;
}

export async function fetchSprintPlan(userId: string): Promise<SprintPlan> {
  const response = await fetch(`${API_BASE_URL}/sprint-plan?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) {
    throw new Error(`Sprint plan request failed with ${response.status}`);
  }

  return response.json() as Promise<SprintPlan>;
}

export async function fetchMasteryMap(userId: string): Promise<MasteryMap> {
  const response = await fetch(`${API_BASE_URL}/mastery-map?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) {
    throw new Error(`Mastery map request failed with ${response.status}`);
  }

  return response.json() as Promise<MasteryMap>;
}

export async function fetchLearningProfile(userId: string): Promise<LearningProfile> {
  const response = await fetch(`${API_BASE_URL}/students/${encodeURIComponent(userId)}/profile`);
  if (!response.ok) {
    throw new Error(`Learning profile request failed with ${response.status}`);
  }

  return response.json() as Promise<LearningProfile>;
}

export async function fetchRecommendedPracticeSet(userId: string): Promise<PracticeSet> {
  const response = await fetch(`${API_BASE_URL}/practice-sets/recommended?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) {
    throw new Error(`Recommended practice set request failed with ${response.status}`);
  }

  return response.json() as Promise<PracticeSet>;
}

export async function fetchReviewResourceRecommendations(userId: string): Promise<ReviewResourceRecommendation> {
  const response = await fetch(`${API_BASE_URL}/review-resources/recommended?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) {
    throw new Error(`Review resources request failed with ${response.status}`);
  }

  return response.json() as Promise<ReviewResourceRecommendation>;
}

export async function submitPracticeSet(input: {
  userId: string;
  practiceSetId: string;
  answers: Array<{
    questionId: string;
    selectedAnswer: string;
    timeSpentSec: number;
  }>;
}): Promise<PracticeSetResult> {
  const response = await fetch(`${API_BASE_URL}/practice-sets/${input.practiceSetId}/submit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      userId: input.userId,
      answers: input.answers,
    }),
  });

  if (!response.ok) {
    throw new Error(`Practice set submission failed with ${response.status}`);
  }

  return response.json() as Promise<PracticeSetResult>;
}

export async function fetchAdminMetrics(): Promise<AdminMetrics> {
  const response = await fetch(`${API_BASE_URL}/admin/metrics`);
  if (!response.ok) {
    throw new Error(`Admin metrics request failed with ${response.status}`);
  }

  return response.json() as Promise<AdminMetrics>;
}

export async function fetchTeacherClassAnalytics(): Promise<TeacherClassAnalytics> {
  const response = await fetch(`${API_BASE_URL}/teacher/class-analytics`);
  if (!response.ok) {
    throw new Error(`Teacher class analytics request failed with ${response.status}`);
  }

  return response.json() as Promise<TeacherClassAnalytics>;
}

export async function fetchAdminUsers(): Promise<AdminUserManagement> {
  const response = await fetch(`${API_BASE_URL}/admin/users`);
  if (!response.ok) {
    throw new Error(`Admin users request failed with ${response.status}`);
  }

  return response.json() as Promise<AdminUserManagement>;
}

export async function updateAdminUserTrialStatus(input: {
  userId: string;
  trialStatus: TrialStatus;
}): Promise<AdminManagedUser> {
  const response = await fetch(`${API_BASE_URL}/admin/users/${input.userId}/trial-status`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ trialStatus: input.trialStatus }),
  });

  if (!response.ok) {
    throw new Error(`Admin user trial status update failed with ${response.status}`);
  }

  return response.json() as Promise<AdminManagedUser>;
}

export async function fetchReviewQueue(): Promise<ReviewQueue> {
  const response = await fetch(`${API_BASE_URL}/admin/review-queue`);
  if (!response.ok) {
    throw new Error(`Review queue request failed with ${response.status}`);
  }

  return response.json() as Promise<ReviewQueue>;
}

export async function fetchFeedbackList(): Promise<FeedbackList> {
  const response = await fetch(`${API_BASE_URL}/admin/feedback`);
  if (!response.ok) {
    throw new Error(`Feedback list request failed with ${response.status}`);
  }

  return response.json() as Promise<FeedbackList>;
}

export async function submitFeedback(input: {
  userId: string;
  rating: number;
  scene: string;
  message: string;
  surveyUrl?: string;
}): Promise<FeedbackItem> {
  const response = await fetch(`${API_BASE_URL}/feedback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Feedback submission failed with ${response.status}`);
  }

  return response.json() as Promise<FeedbackItem>;
}

export async function approveReviewItem(input: {
  reviewItemId: string;
  reviewerId: string;
}): Promise<ReviewItem> {
  const response = await fetch(`${API_BASE_URL}/admin/review-queue/${input.reviewItemId}/approve`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ reviewerId: input.reviewerId }),
  });

  if (!response.ok) {
    throw new Error(`Review approval failed with ${response.status}`);
  }

  return response.json() as Promise<ReviewItem>;
}

export async function markReviewItemNeedsRecheck(input: {
  reviewItemId: string;
  reviewerId: string;
}): Promise<ReviewItem> {
  const response = await fetch(`${API_BASE_URL}/admin/review-queue/${input.reviewItemId}/recheck`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ reviewerId: input.reviewerId }),
  });

  if (!response.ok) {
    throw new Error(`Review recheck failed with ${response.status}`);
  }

  return response.json() as Promise<ReviewItem>;
}

export async function fetchSystemConfig(): Promise<SystemConfig> {
  const response = await fetch(`${API_BASE_URL}/admin/system-config`);
  if (!response.ok) {
    throw new Error(`System config request failed with ${response.status}`);
  }

  return response.json() as Promise<SystemConfig>;
}

export async function updateSystemConfig(input: Partial<SystemConfig>): Promise<SystemConfig> {
  const response = await fetch(`${API_BASE_URL}/admin/system-config`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`System config update failed with ${response.status}`);
  }

  return response.json() as Promise<SystemConfig>;
}

export async function submitPracticeAnswer(input: {
  userId: string;
  questionId: string;
  knowledgePointId: string;
  selectedAnswer: string;
  timeSpentSec: number;
}) {
  const response = await fetch(`${API_BASE_URL}/practice-records`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Practice submission failed with ${response.status}`);
  }

  return response.json() as Promise<{
    id: string;
    correct: boolean;
    mistakeReason: string | null;
  }>;
}

export async function completeStudyTask(input: {
  userId: string;
  taskId: string;
  completedQuestionCount?: number;
  correctCount?: number;
  minutesSpent?: number;
  selfRating?: number;
}) {
  const response = await fetch(`${API_BASE_URL}/study-tasks/${input.taskId}/complete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      userId: input.userId,
      completedQuestionCount: input.completedQuestionCount,
      correctCount: input.correctCount,
      minutesSpent: input.minutesSpent,
      selfRating: input.selfRating,
    }),
  });

  if (!response.ok) {
    throw new Error(`Study task completion failed with ${response.status}`);
  }

  return response.json() as Promise<{
    id: string;
    completed: boolean;
    adjustment: TaskCompletionAdjustment;
    feedback: {
      message: string;
      nextAction: string;
    };
  }>;
}

export async function reviewWrongQuestion(input: {
  userId: string;
  questionId: string;
}): Promise<WrongQuestion> {
  const response = await fetch(`${API_BASE_URL}/wrong-questions/${input.questionId}/review`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ userId: input.userId }),
  });

  if (!response.ok) {
    throw new Error(`Wrong question review failed with ${response.status}`);
  }

  return response.json() as Promise<WrongQuestion>;
}

export async function fetchWrongQuestionSummary(userId: string): Promise<WrongQuestionSummary> {
  const response = await fetch(`${API_BASE_URL}/wrong-questions/summary?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) {
    throw new Error(`Wrong question summary request failed with ${response.status}`);
  }

  return response.json() as Promise<WrongQuestionSummary>;
}

export async function fetchStageAssessment(userId: string): Promise<StageAssessment> {
  const response = await fetch(`${API_BASE_URL}/assessments/stage?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) {
    throw new Error(`Stage assessment request failed with ${response.status}`);
  }

  return response.json() as Promise<StageAssessment>;
}

export async function fetchAssessmentHistory(userId: string): Promise<AssessmentHistory> {
  const response = await fetch(`${API_BASE_URL}/assessment-history?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) {
    throw new Error(`Assessment history request failed with ${response.status}`);
  }

  return response.json() as Promise<AssessmentHistory>;
}

export async function submitStageAssessment(input: {
  userId: string;
  answers: Array<{
    questionId: string;
    selectedAnswer: string;
    timeSpentSec: number;
  }>;
}): Promise<StageAssessmentResult> {
  const response = await fetch(`${API_BASE_URL}/assessments/stage/submit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Stage assessment submission failed with ${response.status}`);
  }

  return response.json() as Promise<StageAssessmentResult>;
}

export async function requestTutorReply(input: {
  userId: string;
  questionId: string;
  selectedAnswer?: string;
  prompt?: string;
}): Promise<TutorReply> {
  const response = await fetch(`${API_BASE_URL}/ai/tutor-reply`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`AI tutor reply request failed with ${response.status}`);
  }

  return response.json() as Promise<TutorReply>;
}

export async function requestAiFollowUp(input: {
  userId: string;
  questionId: string;
  message: string;
}): Promise<AiFollowUp> {
  const response = await fetch(`${API_BASE_URL}/ai/follow-up`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`AI follow-up request failed with ${response.status}`);
  }

  return response.json() as Promise<AiFollowUp>;
}

export async function createTeacherQuestion(input: CreateTeacherQuestionInput): Promise<Question> {
  const response = await fetch(`${API_BASE_URL}/questions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Teacher question creation failed with ${response.status}`);
  }

  return response.json() as Promise<Question>;
}

export async function fetchQuestions(filters: {
  knowledgePointId?: string;
  subject?: string;
  chapter?: string;
} = {}): Promise<Question[]> {
  const params = new URLSearchParams();
  if (filters.knowledgePointId) params.set('knowledgePointId', filters.knowledgePointId);
  if (filters.subject) params.set('subject', filters.subject);
  if (filters.chapter) params.set('chapter', filters.chapter);
  const query = params.toString();
  const response = await fetch(`${API_BASE_URL}/questions${query ? `?${query}` : ''}`);

  if (!response.ok) {
    throw new Error(`Question list request failed with ${response.status}`);
  }

  return response.json() as Promise<Question[]>;
}

export async function updateTeacherQuestion(questionId: string, input: Partial<CreateTeacherQuestionInput>): Promise<Question> {
  const response = await fetch(`${API_BASE_URL}/questions/${questionId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Teacher question update failed with ${response.status}`);
  }

  return response.json() as Promise<Question>;
}

export async function deleteTeacherQuestion(questionId: string): Promise<{ id: string; deleted: boolean }> {
  const response = await fetch(`${API_BASE_URL}/questions/${questionId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Teacher question deletion failed with ${response.status}`);
  }

  return response.json() as Promise<{ id: string; deleted: boolean }>;
}

export async function createKnowledgePoint(input: CreateKnowledgePointInput): Promise<KnowledgePoint> {
  const response = await fetch(`${API_BASE_URL}/knowledge-points`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Knowledge point creation failed with ${response.status}`);
  }

  return response.json() as Promise<KnowledgePoint>;
}

export async function generatePaper(input: GeneratePaperInput): Promise<GeneratedPaper> {
  const response = await fetch(`${API_BASE_URL}/papers/generate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Paper generation failed with ${response.status}`);
  }

  return response.json() as Promise<GeneratedPaper>;
}

export async function submitPaper(input: {
  userId: string;
  paperId: string;
  answers: Array<{
    questionId: string;
    selectedAnswer: string;
    timeSpentSec: number;
  }>;
}): Promise<PaperSubmitResult> {
  const response = await fetch(`${API_BASE_URL}/papers/${input.paperId}/submit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      userId: input.userId,
      answers: input.answers,
    }),
  });

  if (!response.ok) {
    throw new Error(`Paper submission failed with ${response.status}`);
  }

  return response.json() as Promise<PaperSubmitResult>;
}

export async function loginAsRole(role: UserRole): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ role }),
  });

  if (!response.ok) {
    throw new Error(`Login failed with ${response.status}`);
  }

  return response.json() as Promise<AuthSession>;
}

export async function submitDiagnosticProfile(input: DiagnosticInput): Promise<DiagnosticProfile> {
  const response = await fetch(`${API_BASE_URL}/diagnostics/profile`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Diagnostic profile submission failed with ${response.status}`);
  }

  return response.json() as Promise<DiagnosticProfile>;
}
