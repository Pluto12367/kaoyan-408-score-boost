export type ContextualCoachContextType = 'question' | 'wrong_question' | 'knowledge_node' | 'assessment';

export type ContextualCoachRequest =
  | { contextType: 'question'; questionId: string; selectedAnswer?: string; message?: string }
  | { contextType: 'wrong_question'; questionId: string; message?: string }
  | { contextType: 'knowledge_node'; knowledgeNodeId: string; message?: string }
  | { contextType: 'assessment'; assessmentId?: string; message?: string };

export interface ContextualCoachContext {
  version: 'contextual-coach-v1';
  context: { type: ContextualCoachContextType; id: string | null };
  student: {
    goal: {
      targetScore: number | null;
      currentScore: number | null;
      dailyHours: number | null;
      remainingDays: number | null;
      stage: string | null;
      weakestSubject: string | null;
    };
    masterySummary: Record<string, unknown>;
    weakPoints: Array<Record<string, unknown>>;
  };
  focus: Record<string, unknown>;
  currentTasks: Array<Record<string, unknown>>;
  assembledAt: string;
}

export interface ContextualCoachDraft {
  summary: string;
  replySteps: string[];
  misconceptionTips: string[];
  reviewCards: Array<{ id: string; type: 'concept' | 'rule' | 'confusion'; title: string; content: string; nextAction: string }>;
  nextActions: string[];
}

export interface ContextualCoachResponse extends ContextualCoachDraft {
  contextType: ContextualCoachContextType;
  contextId: string | null;
  source: string;
  assembledAt: string;
  fallbackReason?: string;
}
