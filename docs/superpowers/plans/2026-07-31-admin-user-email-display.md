# Admin User Email Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every account's login email in the administrator-only user list, with a safe fallback for legacy accounts without email.

**Architecture:** Extend the existing PostgreSQL-backed administrator user projection with nullable `email`, carry it through the existing `/admin/users` contract, and render it in `AdminWorkspace`. Keep the route protected by the existing admin role guard and do not add email to student, teacher, or public profile responses.

**Tech Stack:** NestJS 10, Prisma 5, React 18, TypeScript 5, Vite 5, Node.js test runner, PostgreSQL integration harness.

## Global Constraints

- Display full email for student, teacher, and administrator accounts.
- Display `未设置邮箱` when the stored email is null.
- Do not add search, sorting, email editing, schema changes, or migrations.
- Do not expose password hashes, temporary passwords, refresh tokens, or full invitation codes.
- Keep `/admin/users` protected by the existing `RoleGuard` and `@Roles('admin')`.
- Follow the server-only administrator-list boundary used by Supabase, Keycloak, and Auth0 management APIs.

---

## File Map

- `scripts/integration-postgres.mjs`: PostgreSQL-backed API contract test for the administrator user list.
- `apps/api/src/study/admin-user.repository.ts`: Maps persisted users to administrator-managed records.
- `apps/api/src/study/study.service.ts`: Defines and returns the administrator user response shape.
- `apps/web/src/api/types.ts`: Defines the frontend administrator user contract.
- `test/admin-user-email-ui.test.js`: Server-rendered React regression test for visible email and fallback copy.
- `apps/web/src/features/admin/AdminWorkspace.tsx`: Renders the account identity details.

### Task 1: Extend the administrator API contract

**Files:**
- Modify: `scripts/integration-postgres.mjs:329-336`
- Modify: `apps/api/src/study/admin-user.repository.ts:5-58`
- Modify: `apps/api/src/study/study.service.ts:2576-2600`
- Modify: `apps/api/src/study/study.service.ts:3545-3560`
- Modify: `apps/web/src/api/types.ts:389-405`

**Interfaces:**
- Consumes: Prisma `User.email: string | null`.
- Produces: `ManagedUserRecord.email?: string` and `AdminManagedUser.email?: string`.
- Produces: `GET /admin/users` items containing the stored email for database-backed accounts.

- [ ] **Step 1: Add a failing PostgreSQL integration assertion**

Add this assertion after the existing registered-student name assertion:

```js
assert(
  registeredAdminUser?.email === credentials.email,
  'admin user management should expose the registered email only through the admin contract',
);
```

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```bash
npm run db:test:up
npm run test:integration:postgres
```

Expected: FAIL with `admin user management should expose the registered email only through the admin contract`.

- [ ] **Step 3: Add nullable email to the repository projection**

Extend `ManagedUserRecord`:

```ts
email?: string;
```

Map the Prisma value in `AdminUserRepository.list()`:

```ts
email: user.email ?? undefined,
```

- [ ] **Step 4: Carry email through the service and frontend contracts**

Add this field to both `AdminManagedUser` interfaces:

```ts
email?: string;
```

Map it in `toAdminManagedUser()`:

```ts
email: user.email,
```

Do not add email to registration, login, dashboard, student, or teacher response types.

- [ ] **Step 5: Verify the API contract is GREEN**

Run:

```bash
npm run build:api
npm run test:integration:postgres
```

Expected: API build succeeds and the PostgreSQL integration script exits 0.

- [ ] **Step 6: Commit the API contract**

```bash
git add scripts/integration-postgres.mjs \
  apps/api/src/study/admin-user.repository.ts \
  apps/api/src/study/study.service.ts \
  apps/web/src/api/types.ts
git commit -m "feat: expose emails in admin user list"
```

### Task 2: Render email in the administrator list

**Files:**
- Create: `test/admin-user-email-ui.test.js`
- Modify: `apps/web/src/features/admin/AdminWorkspace.tsx:105-145`

**Interfaces:**
- Consumes: `AdminManagedUser.email?: string`.
- Produces: visible full email when present, otherwise visible `未设置邮箱`.

- [ ] **Step 1: Add a failing server-rendered React test**

Create a Node test that loads `AdminWorkspace.tsx` through Vite SSR, renders two accounts with `react-dom/server`, and asserts the real component output:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('admin user cards show email and a legacy fallback', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { AdminWorkspace } = await vite.ssrLoadModule(
      '/apps/web/src/features/admin/AdminWorkspace.tsx',
    );
    const users = {
      source: 'postgresql',
      generatedAt: '2026-07-31T00:00:00.000Z',
      summary: { totalUsers: 2, studentCount: 1, activeTrialCount: 2, followUpCount: 0 },
      users: [
        {
          id: 'student-1',
          name: '测试学生',
          email: 'student-test-001@example.com',
          role: 'student',
          trialStatus: 'active',
          lastActiveAt: '2026-07-31T00:00:00.000Z',
          nextAction: '继续测试',
        },
        {
          id: 'legacy-admin',
          name: '旧管理员',
          role: 'admin',
          trialStatus: 'active',
          lastActiveAt: '2026-07-31T00:00:00.000Z',
          nextAction: '维护平台',
        },
      ],
    };
    const ready = (data) => ({ data, state: 'ready', lastSyncAt: '2026-07-31T00:00:00.000Z' });
    const unavailable = { data: null, state: 'loading' };
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(AdminWorkspace, {
      metrics: unavailable,
      users: ready(users),
      feedback: unavailable,
      reviewQueue: unavailable,
      systemConfig: unavailable,
      teacherAuthorizations: unavailable,
      userStatus: '',
      reviewStatus: '',
      configStatus: '',
      onRetryMetrics: noop,
      onRetryUsers: noop,
      onRetryFeedback: noop,
      onRetryReviewQueue: noop,
      onRetrySystemConfig: noop,
      onRetryTeacherAuthorizations: noop,
      onGrantTeacherAuthorization: async () => {},
      onRevokeTeacherAuthorization: async () => {},
      onUpdateTrialStatus: noop,
      onSetAccountStatus: async () => {},
      onCreateTemporaryPassword: async () => {},
      onCreateManagedUser: async () => null,
      onApproveReviewItem: noop,
      onMarkReviewItemNeedsRecheck: noop,
      onApplySprintConfig: noop,
    }));
    assert.match(html, /student-test-001@example\.com/);
    assert.match(html, /未设置邮箱/);
  } finally {
    await vite.close();
  }
});
```

- [ ] **Step 2: Run the UI test and verify RED**

Run:

```bash
node --test --test-isolation=none test/admin-user-email-ui.test.js
```

Expected: FAIL because neither the email nor the fallback is rendered by `AdminWorkspace`.

- [ ] **Step 3: Render the administrator-only identity field**

In each user card's identity block, add:

```tsx
<small className="admin-user-email">{user.email ?? '未设置邮箱'}</small>
```

Keep the existing name, role, trial status, activity, and account actions unchanged.

- [ ] **Step 4: Verify the UI test and web build are GREEN**

Run:

```bash
node --test --test-isolation=none test/admin-user-email-ui.test.js
npm run build:web
```

Expected: one UI test passes and the production web build exits 0.

- [ ] **Step 5: Commit the UI behavior**

```bash
git add test/admin-user-email-ui.test.js \
  apps/web/src/features/admin/AdminWorkspace.tsx
git commit -m "feat: show emails in admin user cards"
```

### Task 3: Release verification and pilot redeployment

**Files:**
- Verify only; no additional source files.

**Interfaces:**
- Consumes: commits from Tasks 1 and 2.
- Produces: updated `codex/deployment-ready` and a healthy Tencent Cloud deployment.

- [ ] **Step 1: Run the complete local verification**

Run:

```bash
npm test
npm run build:api
npm run build:web
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Stop the isolated test database**

Run:

```bash
npm run db:test:down
```

Expected: only the `compose.test.yml` project and its test volume are removed.

- [ ] **Step 3: Push the deployment branch**

Run:

```bash
git push origin codex/deployment-ready
```

Expected: the remote branch advances to the two implementation commits.

- [ ] **Step 4: Update and redeploy the server**

On the Tencent Cloud server:

```bash
cd /home/ubuntu/kaoyan-408-score-boost
git pull --ff-only
./deploy/tencent-ip/deploy.sh
```

Expected: the script creates a pre-deployment PostgreSQL backup, rebuilds the images, reports `Deployment succeeded`, and lists all three services as healthy.

- [ ] **Step 5: Perform browser acceptance**

Log in as the administrator, locate `测试学生`, and verify:

- `student-test-001@example.com` is visible.
- Accounts without email show `未设置邮箱`.
- Invitation management still shows only code prefixes after creation.
- Student registration and login remain available.

- [ ] **Step 6: Record the final verified commit**

Run locally and on the server:

```bash
git log -1 --oneline
```

Expected: both environments report the same implementation commit.
