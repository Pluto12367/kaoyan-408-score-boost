/**
 * V4-4 Adaptive Recommendation Layer — pure re-ranking over engine output.
 *
 * Design (AD-V4-2): the shared score-center engine is NEVER modified. This
 * layer takes the engine's items plus the adaptive facts (signals, risks,
 * review debt, exam distance) and produces a bounded, re-ranked plan view:
 *
 * - risk boosts:  nodes implicated in high/medium risks move up;
 * - review insert: review_debt injects a REVIEW action card at the top
 *   (no fabricated question content — it references the review queue);
 * - load cap:      when overload risk is present, the item budget shrinks;
 * - annotation:    every change carries its reason for auditability.
 *
 * Deterministic and LLM-free. Consumers: DailyPlanningService and the
 * adaptive planner.
 */

export interface AdaptiveInputItem {
  knowledgeNodeId: string;
  title: string;
  action: string;
  score: number;
  estimatedMinutes: number;
  reasonCodes?: readonly string[];
}

export interface AdaptiveFacts {
  risks: ReadonlyArray<{
    type: string;
    severity: 'high' | 'medium' | 'low';
    knowledgeNodeId: string | null;
    evidence: Record<string, unknown>;
  }>;
  signals: ReadonlyArray<{ kind: string; present: boolean; severity: string; evidence: Record<string, unknown> }>;
  reviewQueue?: ReadonlyArray<{ questionId: string; title?: string; wrongCount?: number; overdue?: boolean }>;
  examDaysRemaining?: number | null;
}

export interface AdaptiveAdjustedItem extends AdaptiveInputItem {
  adjustedScore: number;
  adjustments: readonly string[];
}

export interface AdaptivePlanView {
  items: AdaptiveAdjustedItem[];
  reviewCard: {
    kind: 'REVIEW_DEBT';
    dueCount: number;
    overdueCount: number;
    topQuestion: { questionId: string; title: string } | null;
  } | null;
  loadCapApplied: boolean;
  strategyNote: string;
}

const RISK_BOOST: Record<string, number> = { high: 12, medium: 6, low: 0 };

export function adaptRecommendation(
  items: readonly AdaptiveInputItem[],
  facts: AdaptiveFacts,
): AdaptivePlanView {
  const adjustmentsByNode = new Map<string, string[]>();
  const boostByNode = new Map<string, number>();

  // Risk-driven boosts.
  for (const risk of facts.risks) {
    if (!risk.knowledgeNodeId) continue;
    const boost = RISK_BOOST[risk.severity] ?? 0;
    if (boost <= 0) continue;
    boostByNode.set(risk.knowledgeNodeId, (boostByNode.get(risk.knowledgeNodeId) ?? 0) + boost);
    const list = adjustmentsByNode.get(risk.knowledgeNodeId) ?? [];
    list.push(`risk_boost:${risk.type}:${risk.severity}`);
    adjustmentsByNode.set(risk.knowledgeNodeId, list);
  }

  // Exam proximity boosts everything slightly (phase-aware urgency).
  const examDays = facts.examDaysRemaining ?? null;
  const examBoost = examDays != null && examDays >= 0 && examDays <= 30 ? 5 : 0;

  // Review debt: cap the item budget and surface a review card.
  const reviewDebtRisk = facts.risks.find((risk) => risk.type === 'review_debt');
  const overloadRisk = facts.risks.find((risk) => risk.type === 'overload');
  const debtEvidence = (reviewDebtRisk?.evidence ?? {}) as { dueCount?: number; overdueCount?: number };
  const dueCount = debtEvidence.dueCount ?? 0;
  const overdueCount = debtEvidence.overdueCount ?? 0;
  const loadCapApplied = !!overloadRisk;

  const adjusted: AdaptiveAdjustedItem[] = items.map((item) => {
    const boost = (boostByNode.get(item.knowledgeNodeId) ?? 0) + examBoost;
    const list = adjustmentsByNode.get(item.knowledgeNodeId) ?? [];
    if (examBoost > 0) list.push('exam_proximity_boost');
    return { ...item, adjustedScore: item.score + boost, adjustments: list };
  }).sort((left, right) => right.adjustedScore - left.adjustedScore);

  const capped = loadCapApplied && adjusted.length > 3 ? adjusted.slice(0, 3) : adjusted;

  const reviewCard = reviewDebtRisk && (dueCount > 0 || overdueCount > 0)
    ? {
        kind: 'REVIEW_DEBT' as const,
        dueCount,
        overdueCount,
        topQuestion: facts.reviewQueue?.[0]
          ? {
              questionId: facts.reviewQueue[0].questionId,
              title: facts.reviewQueue[0].title ?? facts.reviewQueue[0].questionId,
            }
          : null,
      }
    : null;

  const strategyParts: string[] = [];
  if (examBoost > 0) strategyParts.push(`考前 ${examDays} 天：全项 +${examBoost} 紧迫度`);
  if (reviewDebtRisk) strategyParts.push(`复习债优先：${overdueCount} 逾期 / ${dueCount} 到期`);
  if (loadCapApplied) strategyParts.push('过载保护：预算收缩至 3 项');
  if (strategyParts.length === 0) strategyParts.push('无风险信号：按引擎排序透传');

  return {
    items: capped.map((item) => ({
      ...item,
      adjustments: adjustmentsByNode.get(item.knowledgeNodeId) ?? [],
    })),
    reviewCard,
    loadCapApplied,
    strategyNote: strategyParts.join('；'),
  };
}