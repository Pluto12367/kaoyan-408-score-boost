import { studyDateKey } from './study-date';
import type { ExamScoreHistorySnapshot } from './exam-score-history.snapshot';

export interface LegacyExamScoreHistoryItemDto {
  sessionId: string;
  date: string;
  totalQuestions: number;
  correctCount: number;
  accuracyRate: number;
  totalTimeMin: number;
}

export interface LegacyExamScoreHistoryDto {
  userId: string;
  totalExams: number;
  latestAccuracyRate: number;
  trend: number;
  trendLabel: string;
  history: LegacyExamScoreHistoryItemDto[];
}

export function toLegacyExamScoreHistory(snapshot: ExamScoreHistorySnapshot): LegacyExamScoreHistoryDto {
  const history = snapshot.exams
    .map((exam) => ({
      sessionId: exam.sessionId,
      date: studyDateKey(exam.lastActiveAt),
      totalQuestions: exam.totalQuestions,
      correctCount: exam.correctCount,
      accuracyRate: exam.totalQuestions ? Math.round((exam.correctCount / exam.totalQuestions) * 100) : 0,
      totalTimeMin: Math.round(exam.totalActiveMs / 60000),
    }))
    .sort((left, right) => left.date.localeCompare(right.date) || left.sessionId.localeCompare(right.sessionId));

  const latest = history.at(-1);
  const previous = history.at(-2);
  const trend = latest && previous ? latest.accuracyRate - previous.accuracyRate : 0;

  return {
    userId: snapshot.userId,
    totalExams: history.length,
    latestAccuracyRate: latest?.accuracyRate ?? 0,
    trend,
    trendLabel: buildTrendLabel(trend),
    history,
  };
}

function buildTrendLabel(trend: number): string {
  if (trend > 0) return `较上次提升 ${trend} 分`;
  if (trend < 0) return `较上次下降 ${Math.abs(trend)} 分`;
  return '与上次持平';
}
