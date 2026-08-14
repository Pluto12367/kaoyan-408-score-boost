import { API_BASE_URL, fetchWithAuth } from '../client';

export interface ScoreCenterItem {
  id: string;
  knowledgeNodeId: string | null;
  knowledgePointId: string;
  subject: string;
  title: string;
  score: number | null;
  action: string | null;
  estimatedMinutes: number;
  reasonCodes: string[];
  scoreBreakdown: Record<string, number>;
  rank: number | null;
  status: string;
}

export interface ScoreCenterPlan {
  id: string;
  userId: string;
  generatedAt: string;
  modelVersion: string | null;
  targetExamDate: string | null;
  availableMinutes: number | null;
  stale: boolean;
  summary: {
    totalTasks: number;
    totalMinutes: number;
  };
  items: ScoreCenterItem[];
}

export interface KnowledgeDetail {
  knowledgePoint: {
    id: string;
    name: string;
    subject: string;
    nodeType: string;
    importance: number;
    difficulty: number;
    syllabusVersion: string;
    isActive: boolean;
  };
  frequency: {
    snapshotDate: string;
    recent3Frequency: number;
    recent5Frequency: number;
    allTimeEvidence: number;
    primaryScore5y: number;
    trendDirection: string;
    trendDelta: number;
    evidenceConfidence: string;
    modelVersion: string;
  } | null;
  relations: {
    prerequisites: Array<{ knowledgeNodeId: string }>;
    related: Array<{ knowledgeNodeId: string }>;
    prerequisiteOf: Array<{ knowledgeNodeId: string }>;
  };
  relatedQuestions: Array<{
    id: string;
    stem: string;
    type: string;
    difficulty: string;
    source: string;
    year: number | null;
    expectedTimeSec: number;
  }>;
  examQuestions: Array<{
    id: string;
    exam: string;
    year: number;
    questionNo: number;
    subject: string;
    questionType: string;
    score: number | null;
    summary: string | null;
    sourceUrl: string | null;
  }>;
  userState: {
    mastery: number;
    accuracy: number;
    recentAccuracy: number;
    attempts: number;
    correctCount: number;
    wrongCount: number;
    retention: number | null;
    stabilityDays: number | null;
    lastLearnedAt: string | null;
    lastReviewedAt: string | null;
    nextReviewAt: string | null;
    confidence: number;
    pinned: boolean;
  } | null;
}

export type NodeMasteryStatus = 'untouched' | 'weak' | 'review' | 'mastered';

export interface NodeMasterySummary {
  knowledgeNodeId: string;
  mastery: number;
  accuracy: number;
  recentAccuracy: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  status: NodeMasteryStatus;
  lastLearnedAt: string | null;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
}

export interface MyNodeMastery {
  generatedAt: string;
  items: NodeMasterySummary[];
}

export async function generateScoreCenterPlan(input: {
  targetExamDate: string;
  availableMinutes: 30 | 60 | 120 | 180;
}): Promise<ScoreCenterPlan> {
  const response = await fetchWithAuth(`${API_BASE_URL}/score-center/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Score center plan generation failed with ${response.status}`);
  return response.json() as Promise<ScoreCenterPlan>;
}

export async function fetchKnowledgeDetail(knowledgeNodeId: string): Promise<KnowledgeDetail> {
  const response = await fetchWithAuth(`${API_BASE_URL}/knowledge/${encodeURIComponent(knowledgeNodeId)}`);
  if (!response.ok) throw new Error(`Knowledge detail failed with ${response.status}`);
  return response.json() as Promise<KnowledgeDetail>;
}

export async function fetchMyMastery(): Promise<MyNodeMastery> {
  const response = await fetchWithAuth(`${API_BASE_URL}/knowledge/mastery`);
  if (!response.ok) throw new Error(`Knowledge mastery failed with ${response.status}`);
  return response.json() as Promise<MyNodeMastery>;
}
