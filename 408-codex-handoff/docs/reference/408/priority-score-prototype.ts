export interface UserKnowledgeState {
  knowledgePointId: string;

  /** 0~1；没有数据时可为空 */
  mastery?: number;
  accuracy?: number;

  /** 该考点累计错题数 */
  wrongCount?: number;

  /** 最近一次学习/复习时间 */
  lastReviewedAt?: string | null;

  /** SM-2/FSRS 或你的复习模块输出的 retention 0~1 */
  retention?: number;

  /** 用户是否手工标记重点 */
  pinned?: boolean;
}

export interface ExamEvidence {
  knowledgePointId: string;
  importance: 1|2|3|4|5;
  difficulty: 1|2|3|4|5;

  recent3Y: { frequency: 1|2|3|4|5 };
  recent5Y: {
    frequency: 1|2|3|4|5;
    primaryCount: number;
    secondaryCount: number;
    primaryScore: number;
  };

  allTimeEvidence: {
    frequency: 1|2|3|4|5;
  };

  trend: {
    direction: "rising"|"stable"|"falling"|"cold";
    delta: number;
  };
}

export interface PriorityContext {
  /** 距离408考试剩余天数 */
  daysToExam: number;

  /** 当前学习阶段，可由天数自动推导，也可外部传入 */
  phase?: "foundation"|"reinforcement"|"sprint";
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const normalize5 = (x: number) => clamp01((x - 1) / 4);

const decayUrgency = (
  lastReviewedAt?: string | null,
  retention?: number
): number => {
  if (typeof retention === "number") return 1 - clamp01(retention);
  if (!lastReviewedAt) return 0.65; // 冷启动：未知知识默认中高复习需求

  const days = Math.max(
    0,
    (Date.now() - new Date(lastReviewedAt).getTime()) / 86_400_000
  );

  // 没有遗忘模型时的温和替代：30天趋近高紧迫度
  return clamp01(days / 30);
};

const phaseWeight = (daysToExam: number) => {
  if (daysToExam <= 45) return { exam: 1.18, weakness: 1.12, difficulty: 0.82 };
  if (daysToExam <= 150) return { exam: 1.08, weakness: 1.05, difficulty: 1.00 };
  return { exam: 0.92, weakness: 0.95, difficulty: 1.12 };
};

/**
 * 0~100
 *
 * 设计原则：
 * 1. “考得多”不等于“今天必须学”，必须和个人薄弱度结合。
 * 2. 临近考试提高 Recent3Y / Recent5Y 权重。
 * 3. 基础阶段适当提高高难度知识的长期建设价值。
 * 4. 没有用户数据时仍能冷启动，但个性化程度较低。
 */
export function calculatePriorityScore(
  e: ExamEvidence,
  u: UserKnowledgeState | undefined,
  ctx: PriorityContext
): number {
  const mastery = u?.mastery ?? 0.50;
  const accuracy = u?.accuracy ?? 0.55;
  const wrongCount = u?.wrongCount ?? 0;

  const weakness =
    0.52 * (1 - clamp01(mastery)) +
    0.38 * (1 - clamp01(accuracy)) +
    0.10 * clamp01(wrongCount / 8);

  const forgetting = decayUrgency(u?.lastReviewedAt, u?.retention);

  const examValue =
    0.38 * normalize5(e.recent3Y.frequency) +
    0.30 * normalize5(e.recent5Y.frequency) +
    0.16 * normalize5(e.allTimeEvidence.frequency) +
    0.10 * normalize5(e.importance) +
    0.06 * clamp01(e.recent5Y.primaryScore / 30);

  const trendBonus =
    e.trend.direction === "rising" ? 1 :
    e.trend.direction === "falling" ? 0.25 :
    e.trend.direction === "stable" ? 0.55 : 0;

  const w = phaseWeight(ctx.daysToExam);

  const score =
    100 * (
      0.37 * examValue * w.exam +
      0.32 * weakness * w.weakness +
      0.16 * forgetting +
      0.07 * normalize5(e.difficulty) * w.difficulty +
      0.05 * trendBonus +
      0.03 * (u?.pinned ? 1 : 0)
    );

  return Math.round(Math.max(0, Math.min(100, score)));
}

export function rankTodayStudyPlan(
  evidence: ExamEvidence[],
  userStates: UserKnowledgeState[],
  ctx: PriorityContext,
  limit = 12
) {
  const userMap = new Map(userStates.map(x => [x.knowledgePointId, x]));

  return evidence
    .map(e => ({
      knowledgePointId: e.knowledgePointId,
      score: calculatePriorityScore(e, userMap.get(e.knowledgePointId), ctx)
    }))
    .sort((a,b) => b.score - a.score)
    .slice(0, limit);
}
