/**
 * V4-6 Proactive Coach — risk-driven proactive interventions (pure).
 *
 * The proactive coach does NOT free-associate: every intervention is
 * derived from LearningSignals + LearningRisks (evidence-based), and the
 * action it proposes routes back through the existing canonical actors
 * (review queue / planner / practice selection).
 *
 * Intervention contract:
 *   id          — deterministic, rebuildable
 *   trigger     — which risk/signal fired it
 *   severity    — from the strongest contributing risk
 *   headline    — short user-facing statement (no fabrication)
 *   actions     — concrete next actions the student can take
 *   actorHint   — which canonical surface executes it (review/plan/practice)
 */

import type { LearningRisk } from './learning-risk';
import type { LearningSignal } from './learning-signals';

export interface ProactiveIntervention {
  id: string;
  trigger: string;
  severity: 'high' | 'medium' | 'low';
  headline: string;
  actions: string[];
  actorHint: 'review' | 'plan' | 'practice' | 'coach';
  knowledgeNodeId?: string;
}

const RISK_SEVERITY_TO_INTERVENTION: Record<string, 'high' | 'medium' | 'low'> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

const RECOMMENDATION_BY_TYPE: Record<string, { headline: (evidence: Record<string, unknown>) => string; actions: string[]; actorHint: ProactiveIntervention['actorHint'] }> = {
  knowledge_regression: {
    headline: (e) => {
      const nodes = (e.regressedNodes as string[] | undefined) ?? [];
      return nodes.length > 0
        ? `检测到知识回归（${nodes.length} 个节点掌握度较基线下降），建议立即重学`
        : '检测到知识回归，建议重学相关节点';
    },
    actions: ['重做该节点的 2-3 道基础题', '对比基线复盘此前错因', '通过变式题验证恢复情况'],
    actorHint: 'coach',
  },
  repeated_mistake: {
    // V9 production fix: the risk layer renames the signal's weakWrongRatio
    // to wrongStreakRatio — read both so the headline can never fall back to 0%.
    headline: (e) => {
      const ratio = (e.wrongStreakRatio as number) ?? (e.weakWrongRatio as number) ?? 0;
      return `连续同型错误（错误占比 ${Math.round(ratio * 100)}%），建议按错因复盘`;
    },
    actions: ['按错因分类复盘（概念/混淆/计算）', '做 1 组对比练习验证', '复述该知识点的关键条件'],
    actorHint: 'practice',
  },
  review_debt: {
    headline: (e) => {
      const overdue = (e.overdueCount as number) ?? 0;
      const due = (e.dueCount as number) ?? 0;
      return overdue > 0
        ? `有 ${overdue} 项复习已逾期（共 ${due} 项到期），先清偿复习债`
        : `有 ${due} 项复习到期，建议先完成复习`;
    },
    actions: ['按到期顺序完成复习队列', '逾期项优先', '复习后立即做 1 道同源题巩固'],
    actorHint: 'review',
  },
  study_inactivity: {
    headline: (e) => `学习中断（连续 ${e.studyStreak ?? 0} 天、近 7 天活跃 ${(e.activeDaysLast7 as number) ?? 0} 天），建议恢复节奏`,
    actions: ['从 1 道低难度题热身', '安排 20 分钟的轻量任务', '完成后打卡重建连续学习状态'],
    actorHint: 'plan',
  },
  overload: {
    headline: (e) => `任务积压（${e.openTaskCount ?? 0} 项未完成、完成率偏低），建议削减计划`,
    actions: ['只保留 3 项最高优先级任务', '其余任务顺延而不是同时推进', '完成后用完成率验证新负荷'],
    actorHint: 'plan',
  },
  exam_risk: {
    headline: (e) => `模考表现偏低（${e.lastScorePercent ?? '?'}%）且趋势${e.trend === 'down' ? '走低' : '平缓'}，建议专项诊断`,
    actions: ['按失分排序做专项诊断', '聚焦失分最多的 2 个章节', '一周后安排复测验证'],
    actorHint: 'plan',
  },
};

export interface ProactiveInterventionsInput {
  signals: readonly LearningSignal[];
  risks: readonly LearningRisk[];
  asOf: string;
}

export function deriveProactiveInterventions(input: ProactiveInterventionsInput): ProactiveIntervention[] {
  const interventions: ProactiveIntervention[] = [];
  input.risks.forEach((risk, index) => {
    const template = RECOMMENDATION_BY_TYPE[risk.type];
    if (!template) return;
    interventions.push({
      id: `${risk.type}-${input.asOf.slice(0, 10)}-${index}`,
      trigger: risk.type,
      severity: RISK_SEVERITY_TO_INTERVENTION[risk.severity] ?? 'medium',
      headline: template.headline(risk.evidence),
      actions: template.actions,
      actorHint: template.actorHint,
      ...(risk.knowledgeNodeId ? { knowledgeNodeId: risk.knowledgeNodeId } : {}),
    });
  });
  return interventions.sort((left, right) => {
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return order[left.severity] - order[right.severity];
  });
}