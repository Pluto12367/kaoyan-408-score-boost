export interface AssessmentHistorySummary {
  attemptCount: number;
  bestScore: number;
  latestAccuracyRate: number;
  improvementText: string;
}

export function buildAssessmentHistorySummary(
  items: Array<{ score: number; accuracyRate: number }>,
): AssessmentHistorySummary {
  const latest = items[0];
  const previous = items[1];
  const bestScore = items.length ? Math.max(...items.map((item) => item.score)) : 0;
  const improvementText = !latest
    ? '还没有测评记录，先完成一套模拟卷建立基线。'
    : !previous
      ? '已建立第一次测评基线，下一次可重点观察正确率和用时变化。'
      : latest.score > previous.score
        ? `较上次提升 ${latest.score - previous.score} 分，继续巩固本次薄弱点。`
        : latest.score === previous.score
          ? '与上次持平，建议通过限时训练和错题复盘提高稳定性。'
          : `较上次下降 ${previous.score - latest.score} 分，先复盘本次错题再进入新题训练。`;

  return {
    attemptCount: items.length,
    bestScore,
    latestAccuracyRate: latest?.accuracyRate ?? 0,
    improvementText,
  };
}
