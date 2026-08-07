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
