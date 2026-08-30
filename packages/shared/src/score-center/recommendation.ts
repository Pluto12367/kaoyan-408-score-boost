import type {
  PriorityReasonCode,
  RecommendationExamEvidence,
  RecommendationInput,
  RecommendationItem,
  RecommendationNodeState,
  RecommendationResult,
  UserKnowledgeState,
} from './types';
import type { PriorityCandidate } from './plan';
import { calculatePriority } from './priority';
import { classifyAction, composeDailyPlan, cooldownScore, estimateMinutes } from './plan';

// Recommendation Engine v1 —— 契约冻结：docs/sprint3-recommendation-contract.md
//
// 纯函数层：无 IO、无时钟/随机源（时间唯一来源 input.meta.now）、无 UI 文案、
// 无 knowledgePointId（唯一 ID 为 knowledgeNodeId，见契约 §1）。
// 组合（不复制）priority.ts 与 plan.ts 的既有算法。

const DEFAULT_MAX_ITEMS = 8;
const REVIEW_FORGETTING_THRESHOLD = 0.55;
const DAY_MS = 86_400_000;
const DEFAULT_IMPORTANCE = 3;
const DEFAULT_DIFFICULTY = 3;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function forgettingOf(nodeState: RecommendationNodeState): number {
  return nodeState.retention == null ? 0.5 : clamp01(1 - nodeState.retention);
}

function toUserKnowledgeState(nodeState: RecommendationNodeState): UserKnowledgeState {
  return {
    mastery: nodeState.mastery,
    accuracy: nodeState.accuracy,
    recentAccuracy: nodeState.recentAccuracy,
    attempts: nodeState.attempts,
    correctCount: nodeState.correctCount,
    wrongCount: nodeState.wrongCount,
    confidence: nodeState.attempts > 0 ? Math.min(1, 1 - Math.exp(-nodeState.attempts / 12)) : 0,
    retention: nodeState.retention,
    pinned: nodeState.pinned,
  };
}

// 证据缺失退化（契约 §3）：中性内容证据 + LOW_EVIDENCE（由 calculatePriority 注入）
function defaultEvidence(): RecommendationExamEvidence {
  return {
    subject: '未分类',
    importance: DEFAULT_IMPORTANCE,
    difficulty: DEFAULT_DIFFICULTY,
    recent3Y: { frequency: 0 },
    recent5Y: { frequency: 0 },
    allTimeEvidence: { frequency: 0 },
    trend: { direction: 'STABLE', delta: 0 },
    evidenceConfidence: 'LOW',
  };
}

export function runRecommendation(input: RecommendationInput): RecommendationResult {
  const now = new Date(input.meta.now);
  const daysToExam = Math.max(0, input.config.daysToExam);
  const maxItems = input.config.maxItems ?? DEFAULT_MAX_ITEMS;
  const scheduledDate = input.meta.now.slice(0, 10);

  // 稳定输入序：nodeId 字典序（后续所有排序依赖它作为 tie-breaker）
  const orderedStates = [...input.student.nodeStates]
    .sort((left, right) => left.knowledgeNodeId.localeCompare(right.knowledgeNodeId));

  const candidateByNode = new Map<string, PriorityCandidate>();
  const stateByNode = new Map<string, RecommendationNodeState>();
  const scoreByNode = new Map<string, number>();
  const reasonsByNode = new Map<string, PriorityReasonCode[]>();
  const candidates: PriorityCandidate[] = [];

  for (const nodeState of orderedStates) {
    const evidence = input.content.evidence[nodeState.knowledgeNodeId] ?? defaultEvidence();
    // calculatePriority 不消费 ExamEvidence.knowledgePointId（ID 纪律见契约 §1）；
    // 形参对齐时以 nodeId 填充该字段——与 score-center generateDailyPlan 的既有实践一致。
    const priority = calculatePriority(
      { ...evidence, knowledgePointId: nodeState.knowledgeNodeId },
      toUserKnowledgeState(nodeState),
      { daysToExam },
    );
    const candidate: PriorityCandidate = {
      // 契约 §1：值空间始终是 knowledgeNodeId；字段名沿用 plan.ts 候选形状。
      knowledgePointId: nodeState.knowledgeNodeId,
      subject: evidence.subject ?? '未分类',
      difficulty: evidence.difficulty,
      mastery: nodeState.mastery,
      recentAccuracy: nodeState.recentAccuracy,
      recentWrongCount: nodeState.wrongCount,
      forgetting: forgettingOf(nodeState),
      retention: nodeState.retention,
      lastReviewedAt: nodeState.lastReviewedAt ? new Date(nodeState.lastReviewedAt) : null,
      score: priority.score,
      reasonCodes: [...priority.reasons],
      prerequisites: input.content.prerequisites[nodeState.knowledgeNodeId] ?? [],
      pinned: nodeState.pinned,
    };
    candidateByNode.set(nodeState.knowledgeNodeId, candidate);
    stateByNode.set(nodeState.knowledgeNodeId, nodeState);
    scoreByNode.set(nodeState.knowledgeNodeId, priority.score);
    reasonsByNode.set(nodeState.knowledgeNodeId, priority.reasons);
    candidates.push(candidate);
  }

  const byScoreThenNode = <T extends { score: number; knowledgeNodeId: string }>(items: T[]): T[] =>
    [...items].sort((left, right) => right.score - left.score || left.knowledgeNodeId.localeCompare(right.knowledgeNodeId));

  // ---- TASK_DRAFT：复用 composeDailyPlan（预算/科目配额/前置替换/LEARN 上限）----
  const drafts = composeDailyPlan({
    candidates,
    availableMinutes: input.config.availableMinutes,
    daysToExam,
    prerequisiteMastery: input.content.prerequisiteMastery,
    now,
  });
  const taskItems: RecommendationItem[] = drafts.map((draft) => ({
    kind: 'TASK_DRAFT',
    knowledgeNodeId: draft.knowledgePointId,
    score: draft.score,
    action: draft.action,
    estimatedMinutes: draft.estimatedMinutes,
    scheduledDate,
    reasonCodes: [...draft.reasonCodes],
  }));

  // ---- KNOWLEDGE：信息层推荐（score 取冷却后分值，cap maxItems）----
  const knowledgeItems: RecommendationItem[] = byScoreThenNode(
    [...candidateByNode.values()].map((candidate) => {
      const action = classifyAction(candidate, daysToExam);
      return {
        kind: 'KNOWLEDGE' as const,
        knowledgeNodeId: candidate.knowledgePointId,
        score: Math.round(cooldownScore(candidate, now)),
        action,
        estimatedMinutes: estimateMinutes(action, candidate.difficulty),
        reasonCodes: [...(reasonsByNode.get(candidate.knowledgePointId) ?? [])],
        facts: {
          mastery: candidate.mastery,
          attempts: stateByNode.get(candidate.knowledgePointId)?.attempts ?? 0,
          wrongCount: candidate.recentWrongCount,
        },
      };
    }),
  ).slice(0, maxItems);

  // ---- REVIEW：遗忘超阈值的节点（契约：reasonCodes 至少含 REVIEW_DUE）----
  const reviewNodes = new Set<string>();
  const reviewItems: RecommendationItem[] = byScoreThenNode(
    [...candidateByNode.values()]
      .filter((candidate) => forgettingOf(stateByNode.get(candidate.knowledgePointId)!) >= REVIEW_FORGETTING_THRESHOLD)
      .map((candidate) => {
        const nodeState = stateByNode.get(candidate.knowledgePointId)!;
        const reasons = [...(reasonsByNode.get(candidate.knowledgePointId) ?? [])];
        if (!reasons.includes('REVIEW_DUE')) reasons.push('REVIEW_DUE');
        const nextReviewAt = nodeState.lastReviewedAt && nodeState.stabilityDays != null
          ? new Date(new Date(nodeState.lastReviewedAt).getTime() + nodeState.stabilityDays * DAY_MS).toISOString()
          : null;
        return {
          kind: 'REVIEW' as const,
          knowledgeNodeId: candidate.knowledgePointId,
          score: Math.round(cooldownScore(candidate, now)),
          reasonCodes: reasons,
          facts: {
            stabilityDays: nodeState.stabilityDays,
            retention: nodeState.retention,
            nextReviewAt,
          },
        };
      }),
  );
  for (const item of reviewItems) reviewNodes.add(item.knowledgeNodeId);

  // 去重不变式（契约 §5.4）：同节点同为复习意图时只保留 REVIEW
  const knowledgeAfterReview = knowledgeItems.filter(
    (item) => !(item.kind === 'KNOWLEDGE' && reviewNodes.has(item.knowledgeNodeId) && item.action === 'REVIEW'),
  );

  // ---- QUESTION_SET：节点级题量建议（只在对应 KNOWLEDGE 项存在时生成）----
  const totalAttempts = orderedStates.reduce((sum, nodeState) => sum + nodeState.attempts, 0);
  const totalCorrect = orderedStates.reduce((sum, nodeState) => sum + nodeState.correctCount, 0);
  const overallAccuracy = totalAttempts > 0 ? totalCorrect / totalAttempts : 0;
  const questionSetItems: RecommendationItem[] = knowledgeAfterReview
    .filter((item): item is Extract<RecommendationItem, { kind: 'KNOWLEDGE' }> => item.kind === 'KNOWLEDGE')
    .map((item) => {
      const quota = input.student.goal.stage === '冲刺'
        ? { questionCount: 20, focus: '真题错题回炉训练' as const }
        : overallAccuracy < 0.55
          ? { questionCount: 16, focus: '高频基础考点补强' as const }
          : { questionCount: 12, focus: '薄弱专题突破' as const };
      return {
        kind: 'QUESTION_SET' as const,
        knowledgeNodeId: item.knowledgeNodeId,
        score: item.score,
        questionCount: quota.questionCount,
        focus: quota.focus,
        reasonCodes: [...item.reasonCodes],
      };
    });

  // ---- 合并输出：score 降序 + nodeId 字典序 tie-break（契约 §2/§5）----
  const items = byScoreThenNode(
    [...knowledgeAfterReview, ...reviewItems, ...questionSetItems, ...taskItems],
  );

  return {
    userId: input.meta.userId,
    generatedAt: input.meta.generatedAt,
    source: 'recommendation_engine_v1',
    items,
  };
}
