# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

计算机考研 408 提分系统 — a monorepo for a 408-exam (computer science postgraduate) score-improvement platform. Covers diagnostics, study plans, question banks, mistake review, mock exams, score reports, teacher admin, and management dashboards.

**Tech stack**: React 18 + TypeScript + Vite (web), NestJS 10 + TypeScript (API), Prisma 5 + PostgreSQL (data), npm workspaces (monorepo).

## Essential Commands

```bash
# Build
npm run build:shared          # Build shared package (required by both apps)
npm run build:api             # Build shared + NestJS API
npm run build:web             # Build shared + Vite web app

# Test
npm test                      # Run all 46 unit tests (Node --test, no DB needed)
npm run check:local           # Tests + UI verification (Chrome screenshots)

# Start
npm start                     # Static preview server on :4173 (builds web first)
npm run dev:migration         # Full-stack dev: API :3000 + Web :5173 (needs PostgreSQL)

# DB (requires PostgreSQL or Docker)
npm run db:test:up            # Start PostgreSQL 16 test container (port 55432)
npm run db:test:down          # Stop + destroy test container
npm run db:migrate:deploy     # Apply Prisma migrations to DATABASE_URL
npm run test:integration:postgres  # Integration tests against PostgreSQL

# Validation
npm run validate:env:development  # Validate .env.development.example
npm run verify:ui             # Chrome screenshot verification (desktop + mobile)

# Smoke / Release
npm run smoke:migration       # Full local smoke test (API :3110 + Web :5174)
npm run check:release         # Tests + builds + smoke check
```

## Architecture

### Monorepo layout (`npm workspaces`)

```
apps/api/       @kaoyan408/api      NestJS backend (CommonJS, port 3000)
apps/web/       @kaoyan408/web      React + Vite frontend (ESM, port 5173)
packages/shared/  @kaoyan408/shared  Shared types + pure logic functions
prisma/           schema + migrations (shared by API and scripts)
```

### Shared package (`packages/shared`)

Exports from three modules (`src/domain.ts`, `src/learning.ts`, `src/feedback.ts`):
- **Types**: `UserProfile`, `Question`, `KnowledgePoint`, `PracticeRecord`, `StudyPlan`, `DiagnosticProfile`, `WeaknessReport`, `DailyTask`, `MistakeReason`, `StudyStage`, etc.
- **Pure functions**: `buildStudyPlan`, `classifyMistake`, `computeWeaknessReport`, `applyDiagnosticProfile`, `createPracticeRecord`, `gradePracticeSessionAnswers`, `recommendPracticeSet`, `createTeacherQuestion`, `generateTutorReply`, `requireQuestionKnowledgePoint`, `validateFeedbackDraft`

These functions contain ALL core business logic. They are tested directly (24 of 46 tests). The API and web app both consume this package — API uses it server-side for calculations; web uses the types for API responses.

### API (`apps/api`) — NestJS

**Module structure**:
| Module | Scope | Purpose |
|--------|-------|---------|
| `PrismaModule` | `@Global()` | Singleton `PrismaService` (extends `PrismaClient`) |
| `OperationsModule` | `@Global()` | Request audit logging (`OperationLogService`) |
| `AuthModule` | Imported by others | JWT auth, role guards, demo login |
| `QuestionsModule` | Imported by StudyModule | Question CRUD, content review queue |
| `StudyModule` | Root business logic | 50+ endpoints, 10+ repository classes |

**Key controllers**:
- `HealthController` — `GET /health` (public)
- `AuthController` — `POST /auth/{register,login,refresh,logout,demo-login}`
- `QuestionsController` — `GET/POST /questions`, `PATCH/DELETE /questions/:id` (teacher/admin)
- `StudyController` — 50+ endpoints for dashboard, diagnostics, practice, sessions, review, exam, admin

**Auth flow**: Hand-rolled HMAC-SHA256 JWTs (not `@nestjs/jwt`). Access tokens (15min) + one-use refresh tokens (30 days). Passwords hashed with `scrypt`. `RoleGuard` reads `@Roles(...)` metadata and validates Bearer tokens. `@CurrentUser()` param decorator injects `{id, name, role}` into controller methods.

**Dual-mode data source**: Every repository has an `.enabled` getter that checks for `DATABASE_URL`. When absent, services fall back to in-memory arrays. This allows running tests and static preview without PostgreSQL.

**Repository pattern**: 10+ repository classes under `apps/api/src/study/` wrap Prisma calls (e.g., `PracticeRecordRepository`, `LearningSessionRepository`, `ReviewScheduleRepository`). `StudyService` (3524 lines) orchestrates all business logic through these repositories.

**Spaced repetition**: Custom SM-2-like algorithm with intervals [1, 3, 7, 14] days and stability states (`learning` → `review` → `mastered`).

### Web (`apps/web`) — React + Vite

**Key directories**:
```
src/api/         API client, endpoint modules, mock data
src/components/  Reusable UI (TodayPlan, OnboardingWizard, ExamSession, etc.)
src/features/    Feature pages (auth, dashboard, diagnostic, practice, mistakes, etc.)
src/hooks/       Custom React hooks
src/layouts/     Layout components
```

**API client** (`src/api/client.ts`): Wraps `fetch` with auth token injection, refresh token rotation, and error handling. Endpoint modules in `src/api/endpoints/` cover auth, dashboard, exam, onboarding, practice, review, sessions, teacher, tutor.

**Mock mode**: When `VITE_API_BASE_URL` is empty/unset, the app runs in static demo mode with mock data from `src/mockData.ts` and `src/api/mocks/`.

### Prisma schema (`prisma/schema.prisma`)

19 models, key entities:
- **Users & Auth**: `User`, `RefreshToken`, `TeacherStudentAuthorization`
- **Content**: `KnowledgePoint`, `Question`, `QuestionKnowledgePoint`
- **Learning**: `PracticeRecord`, `WrongQuestionReview`, `LearningSession`, `StudyPlan`, `StudyTask`, `StudyTaskCompletion`
- **Review**: `ReviewSchedule`, `ReviewAttempt`, `ExamReviewPlan`
- **System**: `OperationLog`, `RuntimeState`, `AiTutorLog`, `FeedbackSubmission`

Enums: `UserRole` (STUDENT/TEACHER/ADMIN), `Subject` (four 408 subjects), `Difficulty`, `QuestionType`, `TrialStatus`

### Environment variables

See `.env.example` for all variables. Key ones:
- `DATABASE_URL` — PostgreSQL connection string (absent → in-memory mode)
- `JWT_SECRET` — ≥32 chars, used for HMAC-SHA256 token signing
- `WEB_ORIGIN` — CORS origin (comma-separated for multiple origins)
- `VITE_API_BASE_URL` — API URL for the web app (empty → static demo mode)
- `VITE_PUBLIC_BASE_PATH` — Base path for static hosting (must start/end with `/`)
- `ALLOW_DEMO_AUTH` — Set to `"false"` outside development
- `NODE_ENV` — `development` | `staging` | `production`

Production/staging enforces: HTTPS origins, no placeholder values, `ALLOW_DEMO_AUTH=false`, JWT ≥32 chars.

### Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `validate-environment.mjs` | Validates env vars against production safety rules |
| `verify-ui.mjs` | Starts preview server, takes Chrome screenshots (desktop + mobile) |
| `dev-migration.mjs` | Spawns API + Vite dev server concurrently |
| `smoke-migration.mjs` | Full local smoke test (API :3110 + Web :5174) |
| `integration-postgres.mjs` | PostgreSQL integration tests with Prisma |
| `staging-smoke.mjs` | Remote staging smoke test config reader |
| `backup-postgres.mjs` | pg_dump backup utility |
| `verify-postgres-backup.mjs` | Backup integrity verification |
| `restore-postgres.mjs` | pg_restore utility |
| `postgres-tools.mjs` | Shared pg_dump/pg_restore helper |

### CI/CD

- **GitHub Actions** (`.github/workflows/deploy-pages.yml`): On push to `codex/deployment-ready` — runs unit tests, PostgreSQL integration tests, backup verification, builds API Docker image and web app, deploys to GitHub Pages.
- **Dockerfile**: Multi-stage build — Node 22 Alpine builder → production image. Runs Prisma migrations then starts NestJS on `:3000`.
- **Other deploy targets**: `netlify.toml`, `vercel.json`, `railway.toml` for alternative hosting.

### Testing

Tests live in `test/` (8 files, 46 tests, Node built-in test runner). No Jest/Vitest — uses `node:test` + `node:assert/strict`. All tests are ESM (`.test.js`). Tests cover:
- `appLogic.test.js` — 24 business logic tests (shared package functions)
- `environment.test.js` — 4 env validation tests
- `deployment-config.test.js` — 4 Docker/Railway/CI config tests
- `staging-smoke.test.js` — 2 staging config tests
- `student-session-policy.test.js` — 3 session security tests
- `today-plan-ui.test.js` — 3 UI state tests
- `study-date.test.js` — 2 timezone date tests
- `active-time.test.js` — 1 active time tracking test

To add a test: create a `.test.js` file in `test/`, use `import test from 'node:test'` and `import assert from 'node:assert/strict'`.

### Key design decisions

1. **No `@nestjs/jwt`** — custom JWT implementation for zero-dependency auth.
2. **Dual-mode** — entire API works without PostgreSQL using in-memory fallbacks. Enables offline dev and fast CI.
3. **Monolithic StudyService** — all business logic in one service class (3524 lines). Refactoring this would be the first step for major feature work.
4. **Repository pattern** — each entity has a dedicated repository class wrapping Prisma, making persistence swappable.
5. **Shared business logic** — core domain functions live in `packages/shared`, usable by both API and web. This is the source of truth for grading, plan generation, weakness analysis, etc.
6. **Session concurrency** — practice sessions use a `revision` counter for optimistic concurrency, rejecting stale saves.
7. **Content review pipeline** — teacher/AI-generated content goes through `pending → approved/needs_recheck` workflow.
