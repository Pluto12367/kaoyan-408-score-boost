import { API_BASE_URL, fetchWithAuth } from '../client';

export interface ExamReport {
  sessionId: string; userId: string; generatedAt: string;
  summary: {
    totalQuestions: number; answeredCount: number; unansweredCount: number;
    correctCount: number; accuracyRate: number; totalTimeSec: number;
    timeLimitSec: number; overtime: boolean;
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
