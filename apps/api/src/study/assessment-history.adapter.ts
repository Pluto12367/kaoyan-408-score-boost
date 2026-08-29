import type { AssessmentHistorySnapshot } from './assessment-history.snapshot';

export interface LegacyAssessmentHistoryItemDto {
  id: string;
  sessionId?: string | null;
  paperId?: string | null;
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

export interface LegacyAssessmentHistoryDto {
  userId: string;
  items: LegacyAssessmentHistoryItemDto[];
  summary: {
    attemptCount: number;
    bestScore: number;
    latestAccuracyRate: number;
    improvementText: string;
  };
}

export function toLegacyAssessmentHistory(snapshot: AssessmentHistorySnapshot): LegacyAssessmentHistoryDto {
  const items = snapshot.items.map((item) => ({ ...item }));
  const latest = items[0];
  const previous = items[1];

  return {
    userId: snapshot.userId,
    items,
    summary: {
      attemptCount: snapshot.summaryFacts.attemptCount,
      bestScore: snapshot.summaryFacts.bestScore,
      latestAccuracyRate: snapshot.summaryFacts.latestAccuracyRate,
      improvementText: snapshot.summaryFacts.improvementText || buildImprovementText(latest, previous),
    },
  };
}

function buildImprovementText(
  latest?: LegacyAssessmentHistoryItemDto,
  previous?: LegacyAssessmentHistoryItemDto,
): string {
  if (!latest) return '还没有测评记录，先完成一套模拟卷建立基线。';
  if (!previous) return '已建立第一次测评基线，下一次可重点观察正确率和用时变化。';
  if (latest.score > previous.score) return `较上次提升 ${latest.score - previous.score} 分，继续巩固本次薄弱点。`;
  if (latest.score === previous.score) return '与上次持平，建议通过限时训练和错题复盘提高稳定性。';
  return `较上次下降 ${previous.score - latest.score} 分，先复盘本次错题再进入新题训练。`;
}
