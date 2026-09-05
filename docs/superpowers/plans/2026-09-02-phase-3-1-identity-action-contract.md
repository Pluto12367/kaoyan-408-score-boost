# Phase 3.1 Identity & Action Contract Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement each task with a failing contract test first.

**Goal:** Establish a runtime-verifiable separation between KnowledgeNode IDs, KnowledgePoint IDs, and recommendation action identity without changing the database schema or learning write path.

**Architecture:** Keep the existing Node-native mastery and recommendation engine models canonical. Convert to legacy Point-shaped DTOs only in explicit adapters. Add a small shared, dependency-free action identity contract for future Action Spine work; do not persist or execute actions in this phase.

**Tech Stack:** TypeScript, `packages/shared`, NestJS adapters, Node built-in `node:test`, existing TypeScript transpile test harness.

**Spec:** PHASE 3.1 — IDENTITY & ACTION CONTRACT GATE (user-provided task)

## Global Constraints

- Do not modify Prisma schema, migrations, historical data, Student State write path, mastery algorithm, recommendation algorithm, AI, RAG, Agent, or UI behavior.
- Preserve unrelated working-tree changes; never use `git add .`, reset, clean, or commit unless explicitly requested.
- Legacy compatibility is allowed only through an explicit adapter.
- Canonical arrays must never mix Node IDs and Point IDs.

### Task 1: Identity contract tests

**Files:**
- Modify: `test/knowledge-identity-02.test.js`
- Modify: `test/practice-set-adapter.test.js` only for the conflicting legacy fallback assertion, if required by the canonical contract
- Test: existing identity and adapter suites

- [ ] Write/adjust failing assertions for Node-only mastery, disjoint recommendation arrays, and explicit legacy adapter behavior.
- [ ] Run the focused tests and verify failures are contract failures rather than loader errors.
- [ ] Keep only assertions that reflect real Point/Node semantics; do not weaken unrelated parity tests.
- [ ] Re-run focused identity and adapter tests.

### Task 2: Canonical Node DTO boundary

**Files:**
- Modify: `packages/shared/src/nodeMastery.ts`
- Modify: `apps/api/src/study/mastery-summary-projection.service.ts`
- Modify: `apps/web/src/api/endpoints/dashboard.ts`
- Modify: `apps/web/src/api/types.ts` only where the canonical/legacy distinction is currently ambiguous

- [ ] Verify `NodeMasteryPoint` exposes only `knowledgeNodeId` and `LegacyMasteryPoint` is the only Point-shaped compatibility type.
- [ ] Implement only the smallest missing adapter or type export needed by Task 1.
- [ ] Run shared build and the Node mastery/adapter tests.

### Task 3: Recommendation identity boundary

**Files:**
- Modify: `apps/api/src/study/practice-set-recommendation.adapter.ts`
- Modify: `apps/api/src/study/study.service.ts` only in the recommended practice-set response boundary
- Modify: `apps/api/src/study/recommendation.service.ts` only at the StudyTask compatibility adapter
- Test: `test/knowledge-identity-02.test.js`, `test/practice-set-adapter.test.js`

- [ ] Assert that canonical recommendation output uses `knowledgeNodeIds` and mapped real `knowledgePointIds` separately.
- [ ] Preserve legacy `StudyTask.knowledgePointId` only through `toLegacyStudyTaskIdentity` and mark it compatibility-only.
- [ ] Ensure unmapped Nodes do not get copied into Point arrays and question-derived Point IDs remain real Point IDs.
- [ ] Run focused recommendation parity and identity tests, then API TypeScript build.

### Task 4: Action identity contract

**Files:**
- Create: `packages/shared/src/actionContract.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `test/action-identity-contract.test.js`

- [ ] Write failing tests for independent `actionId`, `targetType`, and `targetId`, required reason/evidence references, and the minimal target types actually needed by current recommendation outputs (`KNOWLEDGE_NODE`, `KNOWLEDGE_POINT`, `QUESTION`, `STUDY_TASK`).
- [ ] Add a dependency-free TypeScript type and runtime validator/builder that rejects blank IDs, mixed target identity, and missing evidence.
- [ ] Keep `RecommendationAction` (the existing action-kind union) separate from `RecommendationActionIdentity` (the action instance contract).
- [ ] Run the new contract test and shared build.

### Final verification

- [ ] Run focused Canonical Identity, Legacy Compatibility, Recommendation Identity, Action Contract, and Phase 2 regression tests.
- [ ] Run `npm run build:shared`, `npm run build:api`, and `git diff --check`.
- [ ] Run `npm test` only as an environment check; record Windows `spawn EPERM` honestly if it recurs.
- [ ] Review `git diff --name-only` and confirm no schema, migration, AI, UI, or unrelated files were changed.
- [ ] Stop after reporting Phase 3.1 status; do not start Phase 3.2 or commit automatically.
