import type { Subject, WeakPoint } from './domain';

export interface LearningProfileSummary {
  name: string;
  currentStage?: string;
  targetScore?: number;
  currentScore?: number;
  weakestSubject?: string;
  accuracyRate: number;
  streakDays: number;
}

export interface LearningProfileLoopStats {
  diagnosticCompleted: boolean;
  practiceSetCount: number;
  stageAssessmentCount: number;
  reviewedWrongQuestionCount: number;
  wrongQuestionCount: number;
}

export interface LearningProfileTimelineItem {
  id: string;
  type: string;
  title: string;
  date: string;
  summary: string;
}

export interface LearningProfileFocusPoint {
  knowledgePointId: string;
  subject: Subject | '未分类';
  chapter: string;
  title: string;
  wrongCount: number;
  accuracyRate: number;
  weaknessScore: number;
  topReason: string | null;
  suggestion: string;
}

export interface LearningProfileInsight {
  learningState: 'stable' | 'rising' | 'risky';
  stateReason: string;
  weakPoints: LearningProfileFocusPoint[];
  speedRisks: LearningProfileFocusPoint[];
  mistakeReasons: Array<{ reason: string; count: number }>;
  focusHints: string[];
}

export interface LearningProfile {
  userId: string;
  summary: LearningProfileSummary;
  loopStats: LearningProfileLoopStats;
  timeline: LearningProfileTimelineItem[];
  nextMilestone: string;
  insights: LearningProfileInsight;
}

export interface BuildLearningProfileInput {
  userId: string;
  summary: LearningProfileSummary;
  loopStats: LearningProfileLoopStats;
  timeline: LearningProfileTimelineItem[];
  nextMilestone?: string;
  weakPoints?: WeakPoint[];
  speedRisks?: WeakPoint[];
  mistakeReasons?: Record<string, number>;
}

function normalizeWeakPoint(point: WeakPoint): LearningProfileFocusPoint {
  return {
    knowledgePointId: point.knowledgePointId,
    subject: point.subject,
    chapter: point.chapter,
    title: point.title,
    wrongCount: point.wrongCount,
    accuracyRate: point.accuracyRate,
    weaknessScore: point.weaknessScore,
    topReason: point.topReason,
    suggestion: point.suggestion,
  };
}

function sortedEntries(input: Record<string, number> | undefined) {
  return Object.entries(input ?? {})
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function buildStateReason(input: BuildLearningProfileInput): string {
  const weakCount = input.weakPoints?.length ?? 0;
  const speedRiskCount = input.speedRisks?.length ?? 0;
  if (!input.loopStats.diagnosticCompleted) {
    return '尚未完成完整诊断，建议先补齐入学诊断和首轮练习。';
  }
  if (input.loopStats.wrongQuestionCount >= 3 || weakCount >= 3) {
    return `当前仍有 ${Math.max(input.loopStats.wrongQuestionCount, weakCount)} 个薄弱信号，优先处理高频错点。`;
  }
  if (speedRiskCount > 0) {
    return '正确率尚可，但部分知识点仍存在速度风险，需要加入限时训练。';
  }
  if (input.summary.accuracyRate >= 75 && input.summary.streakDays >= 3) {
    return '当前学习节奏稳定，适合进入强化巩固和真题提升。';
  }
  if (input.loopStats.reviewedWrongQuestionCount > 0) {
    return '已开始形成复盘闭环，继续保持错题回收和变式练习。';
  }
  return '当前学习状态平稳，建议继续按计划完成训练与复盘。';
}

function buildFocusHints(input: BuildLearningProfileInput): string[] {
  const hints = new Set<string>();
  for (const point of (input.weakPoints ?? []).slice(0, 3)) {
    hints.add(`优先补强：${point.title}`);
  }
  for (const point of (input.speedRisks ?? []).slice(0, 2)) {
    hints.add(`限时训练：${point.title}`);
  }
  const reasons = sortedEntries(input.mistakeReasons);
  if (reasons[0]) {
    hints.add(`主要错因：${reasons[0][0]}`);
  }
  if (input.loopStats.reviewedWrongQuestionCount > 0) {
    hints.add('保持错题复盘闭环');
  }
  return [...hints].slice(0, 4);
}

export function buildLearningProfile(input: BuildLearningProfileInput): LearningProfile {
  const weakPoints = (input.weakPoints ?? []).slice(0, 5).map(normalizeWeakPoint);
  const speedRisks = (input.speedRisks ?? []).slice(0, 5).map(normalizeWeakPoint);
  const mistakeReasons = sortedEntries(input.mistakeReasons).map(([reason, count]) => ({ reason, count }));
  const weakCount = weakPoints.length;
  const wrongCount = input.loopStats.wrongQuestionCount;
  const learningState: LearningProfileInsight['learningState'] = !input.loopStats.diagnosticCompleted || weakCount >= 3 || wrongCount >= 3
    ? 'risky'
    : input.summary.accuracyRate >= 75 && input.summary.streakDays >= 3 && input.loopStats.reviewedWrongQuestionCount > 0
      ? 'rising'
      : 'stable';

  return {
    userId: input.userId,
    summary: input.summary,
    loopStats: input.loopStats,
    timeline: input.timeline,
    nextMilestone: input.nextMilestone ?? '继续完成推荐题组，并复盘本组错因。',
    insights: {
      learningState,
      stateReason: buildStateReason(input),
      weakPoints,
      speedRisks,
      mistakeReasons,
      focusHints: buildFocusHints(input),
    },
  };
}
