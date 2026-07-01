# Teacher Class Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a teacher-side class analytics panel that summarizes cohort weakness, risk students, and teaching actions.

**Architecture:** Use the existing NestJS memory-backed study service to derive analytics from current reports, mastery map, wrong questions, plans, and assessment history. The React app fetches the analytics and falls back to mock data on GitHub Pages.

**Tech Stack:** NestJS, React, TypeScript, Vite, existing smoke migration script.

---

## File Structure

- Modify `scripts/smoke-migration.mjs`: assert `GET /teacher/class-analytics` returns overview metrics, subject weakness, weak points, risks, and teaching actions.
- Modify `apps/api/src/study/study.controller.ts`: add the teacher analytics endpoint.
- Modify `apps/api/src/study/study.service.ts`: derive class analytics from existing learning data.
- Modify `apps/web/src/api.ts`: add `TeacherClassAnalytics` types, mock data, and fetch helper.
- Modify `apps/web/src/App.tsx`: load analytics, store state, and render teacher panel.
- Modify `apps/web/src/styles.css`: add compact teacher analytics styles.

## Task 1: Smoke Contract

- [ ] **Step 1: Add failing smoke assertions**

Add after teacher question permission checks in `scripts/smoke-migration.mjs`:

```js
const classAnalytics = await waitForJson(`${apiUrl}/teacher/class-analytics`, (data) =>
  data.overview?.studentCount >= 1 && Array.isArray(data.subjectWeakness),
);
assert(classAnalytics.overview.averageAccuracyRate >= 0, 'class analytics should expose average accuracy');
assert(classAnalytics.subjectWeakness.length >= 4, 'class analytics should include 408 subject weakness data');
assert(classAnalytics.weakKnowledgePoints.length > 0, 'class analytics should include weak knowledge points');
assert(classAnalytics.atRiskStudents.length > 0, 'class analytics should include at-risk students');
assert(classAnalytics.teachingActions.length > 0, 'class analytics should include teaching actions');
```

- [ ] **Step 2: Run smoke and confirm failure**

Run: `npm run smoke:migration`

Expected: FAIL because `/teacher/class-analytics` does not exist yet.

## Task 2: Backend Analytics

- [ ] **Step 1: Add controller route**

Add to `apps/api/src/study/study.controller.ts`:

```ts
@Get('teacher/class-analytics')
getTeacherClassAnalytics() {
  return this.studyService.getTeacherClassAnalytics();
}
```

- [ ] **Step 2: Implement service method**

Add `getTeacherClassAnalytics()` to `apps/api/src/study/study.service.ts`. It should return:

- `overview.studentCount`
- `overview.activeStudentCount`
- `overview.averageAccuracyRate`
- `overview.averageCompletionRate`
- `overview.pendingWrongQuestionCount`
- `subjectWeakness`
- `weakKnowledgePoints`
- `atRiskStudents`
- `teachingActions`

- [ ] **Step 3: Build API**

Run: `npm run build:api`

Expected: PASS.

## Task 3: Frontend Analytics Panel

- [ ] **Step 1: Add frontend API types and helpers**

In `apps/web/src/api.ts`, add:

- `TeacherClassAnalytics`
- `createMockTeacherClassAnalytics()`
- `fetchTeacherClassAnalytics()`

- [ ] **Step 2: Add React state and loading**

In `apps/web/src/App.tsx`, add `teacherClassAnalytics` state, fetch it in the initial `Promise.all`, and fall back to the mock helper on failure.

- [ ] **Step 3: Render teacher panel**

Inside the teacher section, render `班级学情分析` with overview metrics, subject weakness rows, risk students, and teaching actions.

- [ ] **Step 4: Style panel**

Add `.class-analytics-*` CSS classes in `apps/web/src/styles.css`, including mobile-friendly one-column behavior.

## Task 4: Verification and Release

- [ ] **Step 1: Run verification**

Run:

```bash
npm test
npm run smoke:migration
```

Expected: both pass.

- [ ] **Step 2: Commit and push**

Run:

```bash
git add apps/api/src/study/study.controller.ts apps/api/src/study/study.service.ts apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/styles.css scripts/smoke-migration.mjs docs/superpowers/plans/2026-07-01-teacher-class-analytics.md
git commit -m "feat: add teacher class analytics"
git push origin codex/deployment-ready
```

- [ ] **Step 3: Verify deployment**

Check GitHub Actions latest run for `codex/deployment-ready`, then verify the deployed bundle contains `班级学情分析`.

## Self-Review

- Spec coverage: endpoint, derived metrics, teacher panel, static fallback, and smoke coverage are all represented.
- Placeholder scan: no TODO, TBD, or vague future work remains in this plan.
- Type consistency: `TeacherClassAnalytics`, `getTeacherClassAnalytics`, `fetchTeacherClassAnalytics`, and `createMockTeacherClassAnalytics` are named consistently.
