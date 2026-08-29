// StageAssessmentSnapshot is a read-only fact projection for the stage
// assessment read model. It deliberately does NOT model the legacy DTO or
// the selection strategy. It only aggregates facts needed to drive a later
// selector/adapter layer.
//
// Fact-source boundaries:
// - assessmentFacts: AssessmentProjectionService / assessment history facts
// - studentFacts: StudentStateProjectionService goal facts (stage, target)
// - masteryFacts: StudentState mastery summary + weak point facts
// - practiceFacts: PracticeProjectionService recent practice statistics
// - wrongQuestionFacts: WrongQuestionProjectionService summary/due facts
// - questionPoolFacts: question catalog / knowledge point catalog candidate facts
//
// It must NOT contain:
// - recommendation / nextAction / reason
// - difficultySuggestion / selectedQuestions / focusKnowledgePoints
// - title / description / estimatedMinutes / id
// - any UI copy or selection result

export interface StageAssessmentSnapshot {
  source: 'stage_assessment_facts';
  userId: string;
  asOf: string;
  studentFacts: {
    stage: string | null;
    targetScore: number | null;
  };
  assessmentFacts: {
    attemptCount: number;
    bestScore: number | null;
    latestScore: number | null;
    latestAccuracyRate: number | null;
    lastAssessmentAt: string | null;
  };
  masteryFacts: {
    source: 'user_knowledge_mastery' | 'empty';
    averageMastery: number;
    weakCount: number;
    reviewCount: number;
    masteredCount: number;
    weakPoints: StageAssessmentWeakPointFact[];
  };
  practiceFacts: {
    totalCount: number;
    todayCount: number;
    accuracy: number;
    lastPracticeAt: string | null;
  };
  wrongQuestionFacts: {
    total: number;
    unresolved: number;
    resolved: number;
    dueCount: number;
    latestWrongAt: string | null;
  };
  questionPoolFacts: {
    knowledgePoints: StageAssessmentKnowledgePointFact[];
    questions: StageAssessmentQuestionFact[];
  };
}

export interface StageAssessmentWeakPointFact {
  knowledgeNodeId: string;
  subject: string;
  chapter: string;
  title: string;
  masteryRate: number;
  accuracyRate: number;
}

export interface StageAssessmentKnowledgePointFact {
  id: string;
  subject: string;
  chapter: string;
  title: string;
  importance: number;
}

export interface StageAssessmentQuestionFact {
  id: string;
  stem: string;
  difficulty: string;
  type: string;
  source: string | null;
  year: number | null;
  knowledgePointIds: string[];
  expectedTimeSec: number;
}

export interface BuildStageAssessmentSnapshotInput {
  userId: string;
  asOf: Date | string;
  studentFacts?: StageAssessmentSnapshot['studentFacts'];
  assessmentFacts?: StageAssessmentSnapshot['assessmentFacts'];
  masteryFacts?: StageAssessmentSnapshot['masteryFacts'];
  practiceFacts?: StageAssessmentSnapshot['practiceFacts'];
  wrongQuestionFacts?: StageAssessmentSnapshot['wrongQuestionFacts'];
  questionPoolFacts?: StageAssessmentSnapshot['questionPoolFacts'];
}

export function buildStageAssessmentSnapshot(input: BuildStageAssessmentSnapshotInput): StageAssessmentSnapshot {
  return {
    source: 'stage_assessment_facts',
    userId: input.userId,
    asOf: toIso(input.asOf),
    studentFacts: input.studentFacts ?? emptyStudentFacts(),
    assessmentFacts: input.assessmentFacts ?? emptyAssessmentFacts(),
    masteryFacts: input.masteryFacts ?? emptyMasteryFacts(),
    practiceFacts: input.practiceFacts ?? emptyPracticeFacts(),
    wrongQuestionFacts: input.wrongQuestionFacts ?? emptyWrongQuestionFacts(),
    questionPoolFacts: input.questionPoolFacts ?? emptyQuestionPoolFacts(),
  };
}

function emptyStudentFacts(): StageAssessmentSnapshot['studentFacts'] {
  return { stage: null, targetScore: null };
}

function emptyAssessmentFacts(): StageAssessmentSnapshot['assessmentFacts'] {
  return { attemptCount: 0, bestScore: null, latestScore: null, latestAccuracyRate: null, lastAssessmentAt: null };
}

function emptyMasteryFacts(): StageAssessmentSnapshot['masteryFacts'] {
  return { source: 'empty', averageMastery: 0, weakCount: 0, reviewCount: 0, masteredCount: 0, weakPoints: [] };
}

function emptyPracticeFacts(): StageAssessmentSnapshot['practiceFacts'] {
  return { totalCount: 0, todayCount: 0, accuracy: 0, lastPracticeAt: null };
}

function emptyWrongQuestionFacts(): StageAssessmentSnapshot['wrongQuestionFacts'] {
  return { total: 0, unresolved: 0, resolved: 0, dueCount: 0, latestWrongAt: null };
}

function emptyQuestionPoolFacts(): StageAssessmentSnapshot['questionPoolFacts'] {
  return { knowledgePoints: [], questions: [] };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}