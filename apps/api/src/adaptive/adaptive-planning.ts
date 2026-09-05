/**
 * V4-5 Agent Adaptive Planner — signal/risk-aware planning input.
 *
 * Pure functions building the adaptive planning context:
 * - buildAdaptivePlanningBrief: compact prompt section for the agent/planner
 *   (active signals + risks + strategy note), evidence-only;
 * - derivePlanningStrategy: risk → strategy directive mapping (reduce load,
 *   prioritize reviews, schedule diagnostics) decided by RULES, never LLM.
 */

import type { LearningRisk } from './learning-risk';
import type { LearningSignal } from './learning-signals';

export interface AdaptivePlanningBrief {
  signalsBrief: string;
  risksBrief: string;
  strategyDirectives: string[];
}

export function derivePlanningStrategy(risks: readonly LearningRisk[]): string[] {
  const directives: string[] = [];
  const has = (type: LearningRisk['type'], minSeverity: 'high' | 'medium' | 'low' = 'low') => {
    const order = { low: 0, medium: 1, high: 2 };
    return risks.some((risk) => risk.type === type && order[risk.severity] >= order[minSeverity]);
  };
  if (has('knowledge_regression', 'high')) directives.push('存在知识回归：优先安排回归节点的重学与验证，暂缓新知识点');
  if (has('repeated_mistake', 'high')) directives.push('存在连续同型错误：先复盘错因分类，再安排对比练习');
  if (has('review_debt', 'medium')) directives.push('复习债积压：把复习任务排在推荐任务之前');
  if (has('study_inactivity', 'high')) directives.push('学习中断：从低难度题恢复节奏，避免直接进入高难内容');
  if (has('overload')) directives.push('任务过载：削减计划容量，聚焦最高优先级项');
  if (has('exam_risk')) directives.push('模考风险：安排专项诊断并聚焦失分最多的章节');
  if (directives.length === 0) directives.push('无活跃风险：按推荐引擎排序正常推进');
  return directives;
}

export function buildAdaptivePlanningBrief(
  signals: readonly LearningSignal[],
  risks: readonly LearningRisk[],
): AdaptivePlanningBrief {
  const signalsBrief = signals
    .filter((signal) => signal.present)
    .map((signal) => `${signal.kind}(${signal.severity})`)
    .join(', ');
  const risksBrief = risks
    .map((risk) => `${risk.type}:${risk.severity}`)
    .join(', ');
  return {
    signalsBrief,
    risksBrief,
    strategyDirectives: derivePlanningStrategy(risks),
  };
}