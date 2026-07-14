import { API_BASE_URL, fetchWithAuth } from '../client';
import type { Subject } from '@kaoyan408/shared';
import type { GeneratedPaper } from '../types';

export interface PrepareExamPaperInput {
  paperType: '模拟卷' | '专项卷';
  subject?: Subject;
  questionCount: number;
}

export interface ExamReport {
  sessionId: string; userId: string; generatedAt: string;
  summary: {
    totalQuestions: number; answeredCount: number; unansweredCount: number;
    correctCount: number; accuracyRate: number; totalTimeSec: number;
    timeLimitSec: number; overtime: boolean;
    objectiveQuestionCount: number; objectiveCorrectCount: number; objectiveAccuracyRate: number;
    subjectiveQuestionCount: number; subjectiveEarnedScore: number; subjectiveMaxScore: number; subjectiveScoreRate: number;
  };
  subjectBreakdown: Array<{
    subject: string; totalQuestions: number; correctCount: number;
    accuracyRate: number; avgTimeSec: number;
  }>;
  knowledgePointLosses: Array<{ title: string; subject: string; wrongCount: number }>;
  unansweredQuestions: Array<{ questionId: string; stem: string }>;
}

export interface PostExamReviewTasks {
  userId: string; examSessionId: string; generatedAt: string;
  examAccuracyRate: number; weakPointTitles: string[];
  days: Array<{
    dayIndex: number; date: string; focus: string; subject: string;
    questionCount: number; minutes: number; tasks: string[];
  }>;
  recommendation: string;
}

export interface ScoreHistory {
  userId: string; totalExams: number; latestAccuracyRate: number;
  trend: number; trendLabel: string;
  history: Array<{
    sessionId: string; date: string; totalQuestions: number;
    correctCount: number; accuracyRate: number; totalTimeMin: number;
  }>;
}

export async function fetchExamReport(sessionId: string): Promise<ExamReport> {
  const response = await fetchWithAuth(`${API_BASE_URL}/exam/report/${sessionId}`);
  if (!response.ok) throw new Error(`Exam report failed with ${response.status}`);
  return response.json() as Promise<ExamReport>;
}

export async function generatePostExamReviewTasks(sessionId: string): Promise<PostExamReviewTasks> {
  const response = await fetchWithAuth(`${API_BASE_URL}/exam/review-tasks/${sessionId}`, { method: 'POST' });
  if (!response.ok) throw new Error(`Post-exam review tasks failed with ${response.status}`);
  return response.json() as Promise<PostExamReviewTasks>;
}

export async function fetchScoreHistory(): Promise<ScoreHistory> {
  const response = await fetchWithAuth(`${API_BASE_URL}/exam/score-history`);
  if (!response.ok) throw new Error(`Score history failed with ${response.status}`);
  return response.json() as Promise<ScoreHistory>;
}

export async function prepareExamPaper(input: PrepareExamPaperInput): Promise<GeneratedPaper> {
  const response = await fetchWithAuth(`${API_BASE_URL}/exam/papers/prepare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    let message = `试卷准备失败（${response.status}）`;
    try {
      const payload = await response.json() as { message?: string | string[] };
      if (typeof payload.message === 'string') message = payload.message;
      if (Array.isArray(payload.message)) message = payload.message.join('；');
    } catch { /* keep the status-based fallback */ }
    throw new Error(message);
  }
  return response.json() as Promise<GeneratedPaper>;
}
