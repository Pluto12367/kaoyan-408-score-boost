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
  source: 'memory-api' | 'postgres-ready-api' | 'mock';
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
  source: 'memory-api' | 'postgres-ready-api';
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

export interface ReviewQueue {
  source: 'memory-api' | 'postgres-ready-api';
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
  status: 'pending' | 'approved';
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: string;
  reviewerId?: string;
  reviewedAt?: string;
}

export interface SystemConfig {
  source: 'memory-api' | 'postgres-ready-api';
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
}) {
  const response = await fetch(`${API_BASE_URL}/study-tasks/${input.taskId}/complete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ userId: input.userId }),
  });

  if (!response.ok) {
    throw new Error(`Study task completion failed with ${response.status}`);
  }

  return response.json() as Promise<{
    id: string;
    completed: boolean;
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
