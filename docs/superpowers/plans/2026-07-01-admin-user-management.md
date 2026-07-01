# Admin User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-side trial roster that lists demo users and lets the admin update student trial status.

**Architecture:** Use the existing NestJS study service for an in-memory roster and status map. The React app fetches the roster and falls back to static mock data for GitHub Pages.

**Tech Stack:** NestJS, React, TypeScript, Vite, existing smoke migration script.

---

## File Structure

- Modify `scripts/smoke-migration.mjs`: assert admin users list and trial status update behavior.
- Modify `apps/api/src/study/study.controller.ts`: add admin users routes.
- Modify `apps/api/src/study/study.service.ts`: add roster builder, trial status update, and validation.
- Modify `apps/web/src/api.ts`: add admin user management types, mock helper, fetch and update helpers.
- Modify `apps/web/src/App.tsx`: load roster, add admin state/status, render user management panel, and demo status action.
- Modify `apps/web/src/styles.css`: style the user management panel and mobile layout.

## Task 1: Smoke Contract

- [ ] **Step 1: Add failing smoke assertions**

Add after admin metrics assertions in `scripts/smoke-migration.mjs`:

```js
const adminUsers = await waitForJson(`${apiUrl}/admin/users`, (data) =>
  data.summary?.totalUsers >= 3 && Array.isArray(data.users),
);
assert(adminUsers.users.some((user) => user.role === 'student'), 'admin users should include a student account');
assert(adminUsers.users.some((user) => user.role === 'teacher'), 'admin users should include a teacher account');
assert(adminUsers.users.some((user) => user.role === 'admin'), 'admin users should include an admin account');
const updatedTrialUser = await postJson(`${apiUrl}/admin/users/u-001/trial-status`, {
  trialStatus: 'follow_up',
});
assert(updatedTrialUser.trialStatus === 'follow_up', 'admin user trial status update should persist');
const adminUsersAfterTrialUpdate = await waitForJson(`${apiUrl}/admin/users`, (data) =>
  data.summary?.followUpCount >= 1,
);
assert(adminUsersAfterTrialUpdate.users.some((user) => user.id === 'u-001' && user.trialStatus === 'follow_up'), 'admin users should expose updated trial status');
```

- [ ] **Step 2: Run smoke and confirm failure**

Run: `npm run smoke:migration`

Expected: FAIL because `/admin/users` does not exist yet.

## Task 2: Backend Roster

- [ ] **Step 1: Add controller routes**

Add `GET /admin/users` and `POST /admin/users/:userId/trial-status` to `apps/api/src/study/study.controller.ts`.

- [ ] **Step 2: Implement service methods**

Add `getAdminUsers()` and `updateAdminUserTrialStatus(userId, trialStatus)` to `apps/api/src/study/study.service.ts`. Validate status against `invited`, `active`, `completed`, and `follow_up`.

- [ ] **Step 3: Build API**

Run: `npm run build:api`

Expected: PASS.

## Task 3: Frontend User Management

- [ ] **Step 1: Add frontend API helpers**

Add `AdminUserManagement`, `AdminManagedUser`, `createMockAdminUserManagement()`, `fetchAdminUsers()`, and `updateAdminUserTrialStatus()` to `apps/web/src/api.ts`.

- [ ] **Step 2: Wire React state**

Add `adminUsers` and `userStatus` state in `apps/web/src/App.tsx`, load `fetchAdminUsers()` in the initial data request, and fall back to mock data.

- [ ] **Step 3: Render admin panel**

Add a `用户管理` panel near the admin metrics panel. Include summary cards, user rows, and a button that marks the first student as `follow_up`.

- [ ] **Step 4: Style panel**

Add `.admin-users-*` classes to `apps/web/src/styles.css` with responsive one-column behavior.

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
git add apps/api/src/study/study.controller.ts apps/api/src/study/study.service.ts apps/web/src/api.ts apps/web/src/App.tsx apps/web/src/styles.css scripts/smoke-migration.mjs docs/superpowers/plans/2026-07-01-admin-user-management.md
git commit -m "feat: add admin user management"
git push origin codex/deployment-ready
```

- [ ] **Step 3: Verify deployment**

Check GitHub Actions latest run for `codex/deployment-ready`, then verify the deployed bundle contains `用户管理`.

## Self-Review

- Spec coverage: user list, role display, trial status update, static fallback, and smoke coverage are all represented.
- Placeholder scan: no TODO, TBD, or vague future work remains.
- Type consistency: `AdminUserManagement`, `AdminManagedUser`, `fetchAdminUsers`, and `updateAdminUserTrialStatus` are named consistently.
