import type { PriorityReasonCode, RecommendationAction } from './types';

// RecommendationAction 的唯一定义在 types.ts（Sprint 3.1 上移），此处保持导出兼容。
export type { RecommendationAction };

export type PriorityCandidate = {
  knowledgePointId: string;
  subject: string;
  difficulty: number;
  mastery: number;
  recentAccuracy: number;
  recentWrongCount: number;
  forgetting: number;
  retention?: number | null;
  lastReviewedAt?: Date | null;
  score: number;
  reasonCodes: PriorityReasonCode[];
  prerequisites: string[];
  pinned?: boolean;
};

export type RecommendationDraft = {
  knowledgePointId: string;
  score: number;
  action: RecommendationAction;
  estimatedMinutes: number;
  reasonCodes: PriorityReasonCode[];
  replacedByPrerequisiteOf?: string;
};

const FOUNDATION_LEARN_RATIO = 0.4;
const COOLDOWN_SCORE_FACTOR = 0.55;
const COOLDOWN_HOURS = 36;

// Sprint 3.1：行动分类器导出为 Recommendation Engine 的公共构件（算法不变）。
export function classifyAction(candidate: PriorityCandidate, daysToExam: number): RecommendationAction {
  if (candidate.recentWrongCount >= 2) return 'WRONG_QUESTION';
  if (candidate.forgetting >= 0.55) return 'REVIEW';
  if (candidate.mastery < 0.45) return 'LEARN';
  if (candidate.recentAccuracy < 0.7) return 'PRACTICE';
  if (daysToExam <= 45 && candidate.mastery >= 0.75) return 'MOCK';
  return 'PRACTICE';
}

export function estimateMinutes(action: RecommendationAction, difficulty: number): number {
  if (action === 'REVIEW') return difficulty >= 4 ? 20 : 15;
  if (action === 'WRONG_QUESTION') return difficulty >= 4 ? 30 : 20;
  if (action === 'LEARN') return difficulty >= 4 ? 35 : 20;
  if (action === 'MOCK') return 30;
  return difficulty >= 4 ? 30 : 20;
}

export function cooldownScore(candidate: PriorityCandidate, now: Date): number {
  if (
    candidate.recentWrongCount === 0
    && candidate.retention != null
    && candidate.retention >= 0.85
    && candidate.lastReviewedAt
  ) {
    const hoursSinceReview = (now.getTime() - candidate.lastReviewedAt.getTime()) / 3_600_000;
    if (hoursSinceReview >= 0 && hoursSinceReview <= COOLDOWN_HOURS) {
      return candidate.score * COOLDOWN_SCORE_FACTOR;
    }
  }
  return candidate.score;
}

function toDraft(
  candidate: PriorityCandidate,
  daysToExam: number,
  now: Date,
  replacedByPrerequisiteOf?: string,
): RecommendationDraft {
  const action = classifyAction(candidate, daysToExam);
  const reasonCodes = [...candidate.reasonCodes];
  if (replacedByPrerequisiteOf && !reasonCodes.includes('PREREQUISITE_GAP')) {
    reasonCodes.push('PREREQUISITE_GAP');
  }
  return {
    knowledgePointId: candidate.knowledgePointId,
    score: Math.round(cooldownScore(candidate, now)),
    action,
    estimatedMinutes: estimateMinutes(action, candidate.difficulty),
    reasonCodes,
    ...(replacedByPrerequisiteOf ? { replacedByPrerequisiteOf } : {}),
  };
}

export function composeDailyPlan(input: {
  candidates: PriorityCandidate[];
  availableMinutes: 30 | 60 | 120 | 180;
  daysToExam: number;
  prerequisiteMastery?: Record<string, number>;
  // Sprint 3.1 确定性注入：冷却计算的时间来源；缺省 new Date() 保持旧行为。
  now?: Date;
}): RecommendationDraft[] {
  const now = input.now ?? new Date();
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.knowledgePointId, candidate]));
  const prerequisiteMastery = input.prerequisiteMastery ?? {};

  const resolve = (candidate: PriorityCandidate): RecommendationDraft => {
    let unmet: { id: string; mastery: number } | null = null;
    for (const prerequisiteId of candidate.prerequisites) {
      const mastery = prerequisiteMastery[prerequisiteId];
      if (mastery != null && mastery < 0.45 && (!unmet || mastery < unmet.mastery)) {
        unmet = { id: prerequisiteId, mastery };
      }
    }
    if (unmet && candidateById.has(unmet.id)) {
      return toDraft(candidateById.get(unmet.id)!, input.daysToExam, now, candidate.knowledgePointId);
    }
    return toDraft(candidate, input.daysToExam, now);
  };

  const used = new Set<string>();
  const rawDrafts: RecommendationDraft[] = [];
  const orderedCandidates = [...input.candidates].sort((left, right) => right.score - left.score);
  for (const candidate of orderedCandidates) {
    const draft = resolve(candidate);
    if (used.has(draft.knowledgePointId)) continue;
    used.add(draft.knowledgePointId);
    rawDrafts.push(draft);
  }

  const sorted = [...rawDrafts].sort((left, right) => right.score - left.score);
  const selected: RecommendationDraft[] = [];
  let totalMinutes = 0;
  for (const draft of sorted) {
    if (totalMinutes + draft.estimatedMinutes > input.availableMinutes) continue;
    selected.push(draft);
    totalMinutes += draft.estimatedMinutes;
  }

  applySubjectQuota(selected, sorted, candidateById, input.availableMinutes, (delta) => {
    totalMinutes += delta;
  });

  applyFoundationLearnCap(selected, sorted, input.availableMinutes, input.daysToExam, (delta) => {
    totalMinutes += delta;
  });

  return [...selected].sort((left, right) => right.score - left.score);
}

function applySubjectQuota(
  selected: RecommendationDraft[],
  sorted: RecommendationDraft[],
  candidateById: Map<string, PriorityCandidate>,
  availableMinutes: number,
  adjustMinutes: (delta: number) => void,
) {
  if (availableMinutes < 60) return;
  const selectedSubjects = new Set(selected.map((draft) => candidateById.get(draft.knowledgePointId)?.subject));
  if (selectedSubjects.size >= 2) return;

  const currentMinutes = selected.reduce((sum, draft) => sum + draft.estimatedMinutes, 0);
  const otherSubject = sorted.find(
    (draft) =>
      !selected.includes(draft)
      && candidateById.get(draft.knowledgePointId)?.subject !== [...selectedSubjects][0]
      && currentMinutes + draft.estimatedMinutes <= availableMinutes,
  );
  if (otherSubject) {
    selected.push(otherSubject);
    adjustMinutes(otherSubject.estimatedMinutes);
    return;
  }

  // Budget is full: swap the lowest-score selected item for the best second-subject item when the swap fits.
  const majoritySubject = [...selectedSubjects][0];
  const lowestSelected = [...selected]
    .filter((draft) => candidateById.get(draft.knowledgePointId)?.subject === majoritySubject)
    .sort((left, right) => left.score - right.score)[0];
  if (!lowestSelected) return;
  const replacement = sorted.find(
    (draft) =>
      !selected.includes(draft)
      && candidateById.get(draft.knowledgePointId)?.subject !== majoritySubject
      && currentMinutes - lowestSelected.estimatedMinutes + draft.estimatedMinutes <= availableMinutes,
  );
  if (replacement) {
    const index = selected.indexOf(lowestSelected);
    selected.splice(index, 1, replacement);
    adjustMinutes(replacement.estimatedMinutes - lowestSelected.estimatedMinutes);
  }
}

function applyFoundationLearnCap(
  selected: RecommendationDraft[],
  sorted: RecommendationDraft[],
  availableMinutes: number,
  daysToExam: number,
  adjustMinutes: (delta: number) => void,
) {
  if (daysToExam <= 150) return;
  const cap = Math.ceil(selected.length * FOUNDATION_LEARN_RATIO);
  const learnItems = selected.filter((draft) => draft.action === 'LEARN');
  if (learnItems.length <= cap) return;

  const excess = [...learnItems].sort((left, right) => left.score - right.score)
    .slice(0, learnItems.length - cap);
  const replacementPool = [...sorted].filter(
    (draft) =>
      !selected.includes(draft)
      && (draft.action === 'REVIEW' || draft.action === 'PRACTICE'),
  );

  for (const remove of excess) {
    const currentMinutes = selected.reduce((sum, draft) => sum + draft.estimatedMinutes, 0);
    const replacement = replacementPool.find(
      (draft) => currentMinutes - remove.estimatedMinutes + draft.estimatedMinutes <= availableMinutes,
    );
    if (!replacement) break;
    const index = selected.indexOf(remove);
    selected.splice(index, 1, replacement);
    adjustMinutes(replacement.estimatedMinutes - remove.estimatedMinutes);
    replacementPool.splice(replacementPool.indexOf(replacement), 1);
  }
}
