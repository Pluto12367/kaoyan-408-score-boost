export type StageReportVerdict = 'improved' | 'declined' | 'steady' | 'insufficient';

export interface StageReportPracticeRecord {
  submittedAt: string;
  correct: boolean;
  knowledgePointId: string;
  timeSpentSec: number;
  expectedTimeSec: number;
}

export interface StageReportAssessment {
  submittedAt: string;
  score: number;
  accuracyRate: number;
  weakPointTitle?: string;
}

export interface StageReportMasteryPoint {
  knowledgePointId: string;
  title: string;
  subject: string;
  masteryRate: number;
  status: 'weak' | 'review' | 'mastered';
}

export interface StageReportWrongSummary {
  pendingCount: number;
  reviewedCount: number;
  resolvedCount: number;
  totalWrongCount: number;
}

export interface StageWindowStats {
  answeredCount: number;
  correctCount: number;
  accuracyRate: number | null;
  activeDays: number;
}

export interface StageReport {
  windowDays: number;
  current: StageWindowStats;
  previous: StageWindowStats;
  accuracyDelta: number | null;
  answeredDelta: number;
  activeDayDelta: number;
  assessmentTrend: {
    latestScore: number | null;
    previousScore: number | null;
    delta: number | null;
    latestDate: string | null;
  };
  mastery: {
    masteredCount: number;
    reviewCount: number;
    weakCount: number;
    weakestPoints: StageReportMasteryPoint[];
  };
  wrong: {
    pendingCount: number;
    reviewedCount: number;
    resolvedCount: number;
    resolvedRate: number | null;
  };
  streakDays: number;
  verdict: StageReportVerdict;
  summary: string;
  nextAction: string;
}

export interface StageReportInput {
  records: StageReportPracticeRecord[];
  assessments: StageReportAssessment[];
  masteryPoints: StageReportMasteryPoint[];
  wrongSummary: StageReportWrongSummary;
  streakDays: number;
  windowDays?: number;
  timeZone?: string;
  asOf?: string;
}

export function computeStageReport(input: StageReportInput): StageReport {
  const windowDays = Math.max(1, Math.min(90, Math.round(input.windowDays ?? 7)));
  const timeZone = input.timeZone ?? 'Asia/Shanghai';
  const today = input.asOf
    ? studyDateKey(new Date(`${input.asOf}T00:00:00.000Z`), timeZone)
    : studyDateKey(new Date(), timeZone);
  const currentStart = dateOffset(today, -(windowDays - 1));
  const previousStart = dateOffset(today, -(windowDays * 2 - 1));
  const previousEnd = dateOffset(today, -windowDays);

  const current = bucketStats(input.records, currentStart, today, timeZone);
  const previous = bucketStats(input.records, previousStart, previousEnd, timeZone);
  const accuracyDelta = current.accuracyRate !== null && previous.accuracyRate !== null
    ? Math.round((current.accuracyRate - previous.accuracyRate) * 10) / 10
    : null;

  const sortedAssessments = [...input.assessments].sort((left, right) => left.submittedAt.localeCompare(right.submittedAt));
  const latestAssessment = sortedAssessments.at(-1) ?? null;
  const previousAssessment = sortedAssessments.at(-2) ?? null;
  const assessmentDelta = latestAssessment && previousAssessment
    ? latestAssessment.score - previousAssessment.score
    : null;

  const masteryPoints = input.masteryPoints ?? [];
  const masteredCount = masteryPoints.filter((point) => point.status === 'mastered').length;
  const reviewCount = masteryPoints.filter((point) => point.status === 'review').length;
  const weakCount = masteryPoints.filter((point) => point.status === 'weak').length;
  const weakestPoints = [...masteryPoints].sort((left, right) => left.masteryRate - right.masteryRate).slice(0, 3);

  const pendingCount = input.wrongSummary?.pendingCount ?? 0;
  const reviewedCount = input.wrongSummary?.reviewedCount ?? 0;
  const resolvedCount = input.wrongSummary?.resolvedCount ?? 0;
  const resolvedRate = resolvedCount + pendingCount > 0
    ? Math.round((resolvedCount / (resolvedCount + pendingCount)) * 100)
    : null;

  let verdict: StageReportVerdict;
  if (accuracyDelta !== null) {
    verdict = accuracyDelta >= 3 ? 'improved' : accuracyDelta <= -3 ? 'declined' : 'steady';
  } else if (assessmentDelta !== null) {
    verdict = assessmentDelta > 0 ? 'improved' : assessmentDelta < 0 ? 'declined' : 'steady';
  } else {
    verdict = 'insufficient';
  }

  const deltaText = accuracyDelta === null
    ? ''
    : `，较上一阶段 ${accuracyDelta >= 0 ? '+' : ''}${accuracyDelta} 个百分点`;
  const summary = [
    `本阶段共答 ${current.answeredCount} 题，正确率 ${current.accuracyRate ?? '--'}%${deltaText}`,
    `连续学习 ${input.streakDays} 天`,
    pendingCount > 0 ? `还有 ${pendingCount} 道错题待复盘` : '错题待复盘已清空',
    verdict === 'insufficient' && current.answeredCount > 0 && previous.answeredCount === 0
      ? '本阶段已建立学习基线'
      : verdict === 'insufficient' && current.answeredCount === 0
        ? '本阶段暂无答题记录'
        : '',
  ].filter(Boolean).join('；');

  const nextAction = weakCount > 0 && weakestPoints[0]
    ? `优先补强 ${weakestPoints[0].title}，再完成一组同考点练习。`
    : pendingCount > 0
      ? `先复盘 ${pendingCount} 道待处理错题，再进入新题练习。`
      : current.answeredCount === 0
        ? '先完成一组今日推荐练习，建立本阶段数据。'
        : '保持当前节奏，进入限时整卷训练巩固。';

  return {
    windowDays,
    current,
    previous,
    accuracyDelta,
    answeredDelta: current.answeredCount - previous.answeredCount,
    activeDayDelta: current.activeDays - previous.activeDays,
    assessmentTrend: {
      latestScore: latestAssessment?.score ?? null,
      previousScore: previousAssessment?.score ?? null,
      delta: assessmentDelta,
      latestDate: latestAssessment?.submittedAt ?? null,
    },
    mastery: {
      masteredCount,
      reviewCount,
      weakCount,
      weakestPoints,
    },
    wrong: {
      pendingCount,
      reviewedCount,
      resolvedCount,
      resolvedRate,
    },
    streakDays: input.streakDays,
    verdict,
    summary,
    nextAction,
  };
}

function bucketStats(
  records: StageReportPracticeRecord[],
  start: string,
  end: string,
  timeZone: string,
): StageWindowStats {
  const counts = new Map<string, { correct: number; total: number }>();
  for (const record of records) {
    const date = studyDateKey(record.submittedAt, timeZone);
    if (date < start || date > end) continue;
    const bucket = counts.get(date) ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (record.correct) bucket.correct += 1;
    counts.set(date, bucket);
  }
  const answeredCount = [...counts.values()].reduce((sum, bucket) => sum + bucket.total, 0);
  const correctCount = [...counts.values()].reduce((sum, bucket) => sum + bucket.correct, 0);
  return {
    answeredCount,
    correctCount,
    accuracyRate: answeredCount ? Math.round((correctCount / answeredCount) * 100) : null,
    activeDays: counts.size,
  };
}

function dateOffset(date: string, offsetDays: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function studyDateKey(value: string | Date, timeZone: string) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Unable to determine the study date');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('Unable to determine the study date');
  return `${year}-${month}-${day}`;
}
