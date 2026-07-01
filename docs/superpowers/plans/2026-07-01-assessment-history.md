# Assessment History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a student-facing assessment history loop that records recent paper submissions and shows review suggestions.

**Architecture:** Keep the MVP in the existing NestJS memory service and React prototype. The backend owns scoring-derived history, while the frontend fetches it with a static fallback for GitHub Pages.

**Tech Stack:** NestJS, React, TypeScript, Vite, existing smoke migration script.

---

## File Structure

- Modify `scripts/smoke-migration.mjs`: add assertions that history exists and grows after paper submission.
- Modify `apps/api/src/study/study.controller.ts`: add `GET /assessment-history`.
- Modify `apps/api/src/study/study.service.ts`: add in-memory history, summary builder, and paper-submit history append.
- Modify `apps/web/src/api.ts`: add `AssessmentHistory` types, mock history, and fetch helper.
- Modify `apps/web/src/App.tsx`: add state, initial fetch, refresh after paper submit, and UI panel.
- Modify `apps/web/src/styles.css`: style the new history summary and records.

## Task 1: Smoke Test Contract

- [ ] **Step 1: Add failing smoke assertions**

In `scripts/smoke-migration.mjs`, fetch initial history before paper submission and assert it has summary data:

```js
const historyBeforePaper = await waitForJson(`${apiUrl}/assessment-history?userId=u-001`, (data) =>
  Array.isArray(data.items) && data.summary,
);
const historyCountBeforePaper = historyBeforePaper.items.length;
assert(Number.isFinite(historyBeforePaper.summary.attemptCount), 'assessment history should expose attempt count');
```

After `paperResult` assertions, add:

```js
const historyAfterPaper = await waitForJson(`${apiUrl}/assessment-history?userId=u-001`, (data) =>
  Array.isArray(data.items) && data.items.length === historyCountBeforePaper + 1,
);
const latestHistory = historyAfterPaper.items[0];
assert(latestHistory.paperId === generatedPaper.id, 'assessment history should include the submitted paper id');
assert(latestHistory.score === paperResult.score, 'assessment history should keep the paper score');
assert(latestHistory.accuracyRate === paperResult.accuracyRate, 'assessment history should keep paper accuracy');
assert(Number.isFinite(latestHistory.elapsedSec), 'assessment history should keep elapsed time');
assert(Number.isFinite(latestHistory.unansweredCount), 'assessment history should keep unanswered count');
assert(latestHistory.reviewSuggestion, 'assessment history should include a review suggestion');
assert(historyAfterPaper.summary.attemptCount === historyCountBeforePaper + 1, 'assessment history summary should update attempt count');
```

- [ ] **Step 2: Run smoke and confirm failure**

Run: `npm run smoke:migration`

Expected: FAIL because `GET /assessment-history` is not implemented.

## Task 2: Backend History Endpoint

- [ ] **Step 1: Add endpoint**

In `apps/api/src/study/study.controller.ts`, add:

```ts
@Get('assessment-history')
getAssessmentHistory(@Query('userId') userId?: string) {
  return this.studyService.getAssessmentHistory(userId);
}
```

- [ ] **Step 2: Add backend data shape and builder**

In `apps/api/src/study/study.service.ts`, add an `assessmentHistoryItems` array and `getAssessmentHistory(userId = this.student.id)`. The method returns latest-first items plus summary:

```ts
getAssessmentHistory(userId = this.student.id) {
  const items = this.assessmentHistoryItems
    .filter((item) => item.userId === userId)
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  return {
    userId,
    items,
    summary: this.buildAssessmentHistorySummary(items),
  };
}
```

The summary should include `attemptCount`, `bestScore`, `latestAccuracyRate`, and `improvementText`.

- [ ] **Step 3: Append history on paper submit**

At the end of `submitPaper`, before returning the result, push a new history item with:

- `paperId`
- `title`
- `submittedAt`
- `score`
- `totalScore: 100`
- `accuracyRate`
- `elapsedSec`
- `unansweredCount`
- first weak point title
- actionable review suggestion

- [ ] **Step 4: Run smoke**

Run: `npm run smoke:migration`

Expected: PASS for assessment-history assertions, unless frontend build catches type issues added later.

## Task 3: Frontend API and Fallback

- [ ] **Step 1: Add types**

In `apps/web/src/api.ts`, add:

```ts
export interface AssessmentHistoryItem {
  id: string;
  paperId?: string;
  userId: string;
  title: string;
  submittedAt: string;
  score: number;
  totalScore: number;
  accuracyRate: number;
  elapsedSec: number;
  unansweredCount: number;
  weakPointTitle: string;
  reviewSuggestion: string;
}

export interface AssessmentHistory {
  userId: string;
  items: AssessmentHistoryItem[];
  summary: {
    attemptCount: number;
    bestScore: number;
    latestAccuracyRate: number;
    improvementText: string;
  };
}
```

- [ ] **Step 2: Add mock and fetch helper**

Add `createMockAssessmentHistory()` returning two demo attempts, and `fetchAssessmentHistory(userId)` calling `/assessment-history?userId=...`.

- [ ] **Step 3: Run unit/build check**

Run: `npm test`

Expected: PASS.

## Task 4: React Student Panel

- [ ] **Step 1: Wire state and initial load**

In `apps/web/src/App.tsx`, import `AssessmentHistory`, `createMockAssessmentHistory`, and `fetchAssessmentHistory`. Add state initialized from the mock and include the fetch in the initial data load.

- [ ] **Step 2: Refresh after paper submit**

After `submitPaper` succeeds, call `fetchAssessmentHistory(student.id)` and update state. If it fails, preserve existing history.

- [ ] **Step 3: Render panel**

Add a student panel titled `测评历史` showing summary metrics and latest records. If there are no records, show an empty state encouraging the student to complete a simulated paper.

- [ ] **Step 4: Style panel**

Add CSS classes for a compact summary grid and record list. Keep it consistent with existing panels and avoid nested cards.

## Task 5: Verification and Commit

- [ ] **Step 1: Run tests**

Run:

```bash
npm test
npm run smoke:migration
```

Expected: both pass.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add apps/api/src/study/study.controller.ts apps/api/src/study/study.service.ts apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/styles.css scripts/smoke-migration.mjs docs/superpowers/plans/2026-07-01-assessment-history.md
git commit -m "feat: add student assessment history"
```

- [ ] **Step 3: Push and verify deployment**

Run:

```bash
git push origin codex/deployment-ready
```

Then check GitHub Actions and verify the deployed static bundle contains the new `测评历史` UI text.

## Self-Review

- Spec coverage: backend endpoint, paper submission append, frontend panel, static fallback, and smoke coverage are all mapped to tasks.
- Placeholder scan: no TBD/TODO placeholders are present.
- Type consistency: `AssessmentHistoryItem`, `AssessmentHistory`, `getAssessmentHistory`, and `fetchAssessmentHistory` names are consistent across tasks.
