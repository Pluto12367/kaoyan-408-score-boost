# Student Assessment History Design

## Goal

Add a student-facing assessment history feature for the 408 score-boost platform. The feature should help students compare recent mock exam or stage assessment attempts, understand whether they are improving, and know what to review next.

This is not a full exam archive system yet. It is a focused MVP: recent assessment records, review suggestions, and a simple trend summary.

## Scope

The first implementation will cover:

- A recent assessment history data object.
- A backend endpoint that returns recent assessment history.
- Paper submission logic that adds the latest attempt to the history.
- A student-side "测评历史" panel in the React app.
- Static demo fallback data for GitHub Pages.
- Smoke coverage proving that a submitted paper creates a history entry.

Out of scope for this step:

- User ranking, class ranking, or public leaderboards.
- Long-term persistent PostgreSQL storage.
- Full charting libraries.
- Multiple real user accounts beyond the current prototype identity.

## User Experience

Students should see a compact history area after the paper or report sections. Each record shows:

- Assessment name.
- Submitted time.
- Score and accuracy rate.
- Time used.
- Unanswered count.
- Main weak point.
- Next review suggestion.

The top of the panel includes a trend summary:

- Number of recent attempts.
- Best score.
- Latest accuracy.
- Whether the latest result improved compared with the previous attempt.

The panel should feel like part of the score improvement loop: finish assessment, review record, practice weak point, then take another assessment.

## Data Shape

Use a compact object:

```ts
type AssessmentHistoryItem = {
  id: string;
  title: string;
  submittedAt: string;
  score: number;
  totalScore: number;
  accuracyRate: number;
  elapsedSec: number;
  unansweredCount: number;
  weakPointTitle: string;
  reviewSuggestion: string;
};
```

The response can include derived summary data:

```ts
type AssessmentHistory = {
  items: AssessmentHistoryItem[];
  summary: {
    attemptCount: number;
    bestScore: number;
    latestAccuracyRate: number;
    improvementText: string;
  };
};
```

## Backend Design

Add a `GET /assessment-history` endpoint in the study area. It returns the in-memory history for the prototype student.

Update the existing paper submission flow so a successful paper submission creates a new history item. The item should use the paper score, elapsed time, unanswered count, and current weakest knowledge point from the report.

For the prototype, the history can remain in memory. Later, this maps cleanly to PostgreSQL with a table such as `assessment_attempts`.

## Frontend Design

Add API helpers:

- `fetchAssessmentHistory()`
- `createMockAssessmentHistory()`

Add state to `App.tsx`:

- `assessmentHistory`
- refresh after paper submission

Render a student panel titled `测评历史`. It should show the trend summary and the most recent records. The latest record should be easy to spot.

If the backend is unavailable, use static demo history so GitHub Pages still demonstrates the flow.

## Error Handling

- If history fetch fails, keep the static fallback history and avoid breaking the page.
- If paper submission succeeds but history refresh fails, show the paper result normally and leave existing history visible.
- Empty history should show a friendly empty state encouraging the student to complete a mock paper.

## Tests

Update `scripts/smoke-migration.mjs` to verify:

- `GET /assessment-history` returns an item list and summary.
- Submitting a paper increases the history count.
- The newest history item contains score, accuracy rate, elapsed time, unanswered count, and a review suggestion.

Existing unit and migration smoke tests should still pass:

- `npm test`
- `npm run smoke:migration`

## Review Notes

This design intentionally avoids a large exam archive system. The immediate value is student review and iteration. Ranking, charts, persistent storage, and multi-student comparisons can be added after the current score improvement loop is stable.
