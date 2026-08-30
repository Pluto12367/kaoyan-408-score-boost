export interface UserKnowledgeMastery {
  userId: string;
  knowledgePointId: string;

  mastery: number;        // 0~1
  accuracy: number;       // 0~1

  attempts: number;
  correctCount: number;
  wrongCount: number;

  lastLearnedAt?: Date;
  lastReviewedAt?: Date;

  // 由 FSRS / SM-2 / 自研模型产生
  retention?: number;     // 0~1
  stabilityDays?: number;
  nextReviewAt?: Date;

  updatedAt: Date;
}

export interface WrongQuestionRecord {
  userId: string;
  questionId: string;
  knowledgePointIds: string[];

  wrongReason:
    | "concept"
    | "calculation"
    | "memory"
    | "reading"
    | "careless"
    | "unknown";

  firstWrongAt: Date;
  lastWrongAt: Date;
  wrongCount: number;
  resolved: boolean;
}

export interface DailyStudyRecommendation {
  userId: string;
  knowledgePointId: string;
  priorityScore: number;
  reasons: string[];

  recommendedAction:
    | "learn"
    | "review"
    | "practice"
    | "wrong-question"
    | "mock";

  estimatedMinutes: number;
  generatedForDate: string;
}
