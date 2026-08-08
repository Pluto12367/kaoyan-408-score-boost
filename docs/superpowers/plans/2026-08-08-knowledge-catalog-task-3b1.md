# 408 Knowledge Catalog Task 3B-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an atomic-knowledge detail drawer, stable prerequisite/related-point name resolution, and a mobile launch entry to the existing 408 Knowledge Catalog without touching stats, API, Prisma, or score-center.

**Architecture:** Keep raw JSON knowledge out of React. Add pure lookup/resolution helpers in `packages/shared`, expose a small resolved detail view model to the Web feature, reuse the existing `OverlayDialog`/overlay pattern for the drawer, and add a launch entry through the existing student launchpad pattern. The current knowledge tree remains the only source of truth.

**Tech Stack:** TypeScript, React, existing `@kaoyan408/shared`, existing OverlayDialog/useOverlayDialog, node:test, Vite.

## Global Constraints

- Do not modify API, Prisma, database, score-center, legacy KnowledgePoint/mastery-map, or question-bank logic.
- Do not implement chapter/section stats join in this task.
- Do not optimize the 1.09MB lazy chunk in this task.
- Do not introduce a new modal/dialog library.
- Do not parse raw V2 JSON directly in the drawer.
- Do not mutate the knowledge catalog.
- All Time Evidence copy must remain `长期考频证据`, never `历史精确考频`.
- Mobile bottom navigation remains at 5 tabs; add a launchpad entry instead of a sixth tab.
- Follow TDD: failing test first, minimal implementation, targeted verification, then full regression.
- Do not commit automatically.

---

## File Map

### Shared pure resolution
- Modify: `packages/shared/src/knowledgeCatalog.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `test/knowledge-catalog.test.mjs`

### Web detail UI
- Create: `apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx`
- Modify: `apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx`
- Modify: `apps/web/src/features/knowledge-catalog/KnowledgeTree.tsx`
- Modify: `apps/web/src/features/knowledge-catalog/constants.ts` only if copy helpers are needed
- Modify: `apps/web/src/styles.css`
- Test: `test/knowledge-catalog-ui.test.js`

### Mobile launch entry
- Modify: `apps/web/src/features/onboarding/StudentLaunchpad.tsx` if this is the actual current launchpad path/pattern
- Test: `test/knowledge-catalog-ui.test.js`

---

### Task 1: Add Stable Atomic-Point Lookup and Relationship Resolution

**Files:**
- Modify: `packages/shared/src/knowledgeCatalog.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `test/knowledge-catalog.test.mjs`

**Interfaces:**
- Consumes: existing `KnowledgeCatalog`, `CatalogAtomicPoint`, stable V2 IDs.
- Produces:
  - `CatalogPointContext`
  - `buildKnowledgePointIndex(catalog)`
  - `resolveKnowledgePointRefs(index, ids)`

Recommended contracts:

```ts
export interface CatalogPointContext {
  point: CatalogAtomicPoint;
  subjectCode: SubjectCode;
  subjectName: string;
  chapterId: string;
  chapterName: string;
  sectionId: string;
  sectionName: string;
}

export type KnowledgePointIndex = Record<string, CatalogPointContext>;

export function buildKnowledgePointIndex(
  catalog: KnowledgeCatalog
): KnowledgePointIndex;

export function resolveKnowledgePointRefs(
  index: KnowledgePointIndex,
  ids: readonly string[]
): CatalogPointContext[];
```

- [ ] **Step 1: Write failing shared tests**

Add tests proving:
- index contains exactly 1149 atomic points for the current real V2 data;
- a known atomic ID resolves to the correct subject/chapter/section context;
- prerequisite IDs resolve to names/context;
- relatedPoint IDs resolve to names/context;
- unknown IDs are ignored rather than creating ghost nodes;
- duplicate input IDs do not create duplicate resolved rows;
- helper functions do not mutate the catalog or ID arrays.

- [ ] **Step 2: Run targeted test and verify RED**

Run:

```bash
node --test --test-name-pattern="knowledge catalog" test/knowledge-catalog.test.mjs
```

Expected: FAIL because the resolver helpers are not yet exported/implemented.

- [ ] **Step 3: Implement `buildKnowledgePointIndex`**

Implementation requirements:
- iterate existing `CatalogSubject -> CatalogChapter -> CatalogSection -> CatalogAtomicPoint`;
- use atomic point `id` as key;
- retain exact stable V2 IDs;
- throw on duplicate atomic IDs rather than silently overwriting;
- never access raw JSON shape.

- [ ] **Step 4: Implement `resolveKnowledgePointRefs`**

Implementation requirements:
- preserve the order from the incoming `ids`;
- de-duplicate repeated IDs while preserving first occurrence;
- ignore unknown IDs;
- return resolved contexts only;
- no mutation.

- [ ] **Step 5: Export from shared barrel**

Use explicit `export` / `export type` to avoid the existing score-center type-name collision pattern.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run:

```bash
npm run build:shared
node --test --test-name-pattern="knowledge catalog" test/knowledge-catalog.test.mjs
```

Expected: PASS.

---

### Task 2: Make Atomic Points Selectable Without Changing Tree Semantics

**Files:**
- Modify: `apps/web/src/features/knowledge-catalog/KnowledgeTree.tsx`
- Test: `test/knowledge-catalog-ui.test.js`

**Interfaces:**
- Consumes: existing tree rendering and expansion state.
- Produces: optional atomic-point selection callback.

Recommended prop:

```ts
interface KnowledgeTreeProps {
  subject: CatalogSubject;
  expansionCommand?: ExpansionCommand;
  onSelectPoint?: (point: CatalogAtomicPoint) => void;
}
```

- [ ] **Step 1: Add failing UI/source test**

Assert that:
- `KnowledgeTree` accepts/uses an atomic-point selection callback;
- atomic-point rows are keyboard/click actionable;
- chapter/section expansion behavior remains present.

Avoid large snapshots.

- [ ] **Step 2: Run targeted UI test and verify RED**

Run:

```bash
node --test test/knowledge-catalog-ui.test.js
```

Expected: FAIL because selection wiring is absent.

- [ ] **Step 3: Implement minimal selection wiring**

Requirements:
- clicking an atomic point invokes `onSelectPoint(point)`;
- selection must not toggle the containing section/chapter accidentally;
- use a semantic button or equivalent keyboard-accessible control;
- retain current row data display;
- do not add drawer logic inside `KnowledgeTree`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/knowledge-catalog-ui.test.js
```

Expected: PASS.

---

### Task 3: Add Knowledge Point Detail Drawer

**Files:**
- Create: `apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx`
- Modify: `apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `test/knowledge-catalog-ui.test.js`

**Interfaces:**
- Consumes:
  - selected `CatalogAtomicPoint`;
  - `KnowledgePointIndex`;
  - `resolveKnowledgePointRefs`;
  - existing `OverlayDialog` / `useOverlayDialog` pattern.
- Produces: detail drawer displaying context and resolved references.

Recommended component contract:

```ts
interface KnowledgePointDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  context: CatalogPointContext | null;
  prerequisiteContexts: CatalogPointContext[];
  relatedContexts: CatalogPointContext[];
}
```

- [ ] **Step 1: Write failing UI tests**

Assert source wiring/copy for:
- use of existing `OverlayDialog` pattern;
- detail sections for subject/chapter/section;
- importance and difficulty;
- `近3年`;
- `近5年`;
- `长期考频证据`;
- trend;
- `前置知识`;
- `相关知识`;
- absence of misleading `历史精确考频`.

- [ ] **Step 2: Run UI test and verify RED**

Run:

```bash
node --test test/knowledge-catalog-ui.test.js
```

Expected: FAIL because drawer component/wiring is absent.

- [ ] **Step 3: Build point index once in page**

In `KnowledgeCatalog.tsx`, derive once with `useMemo`:

```ts
const pointIndex = useMemo(
  () => buildKnowledgePointIndex(catalog),
  []
);
```

Use the actual dependency style appropriate to the module-scoped stable catalog object.

Do not rebuild the index per row or per drawer section.

- [ ] **Step 4: Wire selection state**

Store only selected point ID or selected point context. Prefer ID if it keeps state minimal.

On selection:
- resolve selected point from `pointIndex`;
- resolve prerequisites from `selected.point.prerequisites`;
- resolve related points from `selected.point.relatedPoints`;
- open existing overlay/dialog.

- [ ] **Step 5: Implement `KnowledgePointDetailDrawer.tsx`**

Display:

1. Header:
   - point name
   - subject name
   - chapter → section breadcrumb

2. Core attributes:
   - importance 1–5
   - difficulty 1–5

3. Frequency evidence:
   - Recent3Y / `近3年`
   - Recent5Y / `近5年`
   - All Time Evidence / `长期考频证据`
   - trend

4. Reference sections:
   - `前置知识`
   - `相关知识`

For each resolved reference, show at minimum:
- knowledge-point name;
- subject name when cross-subject;
- optionally chapter/section in muted text.

If an ID cannot be resolved:
- do not invent a name;
- omit that reference from the visible list;
- the shared resolver tests protect ghost-node behavior.

If evidence is null:
- show `暂无考频数据`.

If prerequisites or related points are empty:
- show a compact `暂无`/empty state rather than hiding the entire semantic section if current UI convention favors explicit empty states.

- [ ] **Step 6: Verify UI tests**

Run:

```bash
node --test test/knowledge-catalog-ui.test.js
```

Expected: PASS.

---

### Task 4: Add Mobile Launchpad Entry

**Files:**
- Modify: `apps/web/src/features/onboarding/StudentLaunchpad.tsx` only if verified as the current mobile launch entry pattern.
- Test: `test/knowledge-catalog-ui.test.js`

**Interfaces:**
- Consumes: existing navigation/hash callback pattern.
- Produces: a mobile-friendly entry to `knowledge-catalog`.

- [ ] **Step 1: Inspect the current launchpad pattern before editing**

Verify how the existing score-center launch entry navigates. Reuse the same mechanism.

If `StudentLaunchpad.tsx` is not the actual current component or there is no safe existing launch-card pattern, STOP and report rather than inventing a new navigation architecture.

- [ ] **Step 2: Write failing UI/source test**

Assert that the launchpad contains:
- a `408知识图谱` or `知识图谱` entry;
- navigation target `knowledge-catalog`.

- [ ] **Step 3: Run targeted UI test and verify RED**

Run:

```bash
node --test test/knowledge-catalog-ui.test.js
```

Expected: FAIL because the mobile launch entry is absent.

- [ ] **Step 4: Add minimal launch entry**

Requirements:
- reuse the existing launchpad card/action style;
- do not add a sixth bottom tab;
- target the existing `knowledge-catalog` section/hash;
- no new routing framework.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
node --test test/knowledge-catalog-ui.test.js
```

Expected: PASS.

---

### Task 5: Regression Verification and Stop

**Files:**
- No new production files unless a test reveals a direct Task 3B-1 regression.

- [ ] **Step 1: Build shared**

```bash
npm run build:shared
```

Expected: PASS.

- [ ] **Step 2: Run full unit suite**

```bash
npm test
```

Expected: PASS with only the existing intentional skip.

- [ ] **Step 3: Build web**

```bash
npm run build:web
```

Expected: PASS. Existing lazy-chunk size warning may remain and does not block this task.

- [ ] **Step 4: Review diff**

Confirm changes are limited to:
- shared resolver/index exports;
- knowledge-catalog tree/page/drawer/styles;
- knowledge-catalog tests;
- verified launchpad entry.

No API/Prisma/score-center/legacy mastery changes.

- [ ] **Step 5: Stop**

Do not implement:
- chapter/section stats join;
- README cleanup;
- bundle optimization;
- API/database support;
- Task 3B-2.

Final report must include:

## Changed Files

## Resolver Functions

## Drawer Data Flow

## Drawer UI

## Prerequisite Resolution

## Related-Point Resolution

## Mobile Entry

## Targeted Tests

## npm test

## build:shared

## build:web

## Git Diff Summary

## Risks

## Follow-up Issues

## Recommendation for Task 3B-2
