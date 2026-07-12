import { API_BASE_URL, fetchWithAuth, authenticatedFetch } from '../client';
import type {
  DashboardOverview,
  TrialProgress,
  StudyReminders,
  SprintPlan,
  MasteryMap,
  LearningProfile,
  PracticeSet,
  ReviewResourceRecommendation,
  AssessmentHistory,
  WrongQuestionSummary,
  StageAssessment,
  WrongQuestion,
} from '../types';

// All student-facing endpoints use fetchWithAuth — Phase 1 requires auth on every endpoint.
// userId is no longer passed; the backend extracts it from the JWT token.

export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  const response = await fetchWithAuth(`${API_BASE_URL}/dashboard/overview`);
  if (!response.ok) throw new Error(`Dashboard request failed with ${response.status}`);
  return response.json() as Promise<DashboardOverview>;
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

export async function fetchMasteryMap(): Promise<MasteryMap> {
  const response = await fetchWithAuth(`${API_BASE_URL}/mastery-map`);
  if (!response.ok) throw new Error(`Mastery map request failed with ${response.status}`);
  return response.json() as Promise<MasteryMap>;
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

export async function fetchWrongQuestionSummary(): Promise<WrongQuestionSummary> {
  const response = await fetchWithAuth(`${API_BASE_URL}/wrong-questions/summary`);
  if (!response.ok) throw new Error(`Wrong question summary request failed with ${response.status}`);
  return response.json() as Promise<WrongQuestionSummary>;
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

export async function submitFeedback(input: { rating: number; scene: string; message: string; surveyUrl?: string }) {
  const response = await fetchWithAuth(`${API_BASE_URL}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Feedback submission failed with ${response.status}`);
  return response.json();
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
