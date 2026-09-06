import { API_BASE_URL, fetchWithAuth } from '../client';

export interface MasteryTrendPoint {
  date: string;
  /** Percent for days WITH snapshots; null = no snapshot that day. */
  averageMastery: number | null;
}

export interface NodeTrendSeries {
  knowledgeNodeId: string;
  title: string;
  chapter: string;
  mastery: number;
  series: MasteryTrendPoint[];
}

export interface MasteryTrendSubject {
  subject: string;
  averageMastery: number;
  series: MasteryTrendPoint[];
  weakestNodes: NodeTrendSeries[];
}

export interface MasteryTrendDelta {
  knowledgeNodeId: string;
  title: string;
  delta: number;
}

export interface MasteryTrend {
  userId: string;
  days: number;
  generatedAt: string;
  overall: MasteryTrendPoint[];
  subjects: MasteryTrendSubject[];
  improving: MasteryTrendDelta[];
  declining: MasteryTrendDelta[];
}

export async function fetchMasteryTrend(days = 14): Promise<MasteryTrend> {
  const response = await fetchWithAuth(`${API_BASE_URL}/mastery-trend?days=${days}`);
  if (!response.ok) throw new Error(`Mastery trend failed with ${response.status}`);
  return response.json() as Promise<MasteryTrend>;
}
