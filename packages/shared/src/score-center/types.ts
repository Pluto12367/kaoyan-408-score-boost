export type MasteryState = {
  mastery: number;
  accuracy: number;
  recentAccuracy: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  confidence: number;
};

export type AttemptSignal = {
  isCorrect: boolean;
  difficulty: 1 | 2 | 3 | 4 | 5;
  role: 'PRIMARY' | 'SECONDARY';
};

export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

export type PriorityReasonCode =
  | 'HIGH_RECENT_FREQUENCY'
  | 'LOW_MASTERY'
  | 'LOW_ACCURACY'
  | 'REPEATED_WRONG'
  | 'REVIEW_DUE'
  | 'RISING_TREND'
  | 'PREREQUISITE_GAP'
  | 'EXAM_NEAR'
  | 'LOW_EVIDENCE';

export type TrendDirection = 'RISING' | 'STABLE' | 'FALLING' | 'COLD';

export type EvidenceConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type ExamEvidence = {
  knowledgePointId: string;
  importance: number;
  difficulty: number;
  recent3Y: { frequency: number };
  recent5Y: {
    frequency: number;
    primaryCount?: number;
    secondaryCount?: number;
    primaryScore?: number;
  };
  allTimeEvidence: { frequency: number };
  trend: { direction: TrendDirection; delta: number };
  evidenceConfidence: EvidenceConfidence;
};

export type UserKnowledgeState = MasteryState & {
  retention?: number | null;
  forgetting?: number;
  pinned?: boolean;
};

export type PriorityContext = {
  daysToExam: number;
};

export type PriorityBreakdown = {
  examValue: number;
  weakness: number;
  forgetting: number;
  difficulty: number;
  trend: number;
  pinned: number;
};

export type PriorityResult = {
  score: number;
  reasons: PriorityReasonCode[];
  breakdown: PriorityBreakdown;
};

// ---- Recommendation Engine v1 ----
// 契约冻结：docs/sprint3-recommendation-contract.md
// ID 规范：Engine 内部唯一 ID 为 knowledgeNodeId；knowledgePointId 禁止出现。

export type RecommendationNodeState = {
  knowledgeNodeId: string;
  mastery: number;
  accuracy: number;
  recentAccuracy: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  retention: number | null;
  stabilityDays: number | null;
  lastReviewedAt: string | null;
  pinned: boolean;
};

// 内容侧真题证据：沿用 ExamEvidence 数值口径，剔除 knowledgePointId 字段（契约 §1），
// 补充 subject（KnowledgeNode 的所属科目，科目配额需要）。
export type RecommendationExamEvidence = Omit<ExamEvidence, 'knowledgePointId'> & {
  subject: string;
};

export type RecommendationInput = {
  meta: {
    userId: string;
    now: string;
    generatedAt: string;
  };
  student: {
    goal: {
      stage: string | null;
      targetScore: number | null;
      currentScore: number | null;
      remainingDays: number | null;
      dailyHours: number | null;
    };
    nodeStates: RecommendationNodeState[];
    reviewSummary: { dueCount: number; overdueCount: number };
  };
  content: {
    evidence: Record<string, RecommendationExamEvidence>;
    prerequisites: Record<string, string[]>;
    prerequisiteMastery: Record<string, number>;
  };
  config: {
    availableMinutes: 30 | 60 | 120 | 180;
    daysToExam: number;
    maxItems?: number;
  };
};

export type RecommendationFocus =
  | '真题错题回炉训练'
  | '高频基础考点补强'
  | '薄弱专题突破';

export type RecommendationItem =
  | {
      kind: 'KNOWLEDGE';
      knowledgeNodeId: string;
      score: number;
      action: RecommendationAction;
      estimatedMinutes: number;
      reasonCodes: PriorityReasonCode[];
      facts: { mastery: number; attempts: number; wrongCount: number };
    }
  | {
      kind: 'REVIEW';
      knowledgeNodeId: string;
      score: number;
      reasonCodes: PriorityReasonCode[];
      facts: { stabilityDays: number | null; retention: number | null; nextReviewAt: string | null };
    }
  | {
      kind: 'QUESTION_SET';
      knowledgeNodeId: string;
      score: number;
      questionCount: number;
      focus: RecommendationFocus;
      reasonCodes: PriorityReasonCode[];
    }
  | {
      kind: 'TASK_DRAFT';
      knowledgeNodeId: string;
      score: number;
      action: RecommendationAction;
      estimatedMinutes: number;
      scheduledDate: string;
      reasonCodes: PriorityReasonCode[];
    };

export type RecommendationResult = {
  userId: string;
  generatedAt: string;
  source: 'recommendation_engine_v1';
  items: RecommendationItem[];
};

// 行动类型唯一定义（原 plan.ts 内联定义上移，plan.ts 改为从此处导入）
export type RecommendationAction =
  | 'LEARN'
  | 'REVIEW'
  | 'PRACTICE'
  | 'WRONG_QUESTION'
  | 'MOCK';
