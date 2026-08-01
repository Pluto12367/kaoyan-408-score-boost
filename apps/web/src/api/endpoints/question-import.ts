import { API_BASE_URL, authenticatedFetch } from '../client';
import type { QuestionImportBatch, QuestionImportBatchSummary, QuestionImportCandidate, QuestionImportCandidateStatus } from '../types';

export interface CreateImportMetadata { source: string; rightsConfirmed: boolean; title?: string; year?: number; defaultSubject?: string; defaultChapter?: string; pageRange?: string; provider?: string; }
type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

async function expectJson<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  const requestId = response.headers.get('x-request-id');
  let message = `请求失败 (${response.status})`;
  try { message = String((await response.json() as { message?: string }).message ?? message); } catch { /* keep status */ }
  throw new Error(requestId ? `${message}（请求 ID: ${requestId}）` : message);
}

export async function createQuestionImport(file: File, metadata: CreateImportMetadata) {
  const body = new FormData();
  body.append('file', file); body.append('source', metadata.source); body.append('rightsConfirmed', String(metadata.rightsConfirmed));
  (['title', 'year', 'defaultSubject', 'defaultChapter', 'pageRange', 'provider'] as const).forEach((key) => { if (metadata[key] !== undefined) body.append(key, String(metadata[key])); });
  return expectJson<{ batchId: string; status: string }>(await authenticatedFetch(`${API_BASE_URL}/admin/question-imports`, { method: 'POST', body }));
}
export const listQuestionImports = async () => expectJson<Page<QuestionImportBatchSummary>>(await authenticatedFetch(`${API_BASE_URL}/admin/question-imports`));
export const getQuestionImport = async (batchId: string) => expectJson<QuestionImportBatch>(await authenticatedFetch(`${API_BASE_URL}/admin/question-imports/${batchId}`));
export const listImportCandidates = async (batchId: string, status?: QuestionImportCandidateStatus) => expectJson<Page<QuestionImportCandidate>>(await authenticatedFetch(`${API_BASE_URL}/admin/question-imports/${batchId}/candidates${status ? `?status=${status}` : ''}`));
export const updateImportCandidate = async (id: string, revision: number, patch: Record<string, unknown>) => expectJson<QuestionImportCandidate>(await authenticatedFetch(`${API_BASE_URL}/admin/question-imports/candidates/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, patch }) }));
export const bulkApproveImportCandidates = async (batchId: string, candidates: Array<{ id: string; revision: number }>) => expectJson<{ approvedCandidates: number }>(await authenticatedFetch(`${API_BASE_URL}/admin/question-imports/${batchId}/candidates/bulk-approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidates }) }));
export const confirmQuestionImport = async (batchId: string, candidateIds: string[], idempotencyKey: string) => expectJson<{ importedCount: number; skippedCount: number; candidateIds: string[] }>(await authenticatedFetch(`${API_BASE_URL}/admin/question-imports/${batchId}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateIds, idempotencyKey }) }));
