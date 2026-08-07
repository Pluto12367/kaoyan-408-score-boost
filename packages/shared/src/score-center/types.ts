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
