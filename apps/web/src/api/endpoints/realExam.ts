// V14-R4-A — real-exam presentation endpoints (read-only projections).
// Task book: docs/v14-r4-presentation-design.md §3. Failures throw explicitly —
// no silent fallback to demo data (AGENTS.md §4).

import { API_BASE_URL, fetchWithAuth } from '../client';

export interface RealExamBoardSlot {
  examNo: number;
  questionId: string | null;
  subject: string | null;
  questionSubtype: string | null;
  maxScore: number | null;
  status: 'correct' | 'wrong' | 'unanswered' | null;
}

export interface RealExamBoard {
  year: number;
  storeAvailable: boolean;
  slots: RealExamBoardSlot[];
  summary: { total: number; answeredCount: number; correctCount: number; wrongCount: number; totalScore: number };
  novelKps: Array<{ knowledgeNodeId: string; name: string }>;
  returningKps: Array<{ knowledgeNodeId: string; name: string; lastYear: number }>;
}

export interface RealExamDashboard {
  storeAvailable: boolean;
  years: Array<{ year: number; count: number }>;
  totalQuestions: number;
  knowledgePointsTested: number;
  knowledgePointsTotal: number;
  coveragePct: number | null;
  topKps: Array<{ knowledgeNodeId: string; name: string; score5y: number; allTime: number; yearsTested: number }>;
}

export interface RealExamFrequency {
  storeAvailable: boolean;
  subject: string | null;
  levels: { high: number; mid: number; low: number; cold: number };
  rows: Array<{ knowledgeNodeId: string; name: string; subject: string; yearsTested: number; totalScore: number; lastYear: number | null }>;
}

export interface RealExamUncovered {
  storeAvailable: boolean;
  total: number;
  nodes: Array<{ knowledgeNodeId: string; name: string; subject: string; chapter: string | null }>;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetchWithAuth(`${API_BASE_URL}${path}`);
  if (!response.ok) throw new Error(`请求失败（${response.status}）`);
  return response.json() as Promise<T>;
}

export function fetchRealExamBoard(year: number): Promise<RealExamBoard> {
  return getJson<RealExamBoard>(`/coach/real-exam-board?year=${year}`);
}

export function fetchRealExamDashboard(): Promise<RealExamDashboard> {
  return getJson<RealExamDashboard>('/coach/real-exam-dashboard');
}

export function fetchRealExamFrequency(subject?: string): Promise<RealExamFrequency> {
  const suffix = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  return getJson<RealExamFrequency>(`/coach/real-exam-frequency${suffix}`);
}

export function fetchRealExamUncovered(): Promise<RealExamUncovered> {
  return getJson<RealExamUncovered>('/coach/real-exam-uncovered');
}

export interface RealExamChapterMap {
  storeAvailable: boolean;
  yearAxis: number[];
  chapters: Array<{ chapter: string; subject: string; years: Record<number, number> }>;
}

export interface RealExamTrajectory {
  storeAvailable: boolean;
  currentYear: number;
  rows: Array<{ knowledgeNodeId: string; name: string; subject: string; yearsTested: number; totalScore: number; lastYear: number }>;
}

export interface RealExamHardQuestions {
  storeAvailable: boolean;
  minAttempts: number;
  total: number;
  rows: Array<{
    questionId: string;
    year: number | null;
    examNo: number | null;
    subject: string | null;
    stemPreview: string;
    attempts: number;
    wrong: number;
    wrongRatePct: number;
  }>;
}

export function fetchRealExamChapters(): Promise<RealExamChapterMap> {
  return getJson<RealExamChapterMap>('/coach/real-exam-chapters');
}

export function fetchRealExamTrajectory(): Promise<RealExamTrajectory> {
  return getJson<RealExamTrajectory>('/coach/real-exam-trajectory');
}

export function fetchRealExamHardQuestions(): Promise<RealExamHardQuestions> {
  return getJson<RealExamHardQuestions>('/coach/real-exam-hard');
}
