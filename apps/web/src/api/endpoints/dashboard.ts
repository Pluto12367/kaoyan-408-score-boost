import { API_BASE_URL, fetchWithAuth, authenticatedFetch } from '../client';
import {
  buildKnowledgePointIndex,
  buildNodeMasteryMap,
  toLegacyMasteryMap,
  type KnowledgeCatalog,
  type NodeMasteryRow,
} from '@kaoyan408/shared';
import type { FeedbackDraft } from '@kaoyan408/shared';
import { getKnowledgeCatalog } from '../../features/knowledge-catalog/catalogData';
import { fetchMyMastery, type MyNodeMastery } from './score-center';
import type {
  DashboardOverview,
  CanonicalOverview,
  StudentContext,
  TrialProgress,
  StudyReminders,
  SprintPlan,
  MasteryMap,
  LearningProfile,
  PracticeSet,
  ReviewResourceRecommendation,
  AssessmentHistory,
  AssessmentHistoryItem,
  WrongQuestionSummary,
  WrongQuestionFilter,
  StageAssessment,
  WrongQuestion,
  TeacherStudentAuthorization,
  TeacherStudentAuthorizationList,
  FeedbackItem,
  AdminInvitationList,
  CreatedInvitation,
  AdminManagedUser,
  ManagedUserCreationResult,
} from '../types';

// All student-facing endpoints use fetchWithAuth — Phase 1 requires auth on every endpoint.
// userId is no longer passed; the backend extracts it from the JWT token.

export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  const response = await fetchWithAuth(`${API_BASE_URL}/dashboard/overview`);
  if (!response.ok) throw new Error(`Dashboard request failed with ${response.status}`);
  return response.json() as Promise<DashboardOverview>;
}

export async function fetchCanonicalOverview(asOf?: string): Promise<CanonicalOverview> {
  const query = asOf ? `?asOf=${encodeURIComponent(asOf)}` : '';
  const response = await fetchWithAuth(`${API_BASE_URL}/overview/canonical${query}`);
  if (!response.ok) throw new Error(`Canonical overview request failed with ${response.status}`);
  return response.json() as Promise<CanonicalOverview>;
}

/** Canonical, read-only student context for summary consumers. */
export async function fetchStudentContext(asOf?: string): Promise<StudentContext> {
  const query = asOf ? `?asOf=${encodeURIComponent(asOf)}` : '';
  const response = await fetchWithAuth(`${API_BASE_URL}/student-context${query}`);
  if (!response.ok) throw new Error(`Student context request failed with ${response.status}`);
  return response.json() as Promise<StudentContext>;
}

export async function fetchTrialProgress(): Promise<TrialProgress> {
  const response = await fetchWithAuth(`${API_BASE_URL}/trial-progress`);
  if (!response.ok) throw new Error(`Trial progress request failed with ${response.status}`);
  return response.json() as Promise<TrialProgress>;
}

export async function fetchStudyReminders(): Promise<StudyReminders> {
  const response = await fetchWithAuth(`${API_BASE_URL}/study-reminders`);
  if (!response.ok) throw new Error(`Study reminders request failed with ${response.status}`);
  return response.json() as Promise<StudyReminders>;
}

export async function fetchSprintPlan(): Promise<SprintPlan> {
  const response = await fetchWithAuth(`${API_BASE_URL}/sprint-plan`);
  if (!response.ok) throw new Error(`Sprint plan request failed with ${response.status}`);
  return response.json() as Promise<SprintPlan>;
}

// Sprint 2：掌握度地图前端数据源切换——由唯一事实源 UserKnowledgeMastery
// （GET /knowledge/mastery）组装；节点分组复用知识图谱静态目录（catalogData，
// 即 408-codex-handoff 权威树的前端打包版）；展示层复用 shared buildNodeMasteryMap，
// 先构造 canonical node model，再在旧 dashboard 类型边界适配为
// knowledgePointId，避免新链路内部继续伪装 Node ID。
export function buildMasteryMapFromState(
  userId: string,
  mastery: MyNodeMastery,
  catalog: KnowledgeCatalog = getKnowledgeCatalog(),
): MasteryMap {
  const index = buildKnowledgePointIndex(catalog);
  const rows: NodeMasteryRow[] = mastery.items.map((item) => {
    const entry = index[item.knowledgeNodeId];
    return {
      knowledgeNodeId: item.knowledgeNodeId,
      subject: (entry?.subjectName ?? '未分类') as NodeMasteryRow['subject'],
      chapter: entry?.chapterName ?? '',
      title: entry ? entry.point.name : item.knowledgeNodeId,
      importance: entry?.point.importance ?? 3,
      frequency: entry?.point.evidence?.recent5Frequency ?? 0,
      mastery: item.mastery,
      attempts: item.attempts,
      correctCount: item.correctCount,
      wrongCount: item.wrongCount,
      status: item.status,
    };
  });
  const subjectNames = Object.values(catalog).map((subject) => subject.name);
  const canonical = buildNodeMasteryMap({
    userId,
    rows,
    subjects: subjectNames,
    generatedAt: mastery.generatedAt,
  });
  return toLegacyMasteryMap(canonical) as MasteryMap;
}

export async function fetchMasteryMap(userId: string): Promise<MasteryMap> {
  return buildMasteryMapFromState(userId, await fetchMyMastery());
}

export async function fetchLearningProfile(userId: string): Promise<LearningProfile> {
  const response = await fetchWithAuth(`${API_BASE_URL}/students/${encodeURIComponent(userId)}/profile`);
  if (!response.ok) throw new Error(`Learning profile request failed with ${response.status}`);
  return response.json() as Promise<LearningProfile>;
}

export async function fetchRecommendedPracticeSet(): Promise<PracticeSet> {
  const response = await fetchWithAuth(`${API_BASE_URL}/practice-sets/recommended`);
  if (!response.ok) throw new Error(`Recommended practice set request failed with ${response.status}`);
  return response.json() as Promise<PracticeSet>;
}

export async function fetchReviewResourceRecommendations(): Promise<ReviewResourceRecommendation> {
  const response = await fetchWithAuth(`${API_BASE_URL}/review-resources/recommended`);
  if (!response.ok) throw new Error(`Review resources request failed with ${response.status}`);
  return response.json() as Promise<ReviewResourceRecommendation>;
}

export async function fetchAssessmentHistory(): Promise<AssessmentHistory> {
  const response = await fetchWithAuth(`${API_BASE_URL}/assessment-history`);
  if (!response.ok) throw new Error(`Assessment history request failed with ${response.status}`);
  return response.json() as Promise<AssessmentHistory>;
}

export async function importAssessmentHistory(input: {
  title: string;
  score: number;
  totalScore: number;
  occurredAt?: string;
}): Promise<AssessmentHistoryItem> {
  const response = await fetchWithAuth(`${API_BASE_URL}/assessment-history/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Assessment history import failed with ${response.status}`);
  return response.json() as Promise<AssessmentHistoryItem>;
}

export async function fetchWrongQuestionSummary(): Promise<WrongQuestionSummary> {
  const response = await fetchWithAuth(`${API_BASE_URL}/wrong-questions/summary`);
  if (!response.ok) throw new Error(`Wrong question summary request failed with ${response.status}`);
  return response.json() as Promise<WrongQuestionSummary>;
}

export async function fetchWrongQuestions(filters: WrongQuestionFilter = {}): Promise<WrongQuestion[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  const response = await fetchWithAuth(`${API_BASE_URL}/wrong-questions${query ? `?${query}` : ''}`);
  if (!response.ok) throw new Error(`Wrong questions request failed with ${response.status}`);
  return response.json() as Promise<WrongQuestion[]>;
}

export async function fetchStageAssessment(): Promise<StageAssessment> {
  const response = await fetchWithAuth(`${API_BASE_URL}/assessments/stage`);
  if (!response.ok) throw new Error(`Stage assessment request failed with ${response.status}`);
  return response.json() as Promise<StageAssessment>;
}

export async function reviewWrongQuestion(questionId: string): Promise<WrongQuestion> {
  const response = await fetchWithAuth(`${API_BASE_URL}/wrong-questions/${questionId}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  if (!response.ok) throw new Error(`Wrong question review failed with ${response.status}`);
  return response.json() as Promise<WrongQuestion>;
}

export async function submitFeedback(input: FeedbackDraft): Promise<FeedbackItem> {
  const response = await fetchWithAuth(`${API_BASE_URL}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Feedback submission failed with ${response.status}`);
  return response.json() as Promise<FeedbackItem>;
}

// Admin-only endpoints (use authenticatedFetch for auto-refresh)
export async function fetchAdminMetrics() {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/metrics`);
  if (!response.ok) throw new Error(`Admin metrics request failed with ${response.status}`);
  return response.json();
}

export async function fetchAdminUsers() {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/users`);
  if (!response.ok) throw new Error(`Admin users request failed with ${response.status}`);
  return response.json();
}

export async function updateAdminUserTrialStatus(input: { userId: string; trialStatus: string }) {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/users/${input.userId}/trial-status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trialStatus: input.trialStatus }),
  });
  if (!response.ok) throw new Error(`Admin user trial status update failed with ${response.status}`);
  return response.json();
}

export async function fetchAdminInvitations(): Promise<AdminInvitationList> {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/invitations`);
  if (!response.ok) throw new Error(`Admin invitation request failed with ${response.status}`);
  return response.json();
}

export async function createAdminInvitation(input: { label: string; maxUses: number; startsAt?: string; expiresAt: string }): Promise<CreatedInvitation> {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/invitations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Admin invitation creation failed with ${response.status}`);
  return response.json();
}

export async function disableAdminInvitation(invitationId: string) {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/invitations/${encodeURIComponent(invitationId)}/disable`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error(`Admin invitation disable failed with ${response.status}`);
  return response.json();
}

export async function disableAdminUser(userId: string): Promise<AdminManagedUser> {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/users/${encodeURIComponent(userId)}/disable`, { method: 'POST' });
  if (!response.ok) throw new Error(`Admin user disable failed with ${response.status}`);
  return response.json();
}

export async function restoreAdminUser(userId: string): Promise<AdminManagedUser> {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/users/${encodeURIComponent(userId)}/restore`, { method: 'POST' });
  if (!response.ok) throw new Error(`Admin user restore failed with ${response.status}`);
  return response.json();
}

export async function createTemporaryPassword(userId: string): Promise<{ user: AdminManagedUser; temporaryPassword: string }> {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/users/${encodeURIComponent(userId)}/temporary-password`, { method: 'POST' });
  if (!response.ok) throw new Error(`Temporary password request failed with ${response.status}`);
  return response.json();
}

export async function createManagedUser(input: { email: string; name: string; role: 'teacher' | 'admin' }): Promise<ManagedUserCreationResult> {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Managed user creation failed with ${response.status}`);
  return response.json();
}

export async function fetchTeacherStudentAuthorizations(): Promise<TeacherStudentAuthorizationList> {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/teacher-authorizations`);
  if (!response.ok) throw new Error(`Teacher authorization request failed with ${response.status}`);
  return response.json();
}

export async function grantTeacherStudentAuthorization(input: { teacherId: string; studentId: string }): Promise<TeacherStudentAuthorization> {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/teacher-authorizations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Teacher authorization grant failed with ${response.status}`);
  return response.json();
}

export async function revokeTeacherStudentAuthorization(input: { teacherId: string; studentId: string }) {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/teacher-authorizations/${encodeURIComponent(input.teacherId)}/${encodeURIComponent(input.studentId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(`Teacher authorization revoke failed with ${response.status}`);
  return response.json() as Promise<{ revoked: boolean; teacherId: string; studentId: string }>;
}

export async function fetchReviewQueue() {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/review-queue`);
  if (!response.ok) throw new Error(`Review queue request failed with ${response.status}`);
  return response.json();
}

export async function fetchFeedbackList() {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/feedback`);
  if (!response.ok) throw new Error(`Feedback list request failed with ${response.status}`);
  return response.json();
}

export async function approveReviewItem(input: { reviewItemId: string; reviewerId: string }) {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/review-queue/${input.reviewItemId}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reviewerId: input.reviewerId }),
  });
  if (!response.ok) throw new Error(`Review approval failed with ${response.status}`);
  return response.json();
}

export async function markReviewItemNeedsRecheck(input: { reviewItemId: string; reviewerId: string }) {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/review-queue/${input.reviewItemId}/recheck`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reviewerId: input.reviewerId }),
  });
  if (!response.ok) throw new Error(`Review recheck failed with ${response.status}`);
  return response.json();
}

export async function fetchSystemConfig() {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/system-config`);
  if (!response.ok) throw new Error(`System config request failed with ${response.status}`);
  return response.json();
}

export async function updateSystemConfig(input: Record<string, unknown>) {
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/system-config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`System config update failed with ${response.status}`);
  return response.json();
}

export async function fetchTeacherClassAnalytics() {
  const response = await authenticatedFetch(`${API_BASE_URL}/teacher/class-analytics`);
  if (!response.ok) throw new Error(`Teacher class analytics request failed with ${response.status}`);
  return response.json();
}
