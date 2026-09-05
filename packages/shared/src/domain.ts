export type Subject =
  | '数据结构'
  | '计算机组成原理'
  | '操作系统'
  | '计算机网络';

export type UserRole = 'student' | 'teacher' | 'admin';
export type Difficulty = '基础' | '中等' | '困难';
export type QuestionType = '选择题' | '综合题' | '判断题';
export type StudyStage = '基础' | '强化' | '冲刺';
export type ConfidenceLevel = '确定' | '不确定' | '完全不会';
export type MistakeReason =
  | '知识点没学过'
  | '概念混淆'
  | '公式记错'
  | '计算错误'
  | '审题错误'
  | '推理过程错误'
  | '时间不足'
  | '蒙题';

export interface UserProfile {
  id: string;
  name: string;
  role: UserRole;
  accountStatus?: 'active' | 'disabled';
  mustChangePassword?: boolean;
  targetSchool?: string;
  targetScore?: number;
  currentScore?: number;
  dailyHours?: number;
  remainingDays?: number;
  stage?: StudyStage;
  weakestSubject?: Subject;
}

export interface KnowledgePoint {
  id: string;
  subject: Subject;
  chapter: string;
  title: string;
  importance: number;
  frequency: number;
  prerequisites: string[];
}

export interface Question {
  id: string;
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  knowledgePointIds: string[];
  difficulty: Difficulty;
  type: QuestionType;
  source: string;
  year?: number;
  expectedTimeSec: number;
}

export interface PracticeRecord {
  id: string;
  userId: string;
  questionId: string;
  knowledgePointId: string;
  selectedAnswer?: string;
  correct: boolean;
  timeSpentSec: number;
  expectedTimeSec: number;
  mistakeReason: MistakeReason | null;
  submittedAt: string;
  sessionId?: string;
  actionId?: string | null;
  gradingMode?: 'objective' | 'self_assessed';
  selfScore?: number;
  maxScore?: number;
  confidence?: ConfidenceLevel;
  usedHint?: boolean;
  answerModified?: boolean;
  variantQuestionId?: string;
  knowledgePointIds?: string[];
}

export interface DailyTask {
  id: string;
  knowledgePointId: string;
  subject: Subject;
  chapter: string;
  title: string;
  minutes: number;
  questionCount: number;
  mode: string;
  priority: '高' | '中' | '低';
  reason: string;
  nextAction: string;
  completed?: boolean;
  deferred?: boolean;
  deferredUntil?: string;
  rescheduleReason?: string;
}

export interface StudyPlan {
  phase: string;
  targetScore: number;
  remainingDays: number;
  dailyHours: number;
  dailyTasks: DailyTask[];
  checkpoint: string;
  completedTaskCount?: number;
  totalTaskCount?: number;
  completionRate?: number;
}

export interface WeakPoint {
  knowledgePointId: string;
  subject: Subject | '未分类';
  chapter: string;
  title: string;
  attempts: number;
  wrongCount: number;
  slowCount: number;
  accuracyRate: number;
  topReason: MistakeReason | null;
  suggestion: string;
  weaknessScore: number;
}

export interface WeaknessReport {
  accuracyRate: number;
  completionRate: number;
  weakPoints: WeakPoint[];
  speedRisks: WeakPoint[];
  mistakeReasons: Record<string, number>;
  estimatedGain: number;
  summary: string;
}

export interface DiagnosticProfile {
  targetScore: number;
  currentScore: number;
  remainingDays: number;
  dailyHours: number;
  weakestSubject: Subject;
  stage: StudyStage;
  diagnosis: string;
}
