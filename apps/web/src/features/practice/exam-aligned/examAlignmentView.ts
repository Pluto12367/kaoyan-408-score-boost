/**
 * LE-V10 F1 — pure display mapping for the exam-alignment projection.
 * Every string derived here must stay traceable to its input field; the
 * estimate text ALWAYS carries the "估算" marker (constitution honesty rule).
 */

import type { PracticeSetExamAlignment, PracticeSetExamAlignmentItem } from '../../../api/types';

export function formatStars(stars: number): string {
  if (stars <= 0) return '';
  return '★'.repeat(Math.min(stars, 5));
}

export function frequencyLabel(stars: number): string {
  if (stars >= 5) return '高频考点';
  if (stars >= 4) return '常考考点';
  if (stars >= 3) return '偶考考点';
  return '暂无真题数据';
}

/** null-safe mastery text: "尚未练习" instead of any percentage. */
export function masteryText(mastery: number | null): string {
  if (mastery == null) return '尚未练习';
  return `${Math.round(mastery * 100)}%`;
}

/** Estimate text always carries the 估算 marker; null → no line at all. */
export function gainEstimateText(item: PracticeSetExamAlignmentItem): string | null {
  if (item.predictedGainEstimate == null) return null;
  return `预计收益：补齐该知识点可能提升约 ${item.predictedGainEstimate} 分（估算，公式见依据）`;
}

export function coveredYearsText(years: readonly number[]): string {
  if (years.length === 0) return '暂无真题数据';
  return `${years[0]}${years.length > 1 ? `-${years[years.length - 1]} 年` : ' 年'}`;
}

export function examHitsText(item: PracticeSetExamAlignmentItem): string {
  if (item.examHits.length === 0) return '';
  return item.examHits.map((hit) => `${hit.year} ${hit.subject} 第${hit.questionNo}题`).join(' / ');
}

export function reasonLineFor(item: PracticeSetExamAlignmentItem): string | null {
  if (item.recent5Frequency == null || item.stars === 0) return null;
  return `${formatStars(item.stars)} ${frequencyLabel(item.stars)} · 近 5 年 ${item.recent5Frequency} 次 · 掌握度 ${masteryText(item.mastery)}`;
}

export interface CoverageSummaryView {
  coverageLine: string;
  yearsLine: string;
  highFrequencyLine: string;
  nodeRows: Array<{ name: string; stars: number; recent5Frequency: number | null }>;
}

export function buildCoverageSummary(
  alignment: PracticeSetExamAlignment | null,
): CoverageSummaryView | null {
  if (!alignment || alignment.summary.coveredNodeCount === 0) return null;
  const byNode = new Map<string, { name: string; stars: number; recent5Frequency: number | null }>();
  for (const item of alignment.items) {
    if (!item.primaryNode) continue;
    const existing = byNode.get(item.primaryNode.knowledgeNodeId);
    if (!existing || item.stars > existing.stars) {
      byNode.set(item.primaryNode.knowledgeNodeId, {
        name: item.primaryNode.name,
        stars: item.stars,
        recent5Frequency: item.recent5Frequency,
      });
    }
  }
  return {
    coverageLine: `本次练习覆盖 ${alignment.summary.coveredNodeCount} 个真题知识点`,
    yearsLine: `覆盖年份：${coveredYearsText(alignment.summary.coveredYears)}`,
    highFrequencyLine: `高频（★≥4）知识点：${alignment.summary.highFrequencyCount} 个`,
    nodeRows: [...byNode.values()].sort((left, right) => right.stars - left.stars),
  };
}
