import { API_BASE_URL, fetchWithAuth } from '../client';

/**
 * PHASE 10 (frontend consumption) — read-only fetchers for the four learning
 * insight projections. Thin by design: every field and threshold already lives
 * server-side; the client only renders what the API states (no re-derivation,
 * no local fallbacks).
 *
 * All four are GETs against the coach family. Failures throw so the caller can
 * show an explicit message (AGENTS §4: no silent mock fallback).
 */

export async function fetchErrorDiagnosis(days = 7): Promise<unknown> {
  const response = await fetchWithAuth(`${API_BASE_URL}/coach/error-diagnosis?days=${days}`);
  if (!response.ok) throw new Error(`加载错因诊断失败（${response.status}）`);
  return response.json();
}

export async function fetchTrainingPrescription(days = 7): Promise<unknown> {
  const response = await fetchWithAuth(`${API_BASE_URL}/coach/training-prescription?days=${days}`);
  if (!response.ok) throw new Error(`加载训练处方失败（${response.status}）`);
  return response.json();
}

export async function fetchForgettingRisk(): Promise<unknown> {
  const response = await fetchWithAuth(`${API_BASE_URL}/coach/forgetting-risk`);
  if (!response.ok) throw new Error(`加载遗忘风险失败（${response.status}）`);
  return response.json();
}

export async function fetchScoreRecovery(days = 30): Promise<unknown> {
  const response = await fetchWithAuth(`${API_BASE_URL}/coach/score-recovery?days=${days}`);
  if (!response.ok) throw new Error(`加载失分恢复失败（${response.status}）`);
  return response.json();
}
