/**
 * V4-3 Learning Risk Detector — pure, evidence-based risk derivation.
 *
 * Input: LearningSignals (from the signal engine) + context facts.
 * Output: bounded, sorted risk list. The LLM NEVER decides risk —
 * every severity/confidence is computed from signal evidence here.
 */

import { SIGNAL_SEVERITY_ORDER, type LearningSignal } from './learning-signals';

export const RISK_TYPES = [
  'knowledge_regression',
  'repeated_mistake',
  'review_debt',
  'study_inactivity',
  'overload',
  'exam_risk',
] as const;

export type LearningRiskType = (typeof RISK_TYPES)[number];
export type RiskSeverity = 'high' | 'medium' | 'low';

export interface LearningRisk {
  type: LearningRiskType;
  severity: RiskSeverity;
  knowledgeNodeId: string | null;
  evidence: Record<string, unknown>;
  confidence: number;
  recommendation: string;
}

export function detectLearningRisks(signals: readonly LearningSignal[]): LearningRisk[] {
  const byKind = new Map(signals.map((signal) => [signal.kind, signal]));
  const risks: LearningRisk[] = [];

  // 1. knowledge_regression — baseline drop signal (critical evidence).
  const regression = byKind.get('knowledge_regression');
  if (regression?.present) {
    risks.push({
      type: 'knowledge_regression',
      severity: 'high',
      knowledgeNodeId: (regression.evidence.regressedNodes as string[] | undefined)?.[0] ?? null,
      evidence: { regressedNodes: regression.evidence.regressedNodes, comparedTo: regression.evidence.comparedTo },
      confidence: 0.9,
      recommendation: '回归节点需要立即重学：先做 2-3 道基础题重建信心，再对比此前错因',
    });
  }

  // 2. repeated_mistake — wrong streak + weak accuracy.
  const wrongStreak = byKind.get('wrong_streak');
  const accuracy = byKind.get('accuracy_trend');
  if (wrongStreak?.present) {
    const accuracyValue = (accuracy?.evidence.recentAccuracy as number | undefined) ?? null;
    const ratio = (wrongStreak.evidence.weakWrongRatio as number) ?? 0;
    const severity: RiskSeverity = ratio >= 0.8 || (accuracyValue != null && accuracyValue < 0.4) ? 'high' : 'medium';
    risks.push({
      type: 'repeated_mistake',
      severity,
      knowledgeNodeId: (wrongStreak.evidence.worstNode as string) ?? null,
      evidence: { wrongStreakRatio: ratio, recentAccuracy: accuracyValue, highRiskCount: wrongStreak.evidence.highRiskCount ?? 0 },
      confidence: Math.min(0.9, 0.5 + ratio * 0.4),
      recommendation: '连续同型错误：先复盘错因分类（概念/混淆/计算），再做对比练习验证',
    });
  }

  // 3. review_debt — overdue, or a heavy due queue (a single due item is
  // the normal daily rhythm, not debt).
  const overdue = byKind.get('review_overdue');
  if (overdue?.present) {
    const due = (overdue.evidence.dueCount as number) ?? 0;
    const overdueCount = (overdue.evidence.overdueCount as number) ?? 0;
    if (overdueCount > 0 || due >= 3) {
      const severity: RiskSeverity = overdueCount >= 3 ? 'high' : overdueCount > 0 ? 'medium' : 'medium';
      risks.push({
        type: 'review_debt',
        severity,
        knowledgeNodeId: null,
        evidence: { dueCount: due, overdueCount: overdueCount },
        confidence: Math.min(0.9, 0.4 + overdueCount * 0.15 + due * 0.05),
        recommendation: overdueCount > 0 ? '先清偿逾期复习，再开始新内容' : '按到期顺序完成复习队列',
      });
    }
  }

  // 4. study_inactivity — consistency warning.
  const consistency = byKind.get('study_consistency');
  if (consistency?.present && consistency.severity !== 'info') {
    const streak = (consistency.evidence.studyStreak as number) ?? 0;
    risks.push({
      type: 'study_inactivity',
      severity: streak === 0 ? 'high' : 'medium',
      knowledgeNodeId: null,
      evidence: { studyStreak: streak, activeDaysLast7: consistency.evidence.activeDaysLast7 ?? 0 },
      confidence: 0.85,
      recommendation: '从一道低难度题恢复节奏，重建连续学习状态',
    });
  }

  // 5. overload — large open backlog with low completion.
  const completion = byKind.get('task_completion');
  if (completion?.present) {
    const openCount = (completion.evidence.openTaskCount as number) ?? 0;
    if (openCount >= 8) {
      risks.push({
        type: 'overload',
        severity: 'medium',
        knowledgeNodeId: null,
        evidence: { openTaskCount: openCount, completionRate: completion.evidence.completionRate ?? null },
        confidence: 0.7,
        recommendation: '任务积压：建议削减到 3 项以内并优先完成高优先级项',
      });
    }
  }

  // 6. exam_risk — exam performance warning signal.
  const exam = byKind.get('exam_performance');
  if (exam?.present && exam.severity !== 'info') {
    risks.push({
      type: 'exam_risk',
      severity: 'high',
      knowledgeNodeId: null,
      evidence: { lastScorePercent: exam.evidence.lastScorePercent ?? null, trend: exam.evidence.trend ?? null },
      confidence: 0.8,
      recommendation: '模考成绩偏低且走低：安排一次专项诊断，聚焦失分最多的两个章节',
    });
  }

  const severityOrder: Record<RiskSeverity, number> = { high: 0, medium: 1, low: 2 };
  return risks.sort((left, right) =>
    severityOrder[left.severity] - severityOrder[right.severity] || right.confidence - left.confidence);
}