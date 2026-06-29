import type {
  DiagnosticProfile,
  KnowledgePoint,
  MistakeReason,
  PracticeRecord,
  Question,
  StudyPlan,
  StudyStage,
  Subject,
  WeaknessReport,
} from './domain';

const PHASES: Record<StudyStage, string> = {
  基础: '基础补强',
  强化: '专题突破',
  冲刺: '真题冲刺',
};

const MISTAKE_SUGGESTIONS: Record<MistakeReason, string> = {
  概念不清: '强化概念辨析与映射过程',
  知识点混淆: '建立相邻考点对比表',
  审题问题: '训练关键词圈画与条件复述',
  计算失误: '补做限时计算与过程校验',
  速度偏慢: '加入限时套题和步骤压缩训练',
};

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
}): MistakeReason | null {
  const slow = input.timeSpentSec > input.expectedTimeSec * 1.45;

  if (input.correct && slow) return '速度偏慢';
  if (input.correct) return null;
  if (!input.selectedAnswer || input.timeSpentSec < input.expectedTimeSec * 0.65) return '审题问题';
  if (input.selectedAnswer !== input.correctAnswer && slow) return '概念不清';
  return '知识点混淆';
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
}): PracticeRecord {
  const correct = input.selectedAnswer === input.question.answer;
  const mistakeReason = classifyMistake({
    correct,
    selectedAnswer: input.selectedAnswer,
    correctAnswer: input.question.answer,
    timeSpentSec: input.timeSpentSec,
    expectedTimeSec: input.question.expectedTimeSec,
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
  };
}

export function computeWeaknessReport(input: {
  knowledgePoints: KnowledgePoint[];
  records: PracticeRecord[];
  targetScore: number;
}): WeaknessReport {
  const pointMap = new Map(input.knowledgePoints.map((point) => [point.id, point]));
  const grouped = new Map<string, PracticeRecord[]>();

  for (const record of input.records) {
    const bucket = grouped.get(record.knowledgePointId) ?? [];
    bucket.push(record);
    grouped.set(record.knowledgePointId, bucket);
  }

  const correctCount = input.records.filter((record) => record.correct).length;
  const accuracyRate = input.records.length ? round1((correctCount / input.records.length) * 100) : 0;

  const scored = [...grouped.entries()].map(([knowledgePointId, items]) => {
    const point = pointMap.get(knowledgePointId);
    const wrongItems = items.filter((item) => !item.correct);
    const slowItems = items.filter((item) => item.timeSpentSec > item.expectedTimeSec * 1.45);
    const wrongRate = items.length ? wrongItems.length / items.length : 1;
    const reason = topReason(wrongItems.map((item) => item.mistakeReason).filter(Boolean) as MistakeReason[]);
    const weaknessScore = wrongRate * 100 + (point?.importance ?? 3) * 8 + (point?.frequency ?? 3) * 6;

    return {
      knowledgePointId,
      subject: point?.subject ?? ('未分类' as const),
      chapter: point?.chapter ?? '未分类',
      title: point?.title ?? knowledgePointId,
      attempts: items.length,
      wrongCount: wrongItems.length,
      slowCount: slowItems.length,
      accuracyRate: round1(((items.length - wrongItems.length) / items.length) * 100),
      topReason: reason,
      suggestion: reason ? MISTAKE_SUGGESTIONS[reason] : '补做同源题并复述解题步骤',
      weaknessScore,
    };
  });

  const weakPoints = scored
    .filter((item) => item.wrongCount > 0)
    .sort((a, b) => b.weaknessScore - a.weaknessScore)
    .slice(0, 5);

  const speedRisks = scored
    .filter((item) => item.wrongCount === 0 && item.slowCount > 0)
    .sort((a, b) => b.slowCount - a.slowCount);

  const estimatedGain = Math.max(8, Math.round((100 - accuracyRate) * 0.45 + Math.max(input.targetScore - 95, 0) * 0.18));

  return {
    accuracyRate,
    completionRate: input.records.length ? Math.min(100, Math.round((input.records.length / 20) * 100)) : 0,
    weakPoints,
    speedRisks,
    mistakeReasons: countReasons(input.records),
    estimatedGain,
    summary: `当前正确率 ${accuracyRate}%，预计提分空间 ${estimatedGain} 分；优先处理 ${weakPoints[0]?.chapter ?? '高频章节'}。`,
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
    .map((point, index) => ({
      id: `task-${index + 1}`,
      knowledgePointId: point.id,
      subject: point.subject,
      chapter: point.chapter,
      title: point.title,
      minutes: minutesPerPoint,
      questionCount: input.stage === '冲刺' ? 18 : 12,
      mode: index === 0 ? '诊断复盘' : input.stage === '基础' ? '基础例题' : '专项训练',
    }));

  return {
    phase: PHASES[input.stage],
    targetScore: input.targetScore,
    remainingDays: input.remainingDays,
    dailyHours: input.dailyHours,
    dailyTasks,
    checkpoint: input.remainingDays <= 45 ? '每 3 天完成一套真题回顾' : '每 7 天完成一次阶段测评',
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
