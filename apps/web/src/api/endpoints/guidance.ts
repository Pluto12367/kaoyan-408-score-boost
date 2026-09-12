import { API_BASE_URL, fetchWithAuth } from '../client';
import type { BehaviorSignal } from '@kaoyan408/shared';

/**
 * G1.6 — the one new read added by G1 (behaviour patterns for the guardrails).
 * G1.8 — the exam-date writer.
 *
 * Both are thin: all detection and all derivation live in the shared pure
 * modules, so the client never re-implements a threshold.
 */

export interface PracticePatternResponse {
  userId: string;
  generatedAt: string;
  storeAvailable: boolean;
  reason?: string;
  windowDays: number;
  signals: BehaviorSignal[];
  basis: {
    attempts: number;
    sessions: number;
    probeExpired: number;
    probeEvents: number;
    assessments: number;
  };
}

export async function fetchPracticePatterns(): Promise<PracticePatternResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/coach/practice-patterns`);
  if (!response.ok) throw new Error(`加载学习行为检测失败（${response.status}）`);
  return response.json() as Promise<PracticePatternResponse>;
}

export interface ExamDateResponse {
  storeAvailable: boolean;
  reason?: string;
  examDate: string | null;
  remainingDays: number | null;
  daysLabel: string | null;
  source: 'exam_date' | 'unset';
}

export async function saveExamDate(examDate: string | null): Promise<ExamDateResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/coach/exam-date`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ examDate }),
  });
  if (!response.ok) {
    let message = `保存考试日期失败（${response.status}）`;
    try {
      const payload = (await response.json()) as { message?: string | string[] };
      const detail = Array.isArray(payload.message) ? payload.message.join('；') : payload.message;
      if (detail) message = detail;
    } catch {
      // keep the status-derived message
    }
    throw new Error(message);
  }
  return response.json() as Promise<ExamDateResponse>;
}
