# Teacher Class Analytics Design

## Goal

Add a teacher-facing class analytics feature for the 408 score-boost platform. The feature should help teachers understand the class learning situation, identify common weak points, and decide what to teach or assign next.

This is an MVP analytics feature for the current prototype. It does not introduce full class enrollment, real multi-class management, or long-term PostgreSQL persistence yet.

## Scope

The first implementation will cover:

- A backend endpoint that returns class-level analytics for the prototype cohort.
- Derived metrics from existing practice records, reports, tasks, wrong questions, and assessment history.
- A teacher-side panel showing class overview, subject weakness distribution, weak knowledge points, at-risk students, and teaching actions.
- Static fallback data for GitHub Pages.
- Smoke coverage proving the endpoint returns useful teacher analytics.

Out of scope for this step:

- Real class roster creation or student enrollment workflows.
- Teacher-to-student assignment delivery.
- Ranking or public leaderboard features.
- Persistent analytics tables.
- Complex charting libraries.

## User Experience

Teachers should see the class analytics inside the existing teacher area, near question and paper management.

The panel should include:

- Class overview metrics: student count, active student count, average accuracy, completion rate.
- Subject weakness distribution for the four 408 subjects.
- Top weak knowledge points with accuracy and recommended action.
- At-risk student list with reason and next intervention.
- Teaching action suggestions for the next short cycle.

The feature should make the teacher side feel useful beyond editing questions: teachers can see what students are struggling with and decide what to explain, assign, or review next.

## Data Shape

Use a compact object:

```ts
type TeacherClassAnalytics = {
  source: 'memory-api' | 'postgres-ready-api' | 'mock';
  className: string;
  generatedAt: string;
  overview: {
    studentCount: number;
    activeStudentCount: number;
    averageAccuracyRate: number;
    averageCompletionRate: number;
    pendingWrongQuestionCount: number;
  };
  subjectWeakness: Array<{
    subject: string;
    weakPointCount: number;
    averageMastery: number;
    recommendation: string;
  }>;
  weakKnowledgePoints: Array<{
    knowledgePointId: string;
    title: string;
    subject: string;
    accuracyRate: number;
    wrongCount: number;
    recommendedAction: string;
  }>;
  atRiskStudents: Array<{
    userId: string;
    name: string;
    riskType: string;
    reason: string;
    nextAction: string;
  }>;
  teachingActions: string[];
};
```

## Backend Design

Add `GET /teacher/class-analytics` in the study controller. It can be unauthenticated for the current prototype, matching other study analytics endpoints. The teacher-only question management route already demonstrates role permissions; this endpoint focuses on data shape and learning insight first.

In `StudyService`, add `getTeacherClassAnalytics()`. It should derive values from existing data:

- `getOverviewReport()` for average accuracy and weak points.
- `generatePlan()` for completion rate.
- `getMasteryMap()` for subject weakness distribution.
- `listWrongQuestions()` for pending wrong question count.
- `getAssessmentHistory()` for assessment trend risk.

The prototype has one student, so `studentCount` and `activeStudentCount` can be `1`. The design should still use plural-friendly arrays so a future PostgreSQL implementation can aggregate many students.

## Frontend Design

Add API helpers:

- `fetchTeacherClassAnalytics()`
- `createMockTeacherClassAnalytics()`

Add React state:

- `teacherClassAnalytics`

Render a teacher panel titled `班级学情分析`. It should show overview metrics first, then weak subjects, risk students, and teaching actions. The panel should use the existing dashboard visual language: compact grids, small repeated rows, and restrained colors.

If the backend is unavailable, use mock data so the GitHub Pages static demo still shows the feature.

## Error Handling

- If analytics fetch fails, keep mock analytics and keep the page usable.
- If derived data is sparse, return empty arrays with a teaching action that asks the teacher to collect more practice or assessment records.
- Avoid blocking teacher question management if analytics is unavailable.

## Tests

Update `scripts/smoke-migration.mjs` to verify:

- `GET /teacher/class-analytics` returns class overview metrics.
- It includes subject weakness data for 408 subjects.
- It includes weak knowledge points.
- It includes at-risk students or teaching actions.

Existing verification should still pass:

- `npm test`
- `npm run smoke:migration`

## Review Notes

This design intentionally avoids building a full LMS analytics system. The immediate value is teacher decision support: what is weak, who needs intervention, and what should be taught or assigned next.
