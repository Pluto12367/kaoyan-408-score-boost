// Sprint 3.3：practice-set 推荐适配器（纯函数，无 IO）。
// 职责（契约 docs/sprint3-recommendation-contract.md §1）：
// - knowledgeNodeId → knowledgePointId 桥接（经 KnowledgePointNodeMap 反查结果）
// - QUESTION_SET.focus → legacy title/focus 文案
// - reasonCodes + facts → reason 句式
// 禁止：查询数据库、计算 priority、题目实例选择（留在 StudyService 内容事实层）。
import type { RecommendationFocus } from '@kaoyan408/shared';

export const PRACTICE_SET_FOCUS_COPY: Record<RecommendationFocus, { title: string; focus: string }> = {
  '真题错题回炉训练': { title: '真题错题回炉训练', focus: '近年真题、错题重做、限时复盘' },
  '高频基础考点补强': { title: '高频基础考点补强', focus: '例题理解、概念复述、基础题组' },
  '薄弱专题突破': { title: '薄弱专题突破', focus: '相似考点辨析、变式题组、错因复盘' },
};

export interface PracticeSetTopWeakPoint {
  title: string;
  accuracyRate: number;
}

export interface CanonicalPracticeSetIdentity {
  knowledgeNodeIds: string[];
  knowledgePointIds: string[];
}

/** Compatibility boundary for the schema's legacy StudyTask field. */
export function toLegacyStudyTaskIdentity(input: { knowledgeNodeId: string }): {
  knowledgePointId: string;
  knowledgeNodeId: string;
} {
  return {
    knowledgePointId: input.knowledgeNodeId,
    knowledgeNodeId: input.knowledgeNodeId,
  };
}

/**
 * nodeId → knowledgePointId 桥接（契约 §1 指定由 adapter 承担）。
 * 无桥接记录的节点不会伪装成 Point ID；调用方仍可通过
 * CanonicalPracticeSetIdentity.knowledgeNodeIds 暴露节点事实。
 */
export function bridgeKnowledgePointIds(input: {
  nodeIds: string[];
  kpIdsByNodeId: Record<string, string[]>;
}): string[] {
  const bridged: string[] = [];
  const seen = new Set<string>();
  for (const nodeId of input.nodeIds) {
    const kpIds = input.kpIdsByNodeId[nodeId] ?? [];
    for (const kpId of kpIds) {
      if (!seen.has(kpId)) {
        seen.add(kpId);
        bridged.push(kpId);
      }
    }
  }
  return bridged;
}

/** Build the two disjoint identity arrays used by recommendation responses. */
export function buildCanonicalPracticeSetIdentity(input: {
  nodeIds: string[];
  kpIdsByNodeId: Record<string, string[]>;
}): CanonicalPracticeSetIdentity {
  const knowledgeNodeIds = [...new Set(input.nodeIds)];
  return {
    knowledgeNodeIds,
    knowledgePointIds: bridgeKnowledgePointIds(input),
  };
}

/**
 * practice-set 文案组装。分支优先级：引擎 QUESTION_SET.focus（优先）→
 * (stage, overallAccuracyRate) 回退分支（legacy 口径）。
 */
export function buildPracticeSetCopy(input: {
  stage: string;
  overallAccuracyRate: number;
  questionSetFocus: RecommendationFocus | null;
  topWeakPoint: PracticeSetTopWeakPoint | null;
}): { title: string; focus: string; reason: string } {
  const focus: RecommendationFocus = input.questionSetFocus
    ?? (input.stage === '冲刺'
      ? '真题错题回炉训练'
      : input.overallAccuracyRate < 55
        ? '高频基础考点补强'
        : '薄弱专题突破');
  const copy = PRACTICE_SET_FOCUS_COPY[focus];
  /**
   * G1 Release Hardening (A1, EVIDENCED_REASON-only): the fallback used to say
   * "当前薄弱点较少", which is a claim the call site cannot support — an empty
   * weak-point list means either "no practice records yet" or "no standout
   * weakness", and the first case makes the sentence false. It now states the
   * absence of evidence rather than a conclusion drawn from it.
   */
  const reason = input.topWeakPoint
    ? `优先覆盖 ${input.topWeakPoint.title}，当前正确率 ${input.topWeakPoint.accuracyRate}%。`
    : '当前证据不足：没有足够的作答证据指向某个具体薄弱点；这组练习按今日计划与高频考点生成。';
  return { title: copy.title, focus: copy.focus, reason };
}
