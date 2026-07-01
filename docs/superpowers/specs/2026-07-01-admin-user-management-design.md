# Admin User Management Design

## Goal

Add an admin-facing user management and trial roster feature for the 408 score-boost platform. The feature should help the project owner manage invited students, demo teachers, and admin accounts while preparing for real student trials.

This is an MVP roster feature. It is not a full identity system, CRM, or admissions management tool.

## Scope

The first implementation will cover:

- A backend endpoint that returns demo users and trial status.
- A backend endpoint that updates a user's trial status.
- An admin-side panel showing users, roles, target info, learning stage, recent activity, and trial status.
- A simple demo action to mark one user as completed or follow-up.
- Static fallback data for GitHub Pages.
- Smoke coverage for listing users and updating trial status.

Out of scope for this step:

- Real registration, password login, OAuth, or email verification.
- Storing direct contact details such as phone numbers, email addresses, or payment data.
- Bulk import/export.
- Role permission editing.
- Persistent PostgreSQL storage.

## User Experience

Admins should see a compact "用户管理" panel near the existing management dashboard. The panel should answer:

- Who is in the trial roster?
- What role does each account have?
- Which students are invited, active, completed, or need follow-up?
- Which student stage and target score should be watched?
- Who has been active recently?

The panel should include summary counts:

- Total users.
- Student count.
- Active trial count.
- Follow-up count.

Each row should show:

- Name and role.
- Trial status.
- Current stage or account purpose.
- Target score or admin/teacher responsibility.
- Last active date.
- Next action.

## Trial Statuses

Use four statuses:

- `invited`: student has been invited but has not completed the trial.
- `active`: student is currently trying the system.
- `completed`: student completed the core trial flow.
- `follow_up`: student should be contacted for questionnaire feedback or deeper interview.

Teachers and admins can use `active` as their default status in the prototype.

## Data Shape

Use a compact object:

```ts
type AdminUserManagement = {
  source: 'memory-api' | 'postgres-ready-api' | 'mock';
  generatedAt: string;
  summary: {
    totalUsers: number;
    studentCount: number;
    activeTrialCount: number;
    followUpCount: number;
  };
  users: Array<{
    id: string;
    name: string;
    role: 'student' | 'teacher' | 'admin';
    trialStatus: 'invited' | 'active' | 'completed' | 'follow_up';
    stage?: string;
    targetScore?: number;
    targetSchool?: string;
    lastActiveAt: string;
    nextAction: string;
  }>;
};
```

The update endpoint should return the updated user object:

```ts
POST /admin/users/:userId/trial-status
{ "trialStatus": "completed" }
```

## Backend Design

Add `GET /admin/users` in the study controller. It returns a demo roster built from:

- The prototype student from `StudyService`.
- The demo teacher account.
- The demo admin account.

Add `POST /admin/users/:userId/trial-status` to update an in-memory `trialStatusByUserId` map.

The service should derive student activity from existing records:

- `getTrialProgress()` for completed trial flow.
- `getLearningCalendar()` for recent active dates.
- `getOverviewReport()` for student learning stage context.

## Frontend Design

Add API helpers:

- `fetchAdminUsers()`
- `updateAdminUserTrialStatus()`
- `createMockAdminUserManagement()`

Add React state:

- `adminUsers`
- `userStatus`

Render an admin panel titled `用户管理`. It should show summary cards and user rows. Include one demo action button that marks the first student as `completed` or `follow_up`.

If the backend is unavailable, keep mock roster data so GitHub Pages remains useful.

## Error Handling

- If fetching users fails, keep mock users and do not break the admin page.
- If status update fails, show a short status message and keep the previous list.
- Invalid trial status values should be rejected by the backend with `BadRequestException`.

## Tests

Update `scripts/smoke-migration.mjs` to verify:

- `GET /admin/users` returns summary and users.
- The roster includes student, teacher, and admin roles.
- `POST /admin/users/:userId/trial-status` updates a student's status.
- A follow-up count is returned when a user is marked `follow_up`.

Existing verification should still pass:

- `npm test`
- `npm run smoke:migration`

## Review Notes

This feature is intentionally privacy-light. It supports trial workflow tracking without collecting direct personal contact details. When the platform moves to a real backend, this can map to a `users` table and a `trial_participants` table.
