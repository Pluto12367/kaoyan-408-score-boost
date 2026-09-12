import type {
  ConfidenceLevel,
  DiagnosticProfile,
  DailyTask,
  KnowledgePoint,
  MistakeReason,
  PracticeRecord,
  Question,
  StudyPlan,
  StudyStage,
  Subject,
  WeakPoint,
  WeaknessReport,
} from './domain';

const PHASES: Record<StudyStage, string> = {
  基础: '基础补强',
  强化: '专题突破',
  冲刺: '真题冲刺',
};

const MISTAKE_REASONS: MistakeReason[] = [
  '知识点没学过',
  '概念混淆',
  '公式记错',
  '计算错误',
  '审题错误',
  '推理过程错误',
  '时间不足',
  '蒙题',
];

export const MISTAKE_SUGGESTIONS: Record<MistakeReason, string> = {
  知识点没学过: '先回到教材补学该考点，再用基础题确认概念',
  概念混淆: '建立相邻考点对比表，逐项写清区别',
  公式记错: '整理公式卡片，做题前先默写一遍',
  计算错误: '补做限时计算与过程校验，保留草稿步骤',
  审题错误: '训练关键词圈画与条件复述',
  推理过程错误: '回看解题步骤，标出断点后再做同类题',
  时间不足: '加入限时套题和步骤压缩训练',
  蒙题: '重做同知识点基础题，确保不是凭感觉答对',
};

const LEGACY_MISTAKE_REASON_MAP: Record<string, MistakeReason> = {
  概念不清: '概念混淆',
  知识点混淆: '概念混淆',
  审题问题: '审题错误',
  计算失误: '计算错误',
  速度偏慢: '时间不足',
};

export function normalizeMistakeReason(value: string | null | undefined): MistakeReason | null {
  if (!value) return null;
  if ((MISTAKE_REASONS as string[]).includes(value)) return value as MistakeReason;
  return LEGACY_MISTAKE_REASON_MAP[value] ?? null;
}

export function isSlowAnswer(timeSpentSec: number, expectedTimeSec: number): boolean {
  return timeSpentSec > expectedTimeSec * 1.45;
}

export interface TaskProgress {
  completedQuestionCount: number;
  correctCount: number;
  minutesSpent: number;
}

// P1-02: 练习记录按知识点累计到今日任务进度；达到计划题数即视为达标（reachedTarget）。
export function accumulateTaskProgress(input: {
  current: TaskProgress;
  correct: boolean;
  timeSpentSec: number;
  questionTarget: number;
}): { progress: TaskProgress; reachedTarget: boolean } {
  const completedQuestionCount = input.current.completedQuestionCount + 1;
  const correctCount = input.current.correctCount + (input.correct ? 1 : 0);
  const minutesSpent = input.current.minutesSpent + Math.max(1, Math.round(input.timeSpentSec / 60));
  return {
    progress: { completedQuestionCount, correctCount, minutesSpent },
    reachedTarget: completedQuestionCount >= input.questionTarget,
  };
}

export type TaskRebalanceMode = 'reduce' | 'priority_only';

export interface TaskLoadAdjustment {
  id: string;
  questionCount?: number;
  minutes?: number;
  status?: 'postponed';
}

// 阶段2：逾期/超载时按模式调整任务负载。
// reduce：题量与分钟数降为 70%（设下限保证可执行）；priority_only：非高优先级任务延期。
export function rebalanceTaskLoad(input: {
  tasks: Array<{ id: string; priority: string; status: string; questionCount: number; minutes: number }>;
  mode: TaskRebalanceMode;
}): TaskLoadAdjustment[] {
  return input.tasks.map((task) => {
    if (task.status === 'completed') return { id: task.id };
    if (input.mode === 'priority_only') {
      return task.priority === '高'
        ? { id: task.id }
        : { id: task.id, status: 'postponed' as const };
    }
    return {
      id: task.id,
      questionCount: Math.max(5, Math.round(task.questionCount * 0.7)),
      minutes: Math.max(20, Math.round(task.minutes * 0.7)),
    };
  });
}

export function requireQuestionKnowledgePoint<T extends Pick<Question, 'knowledgePointIds'>>(question: T): T {
  if (!question.knowledgePointIds || question.knowledgePointIds.length === 0) {
    throw new Error('题目至少绑定一个知识点');
  }

  return question;
}

export function classifyMistake(input: {
  correct: boolean;
  selectedAnswer?: string;
  correctAnswer: string;
  timeSpentSec: number;
  expectedTimeSec: number;
  confidence?: ConfidenceLevel;
  usedHint?: boolean;
}): MistakeReason | null {
  const slow = isSlowAnswer(input.timeSpentSec, input.expectedTimeSec);
  const tooFast = input.timeSpentSec < input.expectedTimeSec * 0.65;
  const answered = Boolean(input.selectedAnswer?.trim());

  if (input.correct && input.confidence === '完全不会') return '蒙题';
  if (input.correct) return null;
  if (!answered) return '时间不足';
  if (tooFast) return '审题错误';
  if (slow) return '概念混淆';
  if (input.confidence === '完全不会') return '知识点没学过';
  if (input.usedHint) return '推理过程错误';
  return '概念混淆';
}

export function applyDiagnosticProfile(input: {
  targetScore: number;
  currentScore: number;
  remainingDays: number;
  dailyHours: number;
  weakestSubject: Subject;
}): DiagnosticProfile {
  const stage: StudyStage = input.currentScore < 70 ? '基础' : input.remainingDays <= 45 ? '冲刺' : '强化';
  const diagnosis =
    stage === '基础'
      ? `当前分数基础偏弱，建议先补高频基础考点，优先处理${input.weakestSubject}。`
      : stage === '冲刺'
        ? `距离考试较近，建议以真题、错题和限时训练为主，压缩${input.weakestSubject}失分。`
        : `已经具备一定基础，建议围绕${input.weakestSubject}做专题突破和错题回炉。`;

  return {
    ...input,
    stage,
    diagnosis,
  };
}

export function createPracticeRecord(input: {
  userId: string;
  question: Question;
  selectedAnswer?: string;
  timeSpentSec: number;
  submittedAt?: string;
  confidence?: ConfidenceLevel;
  usedHint?: boolean;
  answerModified?: boolean;
}): PracticeRecord {
  const correct = input.selectedAnswer === input.question.answer;
  const mistakeReason = classifyMistake({
    correct,
    selectedAnswer: input.selectedAnswer,
    correctAnswer: input.question.answer,
    timeSpentSec: input.timeSpentSec,
    expectedTimeSec: input.question.expectedTimeSec,
    confidence: input.confidence,
    usedHint: input.usedHint,
  });

  return {
    id: `r-${Date.now()}-${input.question.id}`,
    userId: input.userId,
    questionId: input.question.id,
    knowledgePointId: input.question.knowledgePointIds[0],
    selectedAnswer: input.selectedAnswer,
    correct,
    timeSpentSec: input.timeSpentSec,
    expectedTimeSec: input.question.expectedTimeSec,
    mistakeReason,
    submittedAt: input.submittedAt ?? new Date().toISOString().slice(0, 10),
    confidence: input.confidence,
    usedHint: input.usedHint,
    answerModified: input.answerModified,
    knowledgePointIds: [...input.question.knowledgePointIds],
  };
}

export function computeWeaknessReport(input: {
  knowledgePoints: KnowledgePoint[];
  records: PracticeRecord[];
  targetScore: number;
}): WeaknessReport {
  const model = computeMasteryReport({
    knowledgePoints: input.knowledgePoints,
    records: input.records,
    targetScore: input.targetScore,
  });

  return {
    accuracyRate: model.accuracyRate,
    completionRate: model.completionRate,
    weakPoints: model.weakPoints.map(toWeaknessPoint),
    speedRisks: model.speedRisks.map(toWeaknessPoint),
    mistakeReasons: model.mistakeReasons,
    estimatedGain: model.estimatedGain,
    summary: model.summary,
  };
}

export function buildStudyPlan(input: {
  targetScore: number;
  remainingDays: number;
  dailyHours: number;
  stage: StudyStage;
  knowledgePoints: KnowledgePoint[];
  records: PracticeRecord[];
}): StudyPlan {
  const report = computeWeaknessReport({
    knowledgePoints: input.knowledgePoints,
    records: input.records,
    targetScore: input.targetScore,
  });
  const weakIds = new Set(report.weakPoints.map((point) => point.knowledgePointId));
  const originalOrder = new Map(input.knowledgePoints.map((point, index) => [point.id, index]));
  const minutesPerPoint = Math.max(35, Math.floor((input.dailyHours * 60) / 4));

  const dailyTasks = [...input.knowledgePoints]
    .sort((a, b) => {
      const weakDelta = Number(weakIds.has(b.id)) - Number(weakIds.has(a.id));
      if (weakDelta !== 0) return weakDelta;
      const priorityDelta = b.frequency + b.importance - (a.frequency + a.importance);
      if (priorityDelta !== 0) return priorityDelta;
      return (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
    })
    .slice(0, 4)
    .map((point, index) => enrichDailyTask({
      id: `task-${index + 1}`,
      knowledgePointId: point.id,
      subject: point.subject,
      chapter: point.chapter,
      title: point.title,
      minutes: minutesPerPoint,
      questionCount: input.stage === '冲刺' ? 18 : 12,
      mode: index === 0 ? '诊断复盘' : input.stage === '基础' ? '基础例题' : '专项训练',
    }, weakIds.has(point.id)));

  return {
    phase: PHASES[input.stage],
    targetScore: input.targetScore,
    remainingDays: input.remainingDays,
    dailyHours: input.dailyHours,
    dailyTasks,
    checkpoint: input.remainingDays <= 45 ? '每 3 天完成一套真题回顾' : '每 7 天完成一次阶段测评',
  };
}

/**
 * G1 Release Hardening (owner decision A1, EVIDENCED_REASON-only).
 *
 * This template used to assert "X 是当前最需要优先处理的章节" for whatever landed
 * in position 1. The ordering is legitimate — weak points first, then
 * frequency + importance — but when the student has no practice records the weak
 * set is empty and the position came purely from content statistics. Printing
 * that as the reason presented an exam statistic as a fact about the student,
 * which is exactly what A1 bans.
 *
 * `evidenced` is true only when the weakness report derived from the student's
 * own records puts this point in the weak set. Without it the reason states the
 * absence of evidence and names the actual basis (content statistics) instead of
 * claiming one; the ordering itself is unchanged.
 *
 * The wording is deliberately local: this legacy domain module has no runtime
 * imports by design (its tests load it dependency-free), so it must not reach
 * into `score-center`. The contract is enforced by test/g1-surface-wiring.test.js,
 * which pins this sentence as an insufficiency statement.
 */
const LEGACY_UNEVIDENCED_REASON =
  '当前证据不足：没有足够的作答证据指出优先原因；顺序按考频与重要度排出。';

function enrichDailyTask(
  task: Omit<DailyTask, 'priority' | 'reason' | 'nextAction'>,
  evidenced: boolean,
): DailyTask {
  const isFirstTask = task.id === 'task-1';
  const priority: DailyTask['priority'] = isFirstTask ? '高' : task.questionCount >= 18 ? '中' : '低';

  return {
    ...task,
    priority,
    reason: evidenced
      ? isFirstTask
        ? `你在「${task.title}」上的练习记录显示它当前薄弱，从它开始。`
        : `你在「${task.title}」上的练习记录显示它还需要补强，适合用限时练习稳定得分。`
      : LEGACY_UNEVIDENCED_REASON,
    nextAction: isFirstTask
      ? `完成后复盘 ${task.title} 的错题原因，并补 1 组同考点题。`
      : `完成后用 5 分钟整理 ${task.title} 的关键规则。`,
  };
}

function topReason(reasons: MistakeReason[]): MistakeReason | null {
  return Object.entries(countStrings(reasons)).sort((a, b) => b[1] - a[1])[0]?.[0] as MistakeReason | undefined ?? null;
}

function countReasons(records: PracticeRecord[]): Record<string, number> {
  return countStrings(records.map((record) => record.mistakeReason).filter(Boolean) as string[]);
}

function countStrings(items: string[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1;
    return acc;
  }, {});
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface SessionGradingAnswer {
  selectedAnswer: string;
  timeSpentSec: number;
  selfScore?: number;
  maxScore?: number;
  confidence?: ConfidenceLevel;
  usedHint?: boolean;
  answerModified?: boolean;
}

export interface SessionGradingQuestion {
  id: string;
  answer: string;
  subjective?: boolean;
  expectedTimeSec?: number;
}

export function gradePracticeSessionAnswers(input: {
  questions: SessionGradingQuestion[];
  answers: Record<string, SessionGradingAnswer>;
}) {
  const records = input.questions.map((question) => {
    const answer = input.answers[question.id];
    const selectedAnswer = answer?.selectedAnswer.trim() ?? '';
    const maxScore = answer?.maxScore ?? 0;
    const selfScore = answer?.selfScore ?? 0;
    const correct = question.subjective
      ? selectedAnswer.length > 0 && maxScore > 0 && selfScore / maxScore >= 0.6
      : selectedAnswer.length > 0 && selectedAnswer === question.answer;
    const mistakeReason = selectedAnswer.length > 0 && question.expectedTimeSec !== undefined
      ? classifyMistake({
          correct,
          selectedAnswer,
          correctAnswer: question.answer,
          timeSpentSec: answer?.timeSpentSec ?? 0,
          expectedTimeSec: question.expectedTimeSec,
          confidence: answer?.confidence,
          usedHint: answer?.usedHint,
        })
      : null;

    return {
      questionId: question.id,
      correct,
      mistakeReason,
      timeSpentSec: answer?.timeSpentSec ?? 0,
      gradingMode: question.subjective ? 'self_scored' : 'automatic',
      selfScore: answer?.selfScore,
      maxScore: answer?.maxScore,
      confidence: answer?.confidence,
      usedHint: answer?.usedHint,
      answerModified: answer?.answerModified,
    };
  });
  const correctCount = records.filter((record) => record.correct).length;

  return {
    records,
    correctCount,
    accuracyRate: records.length === 0 ? 0 : round1((correctCount / records.length) * 100),
  };
}

export function recommendPracticeSet(input: {
  stage: StudyStage;
  report: WeaknessReport;
}): { title: string; knowledgePointIds: string[]; questionCount: number; focus: string } {
  if (input.stage === '冲刺') {
    return {
      title: '真题错题回炉训练',
      knowledgePointIds: input.report.weakPoints.map((point) => point.knowledgePointId),
      questionCount: 20,
      focus: '近十年真题、错题重做、限时复盘',
    };
  }

  return {
    title: input.report.accuracyRate < 55 ? '高频基础考点补强' : '薄弱专题突破',
    knowledgePointIds: input.report.weakPoints.map((point) => point.knowledgePointId),
    questionCount: input.report.accuracyRate < 55 ? 16 : 12,
    focus: input.report.accuracyRate < 55 ? '例题理解、概念复述、基础题组' : '相似考点辨析、变式题组',
  };
}

export function dedupeQuestionsByStem<T extends { id: string; stem: string }>(questions: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const question of questions) {
    const key = question.stem.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(question);
  }
  return result;
}

export function createTeacherQuestion(input: {
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
  existingCount?: number;
}): Question {
  const question = requireQuestionKnowledgePoint({
    id: `q-${String((input.existingCount ?? 0) + 1).padStart(3, '0')}`,
    stem: input.stem.trim(),
    options: input.options.map((o) => o.trim()).filter(Boolean),
    answer: input.answer,
    analysis: input.analysis.trim(),
    knowledgePointIds: input.knowledgePointIds,
    difficulty: input.difficulty as Question['difficulty'],
    type: input.type as Question['type'],
    source: input.source,
    year: input.year ? Number(input.year) : undefined,
    expectedTimeSec: input.expectedTimeSec ?? 100,
  });

  if (question.options.length < 2) {
    throw new Error('选择题至少需要两个选项');
  }

  return question;
}

export function generateTutorReply(input: {
  question: Pick<Question, 'stem' | 'analysis' | 'answer' | 'knowledgePointIds'>;
  knowledgePoints: KnowledgePoint[];
  selectedAnswer?: string;
}): string {
  const point = input.knowledgePoints.find((k) => k.id === input.question.knowledgePointIds[0]);
  const answerLine = input.selectedAnswer
    ? `你选择的是 ${input.selectedAnswer}，正确答案是 ${input.question.answer}。`
    : `正确答案是 ${input.question.answer}。`;

  return [
    `这道题对应考点是「${point?.title ?? '408 高频考点'}」。`,
    answerLine,
    `解析：${input.question.analysis}`,
    `复习建议：先复述${point?.chapter ?? '本章'}的核心定义，再做 3 道相似题确认是否真正掌握。`,
    '相似题：建议继续练习同章节的真题改编题，并记录错因。',
  ].join('\n');
}

// ---- Wrong-question mastery, filtering and review intervals (Stage 4) ----

export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14] as const;

export type WrongQuestionMasteryStatus = '未掌握' | '复习中' | '已掌握';

export function nextReviewIntervalDays(input: {
  consecutiveCorrect: number;
  slowReview?: boolean;
}): number {
  if (input.consecutiveCorrect <= 0) return 1;
  const index = Math.min(input.consecutiveCorrect, REVIEW_INTERVAL_DAYS.length - 1);
  if (input.slowReview) return REVIEW_INTERVAL_DAYS[Math.max(0, index - 1)];
  return REVIEW_INTERVAL_DAYS[index];
}

export function deriveMasteryStatus(input: {
  stability?: string | null;
  consecutiveCorrect?: number;
}): WrongQuestionMasteryStatus {
  if (input.stability === 'mastered') return '已掌握';
  if (input.stability === 'review' || (input.consecutiveCorrect ?? 0) >= 1) return '复习中';
  return '未掌握';
}

export interface WrongQuestionFilterItem {
  subject: string;
  chapter: string;
  knowledgePointId: string;
  latestMistakeReason?: string | null;
  wrongCount: number;
  masteryStatus: WrongQuestionMasteryStatus;
  reviewedAt?: string | null;
  importance?: number;
}

export interface WrongQuestionFilter {
  subject?: string;
  chapter?: string;
  knowledgePointId?: string;
  mistakeReason?: string;
  minWrongCount?: number;
  masteryStatus?: WrongQuestionMasteryStatus;
  reviewedWithinDays?: number;
  importance?: number;
}

export function filterWrongQuestions<T extends WrongQuestionFilterItem>(
  items: T[],
  filter: WrongQuestionFilter = {},
  now: number = Date.now(),
): T[] {
  const reviewedCutoff = filter.reviewedWithinDays == null
    ? null
    : now - filter.reviewedWithinDays * 86_400_000;
  return items.filter((item) => {
    if (filter.subject && item.subject !== filter.subject) return false;
    if (filter.chapter && item.chapter !== filter.chapter) return false;
    if (filter.knowledgePointId && item.knowledgePointId !== filter.knowledgePointId) return false;
    if (filter.mistakeReason && item.latestMistakeReason !== filter.mistakeReason) return false;
    if (filter.minWrongCount != null && item.wrongCount < filter.minWrongCount) return false;
    if (filter.masteryStatus && item.masteryStatus !== filter.masteryStatus) return false;
    if (filter.importance != null && (item.importance ?? 0) < filter.importance) return false;
    if (reviewedCutoff != null) {
      if (!item.reviewedAt) return false;
      if (Date.parse(item.reviewedAt) < reviewedCutoff) return false;
    }
    return true;
  });
}
// ---- Unified mastery model and predicted score (Stage 5) ----

export type MasteryStatus = 'weak' | 'review' | 'mastered';

export interface MasteryPointMetrics {
  knowledgePointId: string;
  subject: Subject | '未分类';
  chapter: string;
  title: string;
  importance: number;
  frequency: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  slowCount: number;
  accuracyRate: number;
  masteryRate: number;
  status: MasteryStatus;
  weaknessScore: number;
  topReason: MistakeReason | null;
  suggestion: string;
  nextAction: string;
}

export interface MasteryPointExtras {
  practiceCount?: number;
  correctCount?: number;
  wrongCount?: number;
}

export interface UnifiedMasteryReport {
  accuracyRate: number;
  completionRate: number;
  points: MasteryPointMetrics[];
  weakPoints: MasteryPointMetrics[];
  speedRisks: MasteryPointMetrics[];
  mistakeReasons: Record<string, number>;
  estimatedGain: number;
  summary: string;
}

export function computeMasteryReport(input: {
  knowledgePoints: KnowledgePoint[];
  records: PracticeRecord[];
  targetScore: number;
  extrasByPoint?: ReadonlyMap<string, MasteryPointExtras>;
}): UnifiedMasteryReport {
  const grouped = new Map<string, PracticeRecord[]>();
  for (const record of input.records) {
    // P2-4: multi-knowledge-point records count toward every related point.
    const pointIds = record.knowledgePointIds?.length
      ? record.knowledgePointIds
      : [record.knowledgePointId];
    for (const pointId of pointIds) {
      const bucket = grouped.get(pointId) ?? [];
      bucket.push(record);
      grouped.set(pointId, bucket);
    }
  }

  const catalogIds = new Set(input.knowledgePoints.map((point) => point.id));
  const unknownGroups = [...grouped.entries()]
    .filter(([id]) => !catalogIds.has(id))
    .map(([id, items]) => ({
      id,
      point: {
        subject: '未分类' as Subject,
        chapter: '未分类',
        title: id,
        importance: 3,
        frequency: 3,
      },
      items,
    }));

  const allGroups: Array<{
    id: string;
    point: Pick<KnowledgePoint, 'subject' | 'chapter' | 'title' | 'importance' | 'frequency'>;
    items: PracticeRecord[];
  }> = [
    ...input.knowledgePoints.map((point) => ({ id: point.id, point, items: grouped.get(point.id) ?? [] })),
    ...unknownGroups,
  ];

  const correctCount = input.records.filter((record) => record.correct).length;
  const accuracyRate = input.records.length ? round1((correctCount / input.records.length) * 100) : 0;

  const points = allGroups.map(({ id, point, items }) => {
    const extras = input.extrasByPoint?.get(id) ?? {};
    const recordCorrect = items.filter((item) => item.correct).length;
    const recordWrong = items.length - recordCorrect;
    const attempts = items.length + (extras.practiceCount ?? 0);
    const totalCorrect = recordCorrect + (extras.correctCount ?? 0);
    const totalWrong = recordWrong + (extras.wrongCount ?? 0);
    const slowCount = items.filter((item) => isSlowAnswer(item.timeSpentSec, item.expectedTimeSec)).length;
    const rawAccuracy = attempts ? (totalCorrect / attempts) * 100 : 0;
    const practiceCoverage = Math.min(100, attempts * 25);
    const masteryRate = attempts
      ? Math.round(Math.round(rawAccuracy) * 0.7 + practiceCoverage * 0.3)
      : Math.max(10, Math.round((point.frequency + point.importance) * 6));
    const status: MasteryStatus = masteryRate < 60 || totalWrong >= 2
      ? 'weak'
      : masteryRate < 80 || attempts < 3
        ? 'review'
        : 'mastered';
    const wrongRate = attempts ? totalWrong / attempts : 1;
    const weaknessScore = wrongRate * 100 + (point.importance ?? 3) * 8 + (point.frequency ?? 3) * 6;
    const wrongItems = items.filter((item) => !item.correct);
    const reason = topReason(wrongItems.map((item) => item.mistakeReason).filter(Boolean) as MistakeReason[]);

    return {
      knowledgePointId: id,
      subject: point.subject,
      chapter: point.chapter,
      title: point.title,
      importance: point.importance,
      frequency: point.frequency,
      attempts,
      correctCount: totalCorrect,
      wrongCount: totalWrong,
      slowCount,
      accuracyRate: round1(rawAccuracy),
      masteryRate,
      status,
      weaknessScore,
      topReason: reason,
      suggestion: reason ? MISTAKE_SUGGESTIONS[reason] : '补做同源题并复述解题步骤',
      nextAction: status === 'weak'
        ? '先复盘错题，再做 5 道同考点基础题。'
        : status === 'review'
          ? '补 3 道变式题，并记录易混点。'
          : '进入限时训练，保持速度和稳定性。',
    };
  });

  const weakPoints = points
    .filter((item) => item.wrongCount > 0)
    .sort((left, right) => right.weaknessScore - left.weaknessScore)
    .slice(0, 5);

  const speedRisks = points
    .filter((item) => item.wrongCount === 0 && item.slowCount > 0)
    .sort((left, right) => right.slowCount - left.slowCount);

  const estimatedGain = Math.max(8, Math.round((100 - accuracyRate) * 0.45 + Math.max(input.targetScore - 95, 0) * 0.18));

  return {
    accuracyRate,
    completionRate: input.records.length ? Math.min(100, Math.round((input.records.length / 20) * 100)) : 0,
    points,
    weakPoints,
    speedRisks,
    mistakeReasons: countReasons(input.records),
    estimatedGain,
    // V8 #57: name the weak POINT (title), not its chapter — the report and
    // home pages already name points; a chapter name read as a different
    // "most important thing" (audit P7).
    summary: `当前正确率 ${accuracyRate}%，预计提分空间 ${estimatedGain} 分；优先处理 ${weakPoints[0]?.title ?? weakPoints[0]?.chapter ?? '高频章节'}。`,
  };
}

function toWeaknessPoint(point: MasteryPointMetrics): WeakPoint {
  return {
    knowledgePointId: point.knowledgePointId,
    subject: point.subject,
    chapter: point.chapter,
    title: point.title,
    attempts: point.attempts,
    wrongCount: point.wrongCount,
    slowCount: point.slowCount,
    accuracyRate: point.accuracyRate,
    topReason: point.topReason,
    suggestion: point.suggestion,
    weaknessScore: point.weaknessScore,
  };
}

export interface PredictedScoreEstimate {
  minScore: number;
  maxScore: number;
  bestEstimate: number;
  disclaimer: '仅为估算';
  basis: string;
}

export function estimatePredictedScore(input: {
  currentScore: number;
  targetScore: number;
  accuracyRate: number;
  averageMastery: number;
  remainingDays: number;
  scoreTrend?: number;
}): PredictedScoreEstimate {
  const accuracy = clamp01(input.accuracyRate / 100);
  const mastery = clamp01(input.averageMastery / 100);
  const timeFactor = clamp01(input.remainingDays / 240);
  const progress = Math.min(1, mastery * 0.5 + accuracy * 0.3 + timeFactor * 0.2);
  const rawGain = (input.targetScore - input.currentScore) * progress * 0.5;
  const trendBoost = input.scoreTrend == null ? 0 : clampNumberValue(Math.round(input.scoreTrend * 0.4), -6, 6);
  const bestEstimate = clampNumberValue(Math.round(input.currentScore + rawGain + trendBoost), 0, 150);
  const halfRange = Math.max(5, Math.round((1 - progress) * 14));

  return {
    minScore: Math.max(0, bestEstimate - halfRange),
    maxScore: Math.min(150, bestEstimate + halfRange),
    bestEstimate,
    disclaimer: '仅为估算',
    basis: `基于当前正确率 ${input.accuracyRate}%、平均掌握度 ${input.averageMastery}% 与剩余 ${input.remainingDays} 天估算`,
  };
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function clampNumberValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
