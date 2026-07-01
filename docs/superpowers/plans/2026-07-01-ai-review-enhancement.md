# AI Review Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve AI tutoring review so admins can see review reasons, suggested actions, and mark AI content as needing recheck.

**Architecture:** Extend the existing in-memory review queue objects shared by question and AI review items. Add a recheck route in the study controller, update API/frontend types, and render richer review metadata in the current admin review panel.

**Tech Stack:** NestJS, React, TypeScript, Vite, existing smoke migration script.

---

## File Structure

- Modify `scripts/smoke-migration.mjs`: assert AI review metadata and recheck status.
- Modify `apps/api/src/questions/questions.service.ts`: extend `ReviewItem` shape and question review defaults.
- Modify `apps/api/src/study/study.controller.ts`: add recheck route.
- Modify `apps/api/src/study/study.service.ts`: add review metadata for AI items and recheck method.
- Modify `apps/web/src/api.ts`: extend review item status and metadata types.
- Modify `apps/web/src/App.tsx`: add recheck action, render review reason/action, and add AI auxiliary note.
- Modify `apps/web/src/styles.css`: add small review metadata and AI notice styles.

## Task 1: Smoke Contract

- [ ] **Step 1: Add failing smoke assertions**

In `scripts/smoke-migration.mjs`, after the review queue is fetched and AI reply is asserted, add:

```js
const aiReviewItem = reviewQueue.items.find((item) => item.contentType === 'ai_reply' && item.relatedId === tutorReply.id);
assert(aiReviewItem.reviewReason, 'AI review item should include a review reason');
assert(aiReviewItem.suggestedAction, 'AI review item should include a suggested action');
const recheckReviewItem = await postJson(`${apiUrl}/admin/review-queue/${aiReviewItem.id}/recheck`, {
  reviewerId: 'admin-001',
});
assert(recheckReviewItem.status === 'needs_recheck', 'AI review item should support needs recheck status');
```

After approval assertions, verify the queue includes the recheck status:

```js
assert(reviewQueueAfterApproval.items.some((item) => item.id === aiReviewItem.id && item.status === 'needs_recheck'), 'review queue should expose needs recheck status');
```

- [ ] **Step 2: Run smoke and confirm failure**

Run: `npm run smoke:migration`

Expected: FAIL because AI review items do not include metadata and the recheck endpoint does not exist.

## Task 2: Backend Review Metadata and Recheck

- [ ] **Step 1: Extend backend review item type**

In `apps/api/src/questions/questions.service.ts`, update `ReviewItem.status` to include `needs_recheck` and add `reviewReason` plus `suggestedAction`.

- [ ] **Step 2: Add metadata defaults**

When teacher-created question review items are created, include a question-specific `reviewReason` and `suggestedAction`.

- [ ] **Step 3: Add AI review metadata**

In `apps/api/src/study/study.service.ts`, when `createTutorReply()` and `createAiFollowUp()` push AI review items, include:

- `reviewReason`
- `suggestedAction`
- `riskLevel`

- [ ] **Step 4: Add recheck method and route**

Add `POST /admin/review-queue/:reviewItemId/recheck` in `apps/api/src/study/study.controller.ts`, calling `studyService.markReviewItemNeedsRecheck(reviewItemId, reviewerId)`.

Implement `markReviewItemNeedsRecheck()` in `StudyService`. It should update AI review items and question review items through `QuestionsService`.

- [ ] **Step 5: Build API**

Run: `npm run build:api`

Expected: PASS.

## Task 3: Frontend Review Panel

- [ ] **Step 1: Extend frontend types and helpers**

In `apps/web/src/api.ts`, update `ReviewItem.status`, add `reviewReason` and `suggestedAction`, and add `markReviewItemNeedsRecheck()`.

- [ ] **Step 2: Wire recheck action**

In `apps/web/src/App.tsx`, add `handleMarkReviewItemNeedsRecheck(reviewItemId)` that calls the API, refreshes the queue, and updates `reviewStatus`.

- [ ] **Step 3: Render richer review metadata**

In the admin review panel, show review reason and suggested action. Add a `标记复查` button for non-approved items.

- [ ] **Step 4: Add AI auxiliary note**

In the AI tutoring section, add a short note that AI explanations are auxiliary and standard answers/teacher-reviewed content are authoritative.

- [ ] **Step 5: Style UI additions**

Add CSS for `.review-meta`, `.ai-safety-note`, and recheck status state.

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
git add apps/api/src/questions/questions.service.ts apps/api/src/study/study.controller.ts apps/api/src/study/study.service.ts apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/styles.css scripts/smoke-migration.mjs docs/superpowers/plans/2026-07-01-ai-review-enhancement.md
git commit -m "feat: enhance ai review workflow"
git push origin codex/deployment-ready
```

- [ ] **Step 3: Verify deployment**

Check GitHub Actions latest run for `codex/deployment-ready`, then verify the deployed bundle contains `标记复查` and `AI 解释仅作辅助`.

## Self-Review

- Spec coverage: review metadata, recheck status, backend endpoint, frontend UI, AI note, and smoke tests are all represented.
- Placeholder scan: no TODO, TBD, or vague future work remains.
- Type consistency: `needs_recheck`, `reviewReason`, `suggestedAction`, and `markReviewItemNeedsRecheck` are named consistently.
