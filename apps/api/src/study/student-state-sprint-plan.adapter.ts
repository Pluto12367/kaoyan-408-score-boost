import { nextNDates } from './study-date';
import type { StudentStateSnapshot } from './student-state.snapshot';

export interface SprintPlanDayDto {
  dayIndex: number;
  date: string;
  focus: string;
  minutes: number;
  questionTarget: number;
  reviewTarget: number;
  reason: string;
}

export interface SprintPlanDto {
  userId: string;
  title: string;
  currentStage?: string | null;
  scoreGap: number;
  targetScore?: number | null;
  currentScore?: number | null;
  remainingDays?: number | null;
  weeklyQuestionTarget: number;
  weeklyReviewTarget: number;
  risks: string[];
  generatedAt: string;
  days: SprintPlanDayDto[];
}

export interface SprintPlanSupplementalContext {
  generatedAt?: Date | string;
  dates?: string[];
  planTasks?: SprintPlanTaskFocus[];
  dailyTargetQuestionCount: number;
  todayPracticeCount: number;
  accuracyRate?: number | null;
}

export interface SprintPlanTaskFocus {
  title: string;
}

export interface BuildSprintPlanInput extends SprintPlanSupplementalContext {
  snapshot: StudentStateSnapshot;
}

export function buildSprintPlanDto(input: BuildSprintPlanInput): SprintPlanDto {
  const { snapshot } = input;
  const { goal } = snapshot;
  const scoreGap = Math.max(0, (goal.targetScore ?? 0) - (goal.currentScore ?? 0));
  const weakPointTitles = snapshot.weakPoints.map((point) => point.title).slice(0, 4);
  const fallbackTasks = input.planTasks?.length ? input.planTasks : snapshot.studyTasks.today;
  const fallbackFocus = fallbackTasks.map((task) => task.title).slice(0, 3);
  const focusPool = weakPointTitles.length ? weakPointTitles : fallbackFocus;
  const baseQuestionTarget = clampNumber(
    input.dailyTargetQuestionCount,
    10,
    goal.stage === '冲刺' ? 80 : 60,
  );
  const wrongQuestionCount = snapshot.wrongQuestionSummary.unresolved;
  const reviewBase = wrongQuestionCount > 0 ? Math.min(6, wrongQuestionCount + 1) : 1;
  const minutes = Math.max(45, Math.round((goal.dailyHours ?? 3) * 60));

  const days = (input.dates ?? nextNDates(7)).slice(0, 7).map((date, index) => {
    const focus = focusPool[index % Math.max(1, focusPool.length)] ?? '408 高频基础考点';
    const isReviewDay = index % 3 === 2;
    const isAssessmentDay = index === 6;
    const questionTarget = Math.max(
      8,
      baseQuestionTarget - (isReviewDay ? 8 : 0) + (isAssessmentDay ? 10 : 0),
    );
    const reviewTarget = isAssessmentDay ? reviewBase + 2 : isReviewDay ? reviewBase + 1 : reviewBase;

    return {
      dayIndex: index + 1,
      date,
      focus: isAssessmentDay ? '阶段小测与错题回看' : focus,
      minutes,
      questionTarget,
      reviewTarget,
      reason: buildDayReason(focus, isReviewDay, isAssessmentDay),
    };
  });

  return {
    userId: snapshot.userId,
    title: '7 天冲刺计划',
    currentStage: goal.stage,
    scoreGap,
    targetScore: goal.targetScore,
    currentScore: goal.currentScore,
    remainingDays: goal.remainingDays,
    weeklyQuestionTarget: days.reduce((sum, day) => sum + day.questionTarget, 0),
    weeklyReviewTarget: days.reduce((sum, day) => sum + day.reviewTarget, 0),
    risks: buildRisks({
      remainingDays: goal.remainingDays,
      wrongQuestionCount,
      reviewBase,
      accuracyRate: input.accuracyRate,
      todayPracticeCount: input.todayPracticeCount,
    }),
    days,
    generatedAt: toIso(input.generatedAt ?? new Date()),
  };
}

function buildDayReason(focus: string, isReviewDay: boolean, isAssessmentDay: boolean): string {
  if (isAssessmentDay) return '第 7 天用小测校验本周补弱效果，并回看仍未稳定的错题。';
  if (isReviewDay) return '每 3 天安排一次错题回看，避免只刷题不消化。';
  return `围绕 ${focus} 做短周期补强，和当前薄弱点保持一致。`;
}

function buildRisks(input: {
  remainingDays: number | null;
  wrongQuestionCount: number;
  reviewBase: number;
  accuracyRate?: number | null;
  todayPracticeCount: number;
}): string[] {
  const risks = [
    ...((input.remainingDays ?? 0) < 60 ? ['剩余时间偏紧，需要优先保证高频考点和真题回看。'] : []),
    ...(input.wrongQuestionCount > 0
      ? [`错题本仍有 ${input.wrongQuestionCount} 道待处理，建议每天至少复盘 ${input.reviewBase} 道。`]
      : []),
    ...(input.accuracyRate != null && input.accuracyRate < 60
      ? [`当前正确率 ${input.accuracyRate}%，本周先稳住基础题正确率。`]
      : []),
    ...(input.todayPracticeCount === 0 ? ['今天还没有练习记录，建议先完成一组短题。'] : []),
  ];

  return risks.length ? risks : ['当前节奏稳定，本周重点保持练习连续性和错题复盘质量。'];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
