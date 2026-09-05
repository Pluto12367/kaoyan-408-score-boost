# Canonical Event Boundary Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate client telemetry writes from server-only canonical UserEvent writes while preserving existing feedback attribution and eventKey idempotency.

**Architecture:** Keep `POST /events` as the telemetry endpoint, but allow only the explicit telemetry type allowlist. Add an internal `CanonicalEventWriterService` that validates reserved event contracts and persists canonical events through the existing Prisma-backed repository. Migrate `LearningLoopTriggerService` to the canonical writer; keep `StudentStateFeedbackRepository` as the existing dedicated canonical producer.

**Tech Stack:** NestJS 10, TypeScript, Prisma 5, PostgreSQL, Node `node:test`.

**Spec:** User-approved PHASE 3.6.3 Architecture Decision Record in the current conversation.

## Global Constraints

- Preserve `POST /events` and its response shape for allowed telemetry events.
- Reject `USER_ACTION_FEEDBACK`, `plan.generated`, `ACTION_COMPLETED`, `PRACTICE_ATTRIBUTED`, and `REVIEW_ATTRIBUTED` from client input with HTTP 403.
- Do not modify Prisma schema, migrations, Recommendation, Mastery, Student State write paths, PracticeRecord, ReviewAttempt, AI, RAG, Agent, or frontend behavior.
- Canonical writer must be server-only and must use deterministic eventKey values where a producer supplies one.
- Keep `StudentStateFeedbackRepository` as the producer for `USER_ACTION_FEEDBACK`; do not duplicate its writes.
- Use TDD: add a failing test, run it, implement the smallest change, rerun focused and regression tests.

---

### Task 1: Freeze the event boundary contract with tests

**Files:**
- Create: `test/canonical-event-boundary.test.js`
- Test existing: `test/user-events.test.js`

**Interfaces:**
- Consumes: `StudyController.recordUserEvent`, `RecordUserEventDto`, `UserEventRepository`, and the new writer contract.
- Produces: executable assertions for telemetry allowlist, reserved-event rejection, canonical writer persistence, eventKey reuse, and LearningLoop wiring.

- [ ] **Step 1: Write failing tests**

  Add tests that instantiate the controller/service boundary with in-memory fakes and assert:

  ```js
  test('client cannot record reserved canonical events', async () => {
    await assert.rejects(
      () => controller.recordUserEvent(user, { type: 'USER_ACTION_FEEDBACK', payload: {} }),
      (error) => error?.status === 403,
    );
  });

  test('telemetry event is accepted through the public endpoint', async () => {
    const result = await controller.recordUserEvent(user, { type: 'button.click', payload: { name: 'start' } });
    assert.equal(result.type, 'button.click');
    assert.equal(events[0].type, 'button.click');
  });

  test('canonical writer persists a reserved event with its eventKey', async () => {
    const result = await canonicalWriter.recordCanonicalEvent({
      userId: 'u-1', type: 'plan.generated', eventKey: 'PLAN_GENERATED:u-1:2026-09-03', payload: { triggerKey: 'learning-loop:u-1:2026-09-03' },
    });
    assert.equal(result.type, 'plan.generated');
    assert.equal(events[0].eventKey, 'PLAN_GENERATED:u-1:2026-09-03');
  });

  test('canonical writer returns the existing record for a repeated eventKey', async () => {
    const first = await canonicalWriter.recordCanonicalEvent(input);
    const second = await canonicalWriter.recordCanonicalEvent(input);
    assert.equal(second.id, first.id);
    assert.equal(events.length, 1);
  });

  test('learning loop depends on the canonical writer for plan.generated', () => {
    assert.match(sourceOf('apps/api/src/study/learning-loop-trigger.service.ts'), /canonicalEventWriter/);
    assert.doesNotMatch(sourceOf('apps/api/src/study/learning-loop-trigger.service.ts'), /userEvents\.record\(/);
  });
  ```

- [ ] **Step 2: Run the focused test to verify RED**

  Run: `node --test --test-isolation=none test/canonical-event-boundary.test.js`

  Expected: FAIL because the canonical writer and public reserved-event guard do not yet exist.

---

### Task 2: Implement the canonical writer and repository boundary

**Files:**
- Create: `apps/api/src/study/canonical-event-writer.service.ts`
- Modify: `apps/api/src/study/user-event.repository.ts`
- Test: `test/canonical-event-boundary.test.js`

**Interfaces:**
- Consumes: `PrismaService` through `UserEventRepository`.
- Produces: `CanonicalEventWriterService.recordCanonicalEvent(input)` returning the stored event; `UserEventRepository.recordTelemetry(...)` for public telemetry; `UserEventRepository.recordCanonical(...)` for internal canonical writes.

- [ ] **Step 1: Add the minimal repository methods**

  Keep the existing Prisma `userEvent.create` implementation as the persistence primitive, add explicit method names, and keep `record` as a compatibility alias only for existing non-canonical internal telemetry callers. `recordCanonical` must pass `eventKey` through and translate a `P2002` conflict into a lookup by `{ userId_eventKey }`.

- [ ] **Step 2: Add the canonical writer**

  Implement a server-side service with:

  ```ts
  export const RESERVED_CANONICAL_EVENT_TYPES = [
    'USER_ACTION_FEEDBACK', 'plan.generated', 'ACTION_COMPLETED',
    'PRACTICE_ATTRIBUTED', 'REVIEW_ATTRIBUTED',
  ] as const;

  recordCanonicalEvent(input: {
    userId: string;
    type: (typeof RESERVED_CANONICAL_EVENT_TYPES)[number];
    eventKey: string;
    payload?: Record<string, unknown>;
  }): Promise<{ id: string; userId: string; type: string; eventKey: string | null; payload: unknown; createdAt: Date }>;
  ```

  Reject missing/blank event keys and non-reserved types in the internal writer so the service cannot become a second telemetry endpoint.

- [ ] **Step 3: Run focused tests to verify GREEN**

  Run: `node --test --test-isolation=none test/canonical-event-boundary.test.js`

  Expected: PASS.

---

### Task 3: Restrict the public `/events` endpoint

**Files:**
- Modify: `apps/api/src/study/dto/user-event.dto.ts`
- Modify: `apps/api/src/study/study.service.ts`
- Modify: `apps/api/src/study/study.controller.ts`
- Modify: `apps/api/src/study/study.module.ts`
- Test: `test/canonical-event-boundary.test.js`

**Interfaces:**
- Consumes: authenticated `POST /events` requests and `TelemetryEventWriter` methods.
- Produces: HTTP 403 for reserved canonical types; unchanged response shape for allowed telemetry types.

- [ ] **Step 1: Add the public guard behavior**

  Validate the type against `page.view`, `button.click`, `ui.interaction`, and `client.error`; throw `ForbiddenException` for reserved canonical types and `BadRequestException` for unsupported non-telemetry types. The controller continues resolving `user.id` from the authenticated principal and never accepts a caller-supplied user ID.

- [ ] **Step 2: Wire the writer provider**

  Register `CanonicalEventWriterService` in `StudyModule` and inject it only into internal producers. Do not expose it from a controller.

- [ ] **Step 3: Run focused boundary and existing event tests**

  Run: `node --test --test-isolation=none test/canonical-event-boundary.test.js test/user-events.test.js`

  Expected: PASS.

---

### Task 4: Migrate LearningLoop canonical production

**Files:**
- Modify: `apps/api/src/study/learning-loop-trigger.service.ts`
- Test: `test/canonical-event-boundary.test.js`
- Test: `test/learning-loop-trigger.test.js`

**Interfaces:**
- Consumes: `CanonicalEventWriterService.recordCanonicalEvent`.
- Produces: `plan.generated` written only through the canonical writer, with deterministic `PLAN_GENERATED:${userId}:${scheduledDate}` eventKey; existing triggerKey skip and best-effort failure behavior remain unchanged.

- [ ] **Step 1: Replace the plan.generated writer dependency**

  Append the canonical writer constructor dependency to preserve positional test constructors. Keep `hasTriggerKey` for the existing duplicate-plan read guard; replace only the `userEvents.record(..., 'plan.generated', ...)` call with:

  ```ts
  await this.canonicalEventWriter.recordCanonicalEvent({
    userId,
    type: 'plan.generated',
    eventKey: `PLAN_GENERATED:${userId}:${scheduledDate}`,
    payload: { planId: plan.id, scheduledDate, triggerType: input.triggerType, sourceId: input.sourceId, triggerKey },
  });
  ```

- [ ] **Step 2: Run learning-loop regressions**

  Run: `node --test --test-isolation=none test/learning-loop-trigger.test.js test/canonical-event-boundary.test.js`

  Expected: PASS.

---

### Task 5: Full scope verification

**Files:**
- Verify only; no additional source changes.

- [ ] **Step 1: Run Phase 3.6.3 contract and regression tests**

  Run the focused boundary tests plus `action-feedback-trigger`, `student-state-feedback-event-key`, `answer-receipt`, and `learning-loop-trigger` tests in isolated processes.

- [ ] **Step 2: Run builds and static checks**

  Run: `npm run build:shared`

  Run: `npm run build:api`

  Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

  Run: `git diff --check`

- [ ] **Step 3: Confirm forbidden scope changes are absent**

  Inspect `git diff --name-only` and verify no Prisma schema/migration, frontend, AI, Mastery, Recommendation algorithm, PracticeRecord, or ReviewAttempt changes were introduced by this phase.

- [ ] **Step 4: Report known environment/baseline failures honestly**

  If `npm test` or Vite fails under restricted Windows process spawning, record `spawn EPERM`. If an unrelated pre-existing test remains red in the host environment, name its file and assertion without changing it.

