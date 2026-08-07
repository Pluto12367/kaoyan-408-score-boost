# 408 Today Score Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a database-backed 408 learning loop that records attempts/reviews, maintains per-user atomic-knowledge mastery, calculates explainable Priority Scores, and generates a balanced daily “what should I study today” plan.

**Architecture:** Keep global exam evidence separate from user learning state. Store knowledge tree, exact/broad exam tags, and versioned frequency snapshots in PostgreSQL; keep Priority Score and plan composition as deterministic pure functions in `packages/shared`; let `apps/api` own transactional persistence and recommendation generation; let `apps/web` render the generated batch without recomputing scores.

**Tech Stack:** npm workspaces, TypeScript, Prisma + PostgreSQL, existing `node --test` test runner, existing `apps/api`, `apps/web`, `packages/shared`, and root integration/migration smoke scripts.

## Global Constraints

- Preserve every existing V1/V2 knowledge-point ID; knowledge-tree changes are append/deprecate only.
- `EXACT_ATOMIC` exam tags may update Recent3Y/Recent5Y and exact primary score; `BROAD_HISTORICAL` tags may affect AllTimeEvidence only.
- AI must never directly generate Priority Score; scoring is deterministic code.
- Missing user state uses neutral defaults and must not be treated as low mastery.
- A daily plan is a persisted snapshot; refreshing a plan creates a new batch rather than mutating historical score inputs.
- Same-day `GET today` is idempotent unless `refresh=true`.
- Every write of an attempt/review and its derived user-state update must be transactional.
- Use the repository’s existing root verification style: `npm test`, `npm run smoke:migration`, and `npm run test:integration:postgres`.
- Do not add Kafka, BKT, IRT, FSRS scheduling internals, AI-generated practice questions, or social ranking in this implementation.
- Before implementation, work on an isolated Git worktree from the current feature branch.

---

## File Map

### Database / seed

- Modify: `prisma/schema.prisma` — add score-center enums/models and indexes.
- Create: `scripts/seed-408-v2.mjs` — import Knowledge Tree V2, 2022–2026 exact mappings, historical evidence, and frequency snapshot.
- Create: `scripts/verify-408-data.mjs` — fail fast on broken parent/tag references and invalid subject scores.
- Modify: `package.json` — add `seed:408` and `verify:408-data` scripts.

### Shared deterministic domain logic

- Create: `packages/shared/src/score-center/types.ts` — shared contracts/enums for evidence, user state, scoring, recommendation reasons/actions.
- Create: `packages/shared/src/score-center/mastery.ts` — pure attempt-to-mastery and review-to-retention updates.
- Create: `packages/shared/src/score-center/priority.ts` — Priority Score V1.1 pure function.
- Create: `packages/shared/src/score-center/plan.ts` — prerequisite gate, quotas, novelty cap, cooldown, time-budget composition.
- Create: `packages/shared/src/score-center/index.ts` — public exports.
- Modify: `packages/shared/src/index.ts` — export score-center package surface.

### API

- Create: `apps/api/src/score-center/repository.ts` — Prisma persistence for evidence, attempts, mastery, wrong records, reviews, and recommendation batches.
- Create: `apps/api/src/score-center/service.ts` — transactional orchestration and DTO conversion.
- Create: `apps/api/src/score-center/routes.ts` — HTTP handlers for knowledge detail, attempts, reviews, generate/today recommendations.
- Create: `apps/api/src/score-center/index.ts` — feature export.
- Modify: `apps/api/src/app.ts` — mount score-center routes under `/api`.

### Web

- Create: `apps/web/src/features/today-score-center/api.ts` — API client for today/generate/attempt completion.
- Create: `apps/web/src/features/today-score-center/types.ts` — UI DTO types if not imported directly from shared.
- Create: `apps/web/src/features/today-score-center/reason-copy.ts` — reason-code-to-Chinese-copy mapping.
- Create: `apps/web/src/features/today-score-center/TodaysScoreCenter.tsx` — page-level feature component.
- Create: `apps/web/src/features/today-score-center/RecommendationCard.tsx` — task card.
- Create: `apps/web/src/features/today-score-center/WhyRecommendedDrawer.tsx` — explanation panel.
- Modify: `apps/web/src/main.ts` — register/navigation entry to today score center in the current web shell.

### Tests

- Create: `test/score-center-priority.test.mjs`
- Create: `test/score-center-plan.test.mjs`
- Create: `test/score-center-mastery.test.mjs`
- Create: `test/score-center-data.test.mjs`
- Modify: `scripts/integration-postgres.mjs` — add transaction/idempotency integration cases.
- Modify: `scripts/verify-ui.mjs` — capture/validate desktop + mobile state for Today Score Center.

> Repository alignment note: the public branch already exposes `apps/api`, `apps/web`, `packages/shared`, `prisma/schema.prisma`, root `node --test`, PostgreSQL integration tests, and migration smoke scripts. If the local branch renamed only the API/web bootstrap files, update those two wiring paths before Task 7 without changing the module boundaries above.

---

### Task 1: Add Score-Center Database Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `test/score-center-data.test.mjs`

**Interfaces:**
- Produces: Prisma models `KnowledgeNode`, `KnowledgeRelation`, `ExamPaper`, `ExamQuestion`, `ExamQuestionKnowledgeTag`, `KnowledgeFrequencySnapshot`, `UserKnowledgeMastery`, `QuestionAttempt`, `WrongQuestionRecord`, `ReviewRecord`, `DailyRecommendationBatch`, `DailyRecommendationItem`.
- Produces enums: `KnowledgeRelationType`, `ExamTagRole`, `ExamTagPrecision`, `ExamTagger`, `WrongReason`, `RecommendationAction`, `RecommendationStatus`, `TrendDirection`, `EvidenceConfidence`.

- [ ] **Step 1: Write the schema-presence test**

Create `test/score-center-data.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema = fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

const requiredModels = [
  'KnowledgeNode',
  'KnowledgeRelation',
  'ExamPaper',
  'ExamQuestion',
  'ExamQuestionKnowledgeTag',
  'KnowledgeFrequencySnapshot',
  'UserKnowledgeMastery',
  'QuestionAttempt',
  'WrongQuestionRecord',
  'ReviewRecord',
  'DailyRecommendationBatch',
  'DailyRecommendationItem',
];

test('score-center prisma models exist', () => {
  for (const model of requiredModels) {
    assert.match(schema, new RegExp(`model\\s+${model}\\s+\\{`));
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- --test-name-pattern="score-center prisma models exist"
```

Expected: FAIL because the models are not yet in `schema.prisma`.

- [ ] **Step 3: Add enums to `prisma/schema.prisma`**

Add:

```prisma
enum KnowledgeRelationType {
  PREREQUISITE
  RELATED
  CROSS_SUBJECT
  CONFUSED_WITH
  SUPERSEDES
}

enum ExamTagRole {
  PRIMARY
  SECONDARY
}

enum ExamTagPrecision {
  EXACT_ATOMIC
  BROAD_HISTORICAL
}

enum ExamTagger {
  AI
  HUMAN
  HYBRID
}

enum WrongReason {
  CONCEPT
  CALCULATION
  MEMORY
  READING
  CARELESS
  UNKNOWN
}

enum RecommendationAction {
  LEARN
  REVIEW
  PRACTICE
  WRONG_QUESTION
  MOCK
}

enum RecommendationStatus {
  PENDING
  STARTED
  COMPLETED
  SKIPPED
}

enum TrendDirection {
  RISING
  STABLE
  FALLING
  COLD
}

enum EvidenceConfidence {
  HIGH
  MEDIUM
  LOW
}
```

- [ ] **Step 4: Add global knowledge/exam models**

Add:

```prisma
model KnowledgeNode {
  id              String   @id
  parentId        String?
  subject         String
  nodeType        String
  name            String
  importance      Int
  difficulty      Int
  syllabusVersion String
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  parent          KnowledgeNode?  @relation("KnowledgeTree", fields: [parentId], references: [id])
  children        KnowledgeNode[] @relation("KnowledgeTree")
  outgoing        KnowledgeRelation[] @relation("RelationFrom")
  incoming        KnowledgeRelation[] @relation("RelationTo")
  examTags        ExamQuestionKnowledgeTag[]
  frequency       KnowledgeFrequencySnapshot[]

  @@index([parentId])
  @@index([subject, nodeType])
  @@index([isActive])
}

model KnowledgeRelation {
  id        String                @id @default(cuid())
  fromId    String
  toId      String
  type      KnowledgeRelationType
  createdAt DateTime              @default(now())

  from      KnowledgeNode @relation("RelationFrom", fields: [fromId], references: [id], onDelete: Cascade)
  to        KnowledgeNode @relation("RelationTo", fields: [toId], references: [id], onDelete: Cascade)

  @@unique([fromId, toId, type])
  @@index([toId, type])
}

model ExamPaper {
  id         String   @id
  exam       String
  year       Int
  totalScore Int
  source     String?
  createdAt  DateTime @default(now())

  questions  ExamQuestion[]

  @@unique([exam, year])
}

model ExamQuestion {
  id           String   @id
  paperId      String
  questionNo   Int
  subject      String
  questionType String
  score        Int?
  summary      String?
  sourceRef    String?
  createdAt    DateTime @default(now())

  paper        ExamPaper @relation(fields: [paperId], references: [id], onDelete: Cascade)
  tags         ExamQuestionKnowledgeTag[]

  @@unique([paperId, questionNo])
  @@index([subject, questionType])
}

model ExamQuestionKnowledgeTag {
  id               String           @id @default(cuid())
  questionId       String
  knowledgePointId String
  role             ExamTagRole
  confidence       Float
  precision        ExamTagPrecision
  taggedBy         ExamTagger
  createdAt        DateTime         @default(now())

  question         ExamQuestion  @relation(fields: [questionId], references: [id], onDelete: Cascade)
  knowledgePoint   KnowledgeNode @relation(fields: [knowledgePointId], references: [id])

  @@unique([questionId, knowledgePointId, role])
  @@index([knowledgePointId, precision, role])
}

model KnowledgeFrequencySnapshot {
  id                 String             @id @default(cuid())
  knowledgePointId   String
  snapshotDate       DateTime
  recent3Frequency   Int
  recent5Frequency   Int
  allTimeEvidence    Int
  primaryScore5y     Int
  trendDirection     TrendDirection
  trendDelta         Float
  evidenceConfidence EvidenceConfidence
  modelVersion       String
  createdAt          DateTime           @default(now())

  knowledgePoint     KnowledgeNode @relation(fields: [knowledgePointId], references: [id])

  @@unique([knowledgePointId, snapshotDate, modelVersion])
  @@index([snapshotDate, modelVersion])
}
```

- [ ] **Step 5: Add user-state and recommendation models**

Add:

```prisma
model UserKnowledgeMastery {
  id              String   @id @default(cuid())
  userId          String
  knowledgePointId String
  mastery         Float    @default(0.5)
  accuracy        Float    @default(0.55)
  recentAccuracy  Float    @default(0.55)
  attempts        Int      @default(0)
  correctCount    Int      @default(0)
  wrongCount      Int      @default(0)
  retention       Float?
  stabilityDays   Float?
  lastLearnedAt   DateTime?
  lastReviewedAt  DateTime?
  nextReviewAt    DateTime?
  confidence      Float    @default(0.0)
  pinned          Boolean  @default(false)
  updatedAt       DateTime @updatedAt
  createdAt       DateTime @default(now())

  @@unique([userId, knowledgePointId])
  @@index([userId, nextReviewAt])
}

model QuestionAttempt {
  id               String   @id @default(cuid())
  userId           String
  questionId       String
  isCorrect        Boolean
  scoreEarned      Float?
  durationSeconds  Int?
  answerConfidence Float?
  createdAt        DateTime @default(now())

  @@index([userId, questionId, createdAt])
}

model WrongQuestionRecord {
  id               String      @id @default(cuid())
  userId           String
  questionId       String
  wrongReason      WrongReason @default(UNKNOWN)
  firstWrongAt     DateTime    @default(now())
  lastWrongAt      DateTime    @default(now())
  wrongCount       Int         @default(1)
  resolved         Boolean     @default(false)
  resolvedAt       DateTime?

  @@unique([userId, questionId])
  @@index([userId, resolved, lastWrongAt])
}

model ReviewRecord {
  id               String   @id @default(cuid())
  userId           String
  knowledgePointId String
  reviewType       String
  quality          Int
  durationSeconds  Int?
  beforeRetention  Float?
  afterRetention   Float?
  reviewedAt       DateTime @default(now())

  @@index([userId, knowledgePointId, reviewedAt])
}

model DailyRecommendationBatch {
  id               String   @id @default(cuid())
  userId           String
  planDate         DateTime
  targetExamDate   DateTime
  availableMinutes Int
  modelVersion     String
  stale            Boolean  @default(false)
  createdAt        DateTime @default(now())

  items            DailyRecommendationItem[]

  @@index([userId, planDate, createdAt])
}

model DailyRecommendationItem {
  id               String               @id @default(cuid())
  batchId          String
  knowledgePointId String
  priorityScore    Int
  action           RecommendationAction
  estimatedMinutes Int
  reasonCodes      Json
  rank             Int
  status           RecommendationStatus @default(PENDING)
  completedAt      DateTime?
  scoreBreakdown   Json
  createdAt        DateTime             @default(now())

  batch            DailyRecommendationBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)

  @@unique([batchId, knowledgePointId])
  @@index([batchId, rank])
}
```

- [ ] **Step 6: Validate Prisma schema**

Run:

```bash
npx prisma format
npx prisma validate
```

Expected: both commands exit 0.

- [ ] **Step 7: Generate and apply a development migration**

Run:

```bash
npx prisma migrate dev --name add_408_today_score_center
```

Expected: migration is created and Prisma Client regenerates successfully.

- [ ] **Step 8: Run schema test**

Run:

```bash
npm test -- --test-name-pattern="score-center prisma models exist"
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add prisma test/score-center-data.test.mjs
git commit -m "feat: add score center data model"
```

---

### Task 2: Seed Knowledge Tree V2, Exam Evidence, and Frequency Snapshot

**Files:**
- Create: `scripts/seed-408-v2.mjs`
- Create: `scripts/verify-408-data.mjs`
- Modify: `package.json`
- Test: `test/score-center-data.test.mjs`
- Input artifacts:
  - `knowledge-tree-408-v2.json`
  - `408-2022-question-knowledge-map.json` … `408-2026-question-knowledge-map.json`
  - `408-2009-2021-historical-question-index.json`
  - `frequency-model-v2.json`

**Interfaces:**
- Produces command: `npm run seed:408`
- Produces command: `npm run verify:408-data`
- Guarantees: 2022–2026 exact tags use `EXACT_ATOMIC`; broad historical tags never contribute exact primary score.

- [ ] **Step 1: Extend the data test with canonical subject-score assertions**

Append to `test/score-center-data.test.mjs`:

```js
const expected = { DS: 45, CO: 45, OS: 35, CN: 25 };

test('canonical 408 subject score totals are stable', () => {
  assert.deepEqual(expected, { DS: 45, CO: 45, OS: 35, CN: 25 });
});
```

- [ ] **Step 2: Add npm scripts**

Add to root `package.json` scripts:

```json
{
  "seed:408": "node scripts/seed-408-v2.mjs",
  "verify:408-data": "node scripts/verify-408-data.mjs"
}
```

- [ ] **Step 3: Implement `scripts/verify-408-data.mjs`**

The script must:

```js
const expectedSubjectScores = { DS: 45, CO: 45, OS: 35, CN: 25 };

function assertAtomicId(id, atomicIds, context) {
  if (!atomicIds.has(id)) {
    throw new Error(`${context}: unknown atomic knowledge point ${id}`);
  }
}
```

Then validate:

1. Every `parentId` exists.
2. Every exact primary/secondary tag targets `nodeType === 'atomicPoint'`.
3. Every 2022–2026 paper has 47 questions and 150 points.
4. Subject totals equal DS45 / CO45 / OS35 / CN25.
5. Historical broad evidence is not assigned `PRIMARY + EXACT_ATOMIC`.
6. Frequency-model knowledge IDs exist in V2.

Exit non-zero on the first violation.

- [ ] **Step 4: Run the verifier before writing seed code**

Run:

```bash
npm run verify:408-data
```

Expected: PASS against the generated V2 artifact bundle.

- [ ] **Step 5: Implement idempotent knowledge-tree upsert**

In `scripts/seed-408-v2.mjs`, upsert each node with stable string ID:

```js
await prisma.knowledgeNode.upsert({
  where: { id: node.id },
  update: {
    parentId: node.parentId,
    subject: node.subject,
    nodeType: node.nodeType,
    name: node.name,
    importance: node.importance,
    difficulty: node.difficulty,
    syllabusVersion: node.syllabusVersion,
    isActive: true,
  },
  create: {
    id: node.id,
    parentId: node.parentId,
    subject: node.subject,
    nodeType: node.nodeType,
    name: node.name,
    importance: node.importance,
    difficulty: node.difficulty,
    syllabusVersion: node.syllabusVersion,
  },
});
```

- [ ] **Step 6: Import relations after nodes**

For each prerequisite/related relation from V2, insert with `upsert` or `createMany({ skipDuplicates: true })` so reruns are safe.

- [ ] **Step 7: Import 2022–2026 exact papers/questions/tags**

Use:

```js
precision: 'EXACT_ATOMIC',
taggedBy: 'HYBRID',
role: tag.isPrimary ? 'PRIMARY' : 'SECONDARY',
confidence: tag.confidence,
```

Do not import full copyrighted question text; use only metadata and self-written summary/reference.

- [ ] **Step 8: Import 2009–2021 historical question slots and broad evidence**

For broad historical tags use:

```js
precision: 'BROAD_HISTORICAL',
taggedBy: 'HYBRID',
role: 'SECONDARY',
```

Do not convert them to exact atomic primary tags.

- [ ] **Step 9: Import frequency-model snapshot**

Create one `KnowledgeFrequencySnapshot` per atomic point with:

```js
snapshotDate: new Date('2026-08-07T00:00:00.000Z'),
modelVersion: 'frequency-v2-2026-08-07',
recent3Frequency: item.recent3Y.frequency,
recent5Frequency: item.recent5Y.frequency,
allTimeEvidence: item.allTimeEvidence.frequency,
primaryScore5y: item.recent5Y.primaryScore,
trendDirection: item.trend.direction.toUpperCase(),
trendDelta: item.trend.delta,
evidenceConfidence: item.evidenceConfidence.toUpperCase(),
```

- [ ] **Step 10: Verify idempotency**

Run twice:

```bash
npm run seed:408
npm run seed:408
```

Expected: second run succeeds without duplicate-key errors and row counts remain stable.

- [ ] **Step 11: Run repository checks**

```bash
npm run verify:408-data
npm run smoke:migration
npm test
```

Expected: all PASS.

- [ ] **Step 12: Commit**

```bash
git add package.json scripts/seed-408-v2.mjs scripts/verify-408-data.mjs test/score-center-data.test.mjs
git commit -m "feat: seed 408 knowledge and exam evidence"
```

---

### Task 3: Implement Mastery and Retention Updates as Pure Functions

**Files:**
- Create: `packages/shared/src/score-center/types.ts`
- Create: `packages/shared/src/score-center/mastery.ts`
- Create: `packages/shared/src/score-center/index.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `test/score-center-mastery.test.mjs`

**Interfaces:**
- Produces:

```ts
export type MasteryState = {
  mastery: number;
  accuracy: number;
  recentAccuracy: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  confidence: number;
};

export type AttemptSignal = {
  isCorrect: boolean;
  difficulty: 1 | 2 | 3 | 4 | 5;
  role: 'PRIMARY' | 'SECONDARY';
};

export function updateMasteryAfterAttempt(
  state: MasteryState,
  signal: AttemptSignal,
): MasteryState;

export function estimateRetention(
  lastReviewedAt: Date | null,
  stabilityDays: number | null,
  now: Date,
): number;

export function updateStabilityAfterReview(
  previousStabilityDays: number | null,
  quality: 0 | 1 | 2 | 3 | 4 | 5,
): number;
```

- [ ] **Step 1: Write failing mastery tests**

Create `test/score-center-mastery.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updateMasteryAfterAttempt,
  estimateRetention,
  updateStabilityAfterReview,
} from '../packages/shared/dist/index.js';

const base = {
  mastery: 0.5,
  accuracy: 0.5,
  recentAccuracy: 0.5,
  attempts: 10,
  correctCount: 5,
  wrongCount: 5,
  confidence: 0.5,
};

test('correct primary answer raises mastery', () => {
  const next = updateMasteryAfterAttempt(base, {
    isCorrect: true,
    difficulty: 4,
    role: 'PRIMARY',
  });
  assert.ok(next.mastery > base.mastery);
});

test('secondary tag changes mastery less than primary', () => {
  const primary = updateMasteryAfterAttempt(base, { isCorrect: false, difficulty: 2, role: 'PRIMARY' });
  const secondary = updateMasteryAfterAttempt(base, { isCorrect: false, difficulty: 2, role: 'SECONDARY' });
  assert.ok(Math.abs(primary.mastery - base.mastery) > Math.abs(secondary.mastery - base.mastery));
});

test('retention decays with elapsed time', () => {
  const last = new Date('2026-08-01T00:00:00Z');
  const early = estimateRetention(last, 10, new Date('2026-08-02T00:00:00Z'));
  const late = estimateRetention(last, 10, new Date('2026-08-08T00:00:00Z'));
  assert.ok(early > late);
});
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm test -- --test-name-pattern="mastery|retention|secondary tag"
```

Expected: FAIL because exports do not exist.

- [ ] **Step 3: Implement clamped exponential smoothing**

Use these exact constants in `mastery.ts`:

```ts
const PRIMARY_ALPHA = 0.18;
const SECONDARY_ALPHA = 0.07;
const RECENT_ACCURACY_ALPHA = 0.20;

const targetForAttempt = (isCorrect: boolean, difficulty: number) => {
  if (isCorrect) return Math.min(1, 0.72 + difficulty * 0.055);
  return Math.max(0, 0.38 - (difficulty - 1) * 0.045);
};
```

Then:

```ts
nextMastery = current + alpha * (target - current);
```

Update cumulative accuracy from counts; update `recentAccuracy` with exponential smoothing; increase `confidence` toward 1 using:

```ts
confidence = Math.min(1, 1 - Math.exp(-(attempts + 1) / 12));
```

- [ ] **Step 4: Implement retention decay**

Use:

```ts
retention = Math.exp(-elapsedDays / Math.max(1, stabilityDays));
```

Clamp to `[0, 1]`; if never reviewed, return neutral `0.5` rather than `0`.

- [ ] **Step 5: Implement review stability update**

Use multipliers:

```ts
const multiplier = [0.6, 0.8, 1.0, 1.35, 1.7, 2.1][quality];
const base = previousStabilityDays ?? 1;
return Math.max(0.5, base * multiplier);
```

- [ ] **Step 6: Export feature from shared package**

Add to `packages/shared/src/index.ts`:

```ts
export * from './score-center/index.js';
```

- [ ] **Step 7: Run tests**

```bash
npm test -- --test-name-pattern="mastery|retention|secondary tag"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/score-center packages/shared/src/index.ts test/score-center-mastery.test.mjs
git commit -m "feat: add mastery and retention model"
```

---

### Task 4: Implement Priority Score V1.1

**Files:**
- Create: `packages/shared/src/score-center/priority.ts`
- Modify: `packages/shared/src/score-center/types.ts`
- Create: `test/score-center-priority.test.mjs`

**Interfaces:**
- Consumes `ExamEvidence`, `UserKnowledgeState`, `PriorityContext`.
- Produces:

```ts
export type PriorityReasonCode =
  | 'HIGH_RECENT_FREQUENCY'
  | 'LOW_MASTERY'
  | 'LOW_ACCURACY'
  | 'REPEATED_WRONG'
  | 'REVIEW_DUE'
  | 'RISING_TREND'
  | 'PREREQUISITE_GAP'
  | 'EXAM_NEAR'
  | 'LOW_EVIDENCE';

export type PriorityResult = {
  score: number;
  reasons: PriorityReasonCode[];
  breakdown: {
    examValue: number;
    weakness: number;
    forgetting: number;
    difficulty: number;
    trend: number;
    pinned: number;
  };
};

export function calculatePriority(
  evidence: ExamEvidence,
  user: UserKnowledgeState | undefined,
  context: PriorityContext,
): PriorityResult;
```

- [ ] **Step 1: Write monotonicity and bounds tests**

Create `test/score-center-priority.test.mjs` with these cases:

```js
test('lower mastery never lowers priority', () => { /* same evidence, compare mastery .8 vs .3 */ });
test('lower retention never lowers priority', () => { /* compare .9 vs .3 */ });
test('score is always 0..100', () => { /* extreme inputs */ });
test('near exam increases relative value of recent high-frequency point', () => { /* compare 300 vs 30 days */ });
test('low-frequency hard point cannot outrank high-frequency weak point in sprint', () => { /* explicit pair */ });
```

Use concrete evidence values:

```js
const hot = {
  knowledgePointId: 'CN-C05-S03-P01',
  importance: 5,
  difficulty: 4,
  recent3Y: { frequency: 5 },
  recent5Y: { frequency: 5, primaryCount: 4, secondaryCount: 2, primaryScore: 12 },
  allTimeEvidence: { frequency: 5 },
  trend: { direction: 'RISING', delta: 0.6 },
};
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npm test -- --test-name-pattern="priority|near exam|sprint"
```

Expected: FAIL.

- [ ] **Step 3: Implement exact component weights**

Use:

```ts
const COMPONENT_WEIGHTS = {
  examValue: 0.37,
  weakness: 0.32,
  forgetting: 0.16,
  difficulty: 0.07,
  trend: 0.05,
  pinned: 0.03,
} as const;
```

Exam value:

```ts
0.38 * recent3 +
0.30 * recent5 +
0.16 * allTime +
0.10 * importance +
0.06 * primaryScore5y;
```

Weakness:

```ts
0.52 * (1 - mastery) +
0.38 * (1 - recentAccuracy) +
0.10 * min(1, wrongCount / 8);
```

- [ ] **Step 4: Implement phase-dependent multipliers**

Use exactly:

```ts
if (daysToExam <= 45) return { exam: 1.18, weakness: 1.12, difficulty: 0.82 };
if (daysToExam <= 150) return { exam: 1.08, weakness: 1.05, difficulty: 1.00 };
return { exam: 0.92, weakness: 0.95, difficulty: 1.12 };
```

- [ ] **Step 5: Implement deterministic reason codes**

Rules:

```ts
if (recent3Frequency >= 4) reasons.push('HIGH_RECENT_FREQUENCY');
if (mastery < 0.55) reasons.push('LOW_MASTERY');
if (recentAccuracy < 0.65) reasons.push('LOW_ACCURACY');
if (wrongCount >= 3) reasons.push('REPEATED_WRONG');
if (forgetting >= 0.55) reasons.push('REVIEW_DUE');
if (trendDirection === 'RISING') reasons.push('RISING_TREND');
if (daysToExam <= 45) reasons.push('EXAM_NEAR');
if (evidenceConfidence === 'LOW') reasons.push('LOW_EVIDENCE');
```

Return at least two reasons by adding the two highest-contributing generic reason categories if threshold rules yield fewer than two.

- [ ] **Step 6: Run tests**

```bash
npm test -- --test-name-pattern="priority|near exam|sprint"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/score-center/priority.ts packages/shared/src/score-center/types.ts test/score-center-priority.test.mjs
git commit -m "feat: implement explainable priority score"
```

---

### Task 5: Implement Daily Plan Composer Constraints

**Files:**
- Create: `packages/shared/src/score-center/plan.ts`
- Create: `test/score-center-plan.test.mjs`

**Interfaces:**
- Consumes ranked `PriorityCandidate[]`, prerequisite mastery map, `availableMinutes`, `daysToExam`.
- Produces:

```ts
export type RecommendationDraft = {
  knowledgePointId: string;
  score: number;
  action: 'LEARN' | 'REVIEW' | 'PRACTICE' | 'WRONG_QUESTION' | 'MOCK';
  estimatedMinutes: number;
  reasonCodes: PriorityReasonCode[];
  replacedByPrerequisiteOf?: string;
};

export function composeDailyPlan(input: {
  candidates: PriorityCandidate[];
  availableMinutes: 30 | 60 | 120 | 180;
  daysToExam: number;
}): RecommendationDraft[];
```

- [ ] **Step 1: Write failing constraint tests**

Cover:

```js
test('prerequisite gate replaces high-level task when prerequisite mastery < .45', () => {});
test('120-minute plan covers at least two subjects when candidates allow it', () => {});
test('foundation plan caps new LEARN time/items at 40 percent', () => {});
test('high-retention recently reviewed item enters cooldown', () => {});
test('plan does not exceed requested time budget', () => {});
test('30 minute plan returns a compact 1-3 task plan', () => {});
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm test -- --test-name-pattern="prerequisite|time budget|two subjects|cooldown|40 percent"
```

Expected: FAIL.

- [ ] **Step 3: Implement action classifier**

Rules:

```ts
if (recentWrongCount >= 2) return 'WRONG_QUESTION';
if (forgetting >= 0.55) return 'REVIEW';
if (mastery < 0.45) return 'LEARN';
if (recentAccuracy < 0.70) return 'PRACTICE';
if (daysToExam <= 45 && mastery >= 0.75) return 'MOCK';
return 'PRACTICE';
```

- [ ] **Step 4: Implement duration estimator**

Use:

```ts
if (action === 'REVIEW') return difficulty >= 4 ? 20 : 15;
if (action === 'WRONG_QUESTION') return difficulty >= 4 ? 30 : 20;
if (action === 'LEARN') return difficulty >= 4 ? 35 : 20;
if (action === 'MOCK') return 30;
return difficulty >= 4 ? 30 : 20;
```

- [ ] **Step 5: Implement prerequisite gate before quota selection**

If a candidate has any prerequisite with mastery `< 0.45`, replace that candidate with the lowest-mastery unmet prerequisite and add `PREREQUISITE_GAP`.

Deduplicate by knowledge-point ID before further selection.

- [ ] **Step 6: Implement cooldown**

If:

```ts
hoursSinceReview <= 36 && retention >= 0.85 && recentWrongCount === 0
```

multiply candidate score by `0.55`. Do not remove the candidate entirely.

- [ ] **Step 7: Implement subject quota**

For plans `>= 60` minutes, choose at least one item from the highest-ranked second subject if the candidate pool contains at least two subjects and doing so stays within budget.

Do not enforce a four-subject daily quota.

- [ ] **Step 8: Implement foundation novelty cap**

When `daysToExam > 150`, `LEARN` items may be at most `ceil(itemCount * 0.40)` after final composition. Replace excess LEARN candidates with REVIEW/PRACTICE candidates by descending score.

- [ ] **Step 9: Implement time-budget packing**

Sort by adjusted priority; greedily add tasks while preserving quota/cap rules and never exceed `availableMinutes`.

Target item counts:

- 30 min: 1–3
- 60 min: 2–5
- 120 min: 5–10
- 180 min: 7–15

- [ ] **Step 10: Run tests**

```bash
npm test -- --test-name-pattern="prerequisite|time budget|two subjects|cooldown|40 percent"
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/score-center/plan.ts test/score-center-plan.test.mjs
git commit -m "feat: compose balanced daily study plans"
```

---

### Task 6: Implement API Repository and Transactional Service

**Files:**
- Create: `apps/api/src/score-center/repository.ts`
- Create: `apps/api/src/score-center/service.ts`
- Create: `apps/api/src/score-center/index.ts`
- Modify: `scripts/integration-postgres.mjs`

**Interfaces:**
- Produces repository functions:

```ts
getKnowledgeDetail(userId: string, knowledgePointId: string)
recordAttempt(input: RecordAttemptInput)
recordReview(input: RecordReviewInput)
loadRecommendationCandidates(userId: string)
saveRecommendationBatch(input: SaveBatchInput)
getTodayBatch(userId: string, planDate: Date)
```

- Produces service methods:

```ts
submitAttempt(input: SubmitAttemptInput): Promise<AttemptResult>
submitReview(input: SubmitReviewInput): Promise<ReviewResult>
generateDailyRecommendation(input: GeneratePlanInput): Promise<RecommendationBatchDto>
getTodayRecommendation(userId: string, now: Date): Promise<RecommendationBatchDto | null>
```

- [ ] **Step 1: Add integration test for attempt transaction**

In `scripts/integration-postgres.mjs`, add a test scenario that:

1. Creates one atomic point, one paper/question, one exact primary tag.
2. Calls `submitAttempt({ isCorrect: true })`.
3. Asserts one `QuestionAttempt` exists.
4. Asserts one `UserKnowledgeMastery` exists with `attempts === 1` and `correctCount === 1`.

- [ ] **Step 2: Add integration test for repeated wrong record**

Call the same question wrong twice and assert:

```js
wrongRecords.length === 1
wrongRecords[0].wrongCount === 2
wrongRecords[0].resolved === false
```

- [ ] **Step 3: Run PostgreSQL integration tests and confirm failure**

```bash
npm run db:test:up
npm run test:integration:postgres
```

Expected: FAIL because the score-center service does not exist.

- [ ] **Step 4: Implement `repository.ts` query surface**

All write helpers must accept either `PrismaClient` or `Prisma.TransactionClient` so the service controls transaction boundaries.

Example signature:

```ts
export type DbClient = PrismaClient | Prisma.TransactionClient;

export async function findQuestionWithTags(db: DbClient, questionId: string) {
  return db.examQuestion.findUnique({
    where: { id: questionId },
    include: { tags: { include: { knowledgePoint: true } } },
  });
}
```

- [ ] **Step 5: Implement `submitAttempt` as one Prisma transaction**

Inside `$transaction`:

1. Load question + tags; reject unknown question.
2. Reject any tag target that is not an active atomic knowledge point.
3. Insert `QuestionAttempt`.
4. For each exact atomic tag, load/create neutral mastery.
5. Apply `updateMasteryAfterAttempt`; secondary tags use `SECONDARY` signal.
6. Upsert user mastery.
7. If wrong, upsert a single `WrongQuestionRecord` and increment `wrongCount`.
8. If correct and an active wrong record exists, do not auto-resolve it yet; resolution remains a separate explicit action or later policy.
9. Mark matching today recommendation item `COMPLETED` when the question is launched from that item.

- [ ] **Step 6: Implement `submitReview` transaction**

1. Reject nonexistent/deprecated knowledge point.
2. Read current user mastery.
3. Compute `beforeRetention` from current state.
4. Update stability from quality and set `lastReviewedAt`.
5. Compute `afterRetention = 1` for a completed review.
6. Set `nextReviewAt = reviewedAt + stabilityDays`.
7. Insert `ReviewRecord`.
8. Upsert mastery.

- [ ] **Step 7: Implement candidate loading**

Query active atomic points + latest frequency snapshot + user mastery + prerequisite relations. Return neutral user state for missing rows without creating them.

- [ ] **Step 8: Implement recommendation generation**

For every candidate:

```ts
const priority = calculatePriority(evidence, userState, context);
```

Then pass ranked candidates to `composeDailyPlan`, persist one batch plus items and full `scoreBreakdown`/`reasonCodes` JSON.

- [ ] **Step 9: Implement same-day idempotency**

`getTodayRecommendation` uses the user’s local plan date; generation returns the latest non-stale batch for that date unless caller explicitly requests refresh.

On refresh, mark the old batch `stale = true` and create a new batch.

- [ ] **Step 10: Run integration tests**

```bash
npm run test:integration:postgres
```

Expected: attempt/mastery/wrong-record transaction cases PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/score-center scripts/integration-postgres.mjs
git commit -m "feat: add transactional score center service"
```

---

### Task 7: Expose HTTP API

**Files:**
- Create: `apps/api/src/score-center/routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `scripts/integration-postgres.mjs`

**Interfaces:**
- `GET /api/knowledge/:id`
- `POST /api/questions/:id/attempts`
- `POST /api/reviews`
- `POST /api/recommendations/generate`
- `GET /api/recommendations/today`

- [ ] **Step 1: Add HTTP integration tests**

Add cases for:

```text
GET /api/knowledge/:id            -> 200 + evidence + relations + userState
POST /api/questions/:id/attempts  -> 201 + updated mastery
POST /api/reviews                 -> 201 + nextReviewAt
POST /api/recommendations/generate-> 201 + 1 batch + items
GET /api/recommendations/today    -> 200 same batch id on repeated calls
```

Also assert:

```text
unknown knowledge point -> 404
invalid availableMinutes -> 400
availableMinutes must be one of 30,60,120,180
```

- [ ] **Step 2: Run integration tests and confirm route failures**

```bash
npm run test:integration:postgres
```

Expected: FAIL/404 for new endpoints.

- [ ] **Step 3: Implement input validation in routes**

Do not coerce arbitrary values. For generation:

```ts
const allowedMinutes = new Set([30, 60, 120, 180]);
if (!allowedMinutes.has(body.availableMinutes)) {
  return res.status(400).json({ error: 'INVALID_AVAILABLE_MINUTES' });
}
```

Validate `targetExamDate` as an ISO date in the future or today.

- [ ] **Step 4: Implement knowledge detail endpoint**

Response shape:

```json
{
  "knowledgePoint": {},
  "frequency": {},
  "relations": { "prerequisites": [], "related": [] },
  "userState": null
}
```

`userState: null` means no personal evidence, not poor mastery.

- [ ] **Step 5: Implement attempt and review endpoints**

Return 201 and updated user state. Preserve service error codes rather than parsing error-message strings.

- [ ] **Step 6: Implement generate/today recommendation endpoints**

Generate input:

```json
{
  "targetExamDate": "2027-12-20",
  "availableMinutes": 120,
  "subjectConstraints": []
}
```

Today supports `?refresh=true`; otherwise it is idempotent.

- [ ] **Step 7: Mount routes in `apps/api/src/app.ts`**

Mount all feature routes once under `/api` and reuse the application’s existing authentication/user-ID middleware.

Do not accept `userId` from public JSON bodies when authenticated user context exists.

- [ ] **Step 8: Run integration tests**

```bash
npm run test:integration:postgres
```

Expected: all new endpoint cases PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/score-center/routes.ts apps/api/src/app.ts scripts/integration-postgres.mjs
git commit -m "feat: expose today score center api"
```

---

### Task 8: Build Today Score Center Web Feature

**Files:**
- Create: `apps/web/src/features/today-score-center/api.ts`
- Create: `apps/web/src/features/today-score-center/types.ts`
- Create: `apps/web/src/features/today-score-center/reason-copy.ts`
- Create: `apps/web/src/features/today-score-center/RecommendationCard.tsx`
- Create: `apps/web/src/features/today-score-center/WhyRecommendedDrawer.tsx`
- Create: `apps/web/src/features/today-score-center/TodaysScoreCenter.tsx`
- Modify: `apps/web/src/main.ts`
- Modify: `scripts/verify-ui.mjs`

**Interfaces:**
- Consumes `GET /api/recommendations/today` and `POST /api/recommendations/generate`.
- Produces a UI with summary, Top 3, full list, 30/60/120/180 minute controls, subject filter, explain drawer, and task completion state.

- [ ] **Step 1: Add reason-code copy map**

Create `reason-copy.ts`:

```ts
export const reasonCopy = {
  HIGH_RECENT_FREQUENCY: '近 3 年高频考查',
  LOW_MASTERY: '当前掌握度偏低',
  LOW_ACCURACY: '近期正确率偏低',
  REPEATED_WRONG: '近期重复出错',
  REVIEW_DUE: '已进入建议复习区间',
  RISING_TREND: '近年考查趋势上升',
  PREREQUISITE_GAP: '先补齐前置知识',
  EXAM_NEAR: '临近考试，提高近期真题权重',
  LOW_EVIDENCE: '个人数据较少，当前为冷启动建议',
} as const;
```

No free-form AI explanation is required for MVP.

- [ ] **Step 2: Implement API client**

Provide:

```ts
getTodayRecommendation()
generateRecommendation({ targetExamDate, availableMinutes, refresh })
```

Throw typed errors with status/error code.

- [ ] **Step 3: Implement `RecommendationCard`**

Render:

- subject + atomic point name
- Priority Score 0–100
- action label
- estimated minutes
- 2–3 reason chips
- recent accuracy / retention when available
- primary CTA “开始练习”

Do not expose internal raw weight math on the card.

- [ ] **Step 4: Implement explanation drawer**

Show:

```text
Recent 3Y
Recent 5Y
All Time Evidence
Mastery
Recent Accuracy
Retention
Prerequisite state
Score component breakdown
```

If user evidence is missing, display “暂无个人做题数据，当前按中性冷启动值计算”.

- [ ] **Step 5: Implement page summary and time controls**

First screen:

- total recommended minutes
- completion progress
- top 3 tasks
- segmented time control 30 / 60 / 120 / 180

Changing time calls generate with `refresh=true` and persists a new batch.

- [ ] **Step 6: Implement full plan list and subject filter**

Filtering changes display only; it must not mutate persisted batch order or Priority Score.

Allow visual reordering only if the existing UI already has drag-and-drop infrastructure; otherwise omit drag in MVP rather than adding a new dependency.

- [ ] **Step 7: Wire the feature into existing web navigation**

Add one entry named `今日提分` / `今日提分中心` in the current shell and render `TodaysScoreCenter` through the project’s existing route/view mechanism.

- [ ] **Step 8: Extend UI verification**

In `scripts/verify-ui.mjs`, capture desktop + mobile screenshots of the Today Score Center and assert:

1. Page title visible.
2. At least one recommendation card visible in seeded/dev state.
3. 30/60/120/180 controls are present.
4. No horizontal overflow at mobile width.

- [ ] **Step 9: Run web verification**

```bash
npm run build:web
npm run verify:ui
```

Expected: build PASS and new desktop/mobile screenshot checks PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/features/today-score-center apps/web/src/main.ts scripts/verify-ui.mjs
git commit -m "feat: add today score center ui"
```

---

### Task 9: End-to-End Recommendation Loop and Stale Fallback

**Files:**
- Modify: `apps/api/src/score-center/service.ts`
- Modify: `apps/api/src/score-center/routes.ts`
- Modify: `apps/web/src/features/today-score-center/TodaysScoreCenter.tsx`
- Modify: `scripts/integration-postgres.mjs`
- Modify: `scripts/smoke-migration.mjs`

**Interfaces:**
- Guarantees one complete loop:

```text
generate plan
→ start/answer question
→ attempt transaction updates mastery/wrong record
→ item completed
→ refresh plan
→ changed priority is persisted in a new batch
```

- [ ] **Step 1: Add E2E-style integration case**

Seed one high-frequency point with low mastery, generate a plan, submit a correct attempt, refresh the plan, and assert either:

- its score decreases, or
- its action changes from `LEARN/WRONG_QUESTION` to `PRACTICE/REVIEW`,

while historical batch data remains unchanged.

- [ ] **Step 2: Add stale fallback integration case**

Simulate recommendation generation failure after a previous batch exists. Assert `GET today` returns the previous batch with:

```json
{ "stale": true }
```

and HTTP 200, not an empty plan.

- [ ] **Step 3: Implement stale fallback**

Generation errors must not mutate the last valid batch. The route may log the error and return the latest valid batch marked stale in DTO output.

- [ ] **Step 4: Implement web stale banner**

If `stale === true`, show a non-blocking banner:

```text
当前展示上一次有效计划，新的推荐计算暂时不可用。
```

Do not block starting existing tasks.

- [ ] **Step 5: Extend migration smoke**

In `scripts/smoke-migration.mjs`, after migrations:

1. Run `verify:408-data`.
2. Confirm one KnowledgeNode query succeeds.
3. Confirm one recommendation batch can be inserted/deleted in the test DB.

- [ ] **Step 6: Run complete verification suite**

```bash
npm test
npm run smoke:migration
npm run db:test:up
npm run test:integration:postgres
npm run build:web
npm run build:api
npm run verify:ui
npm run db:test:down
```

Expected: every command exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/score-center apps/web/src/features/today-score-center scripts/integration-postgres.mjs scripts/smoke-migration.mjs
git commit -m "test: verify score center learning loop"
```

---

### Task 10: Historical Precision Upgrade Without Blocking Product Launch

**Files:**
- Create: `scripts/audit-historical-408-tags.mjs`
- Create: `docs/408-historical-mapping-progress.md`
- Modify: `scripts/verify-408-data.mjs`

**Interfaces:**
- Produces a queue of 2009–2021 questions that still have only `BROAD_HISTORICAL` evidence.
- Does not change Recent3Y/Recent5Y behavior.
- Exact historical upgrades use the same `ExamQuestionKnowledgeTag` table with `EXACT_ATOMIC` precision.

- [ ] **Step 1: Write audit command**

The script groups questions into:

```text
EXACT_ATOMIC_COMPLETE
BROAD_ONLY
UNMAPPED
NEEDS_REVIEW
```

and outputs counts by year/subject.

- [ ] **Step 2: Prioritize the manual/AI review queue**

Sort `BROAD_ONLY/UNMAPPED` by:

1. historical tag frequency,
2. combined-topic/comprehensive questions first,
3. newest year first.

This maximizes AllTimeEvidence accuracy quickly.

- [ ] **Step 3: Document the acceptance rule**

In `docs/408-historical-mapping-progress.md`, require every exact upgrade to have:

- source year/question number,
- one primary atomic point,
- zero or more secondary atomic points,
- confidence,
- reviewer/taggedBy,
- no invented full question text.

- [ ] **Step 4: Extend data verifier**

Reject any row where:

```text
precision = BROAD_HISTORICAL && role = PRIMARY
```

This preserves the evidence boundary permanently.

- [ ] **Step 5: Run verification**

```bash
npm run verify:408-data
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/audit-historical-408-tags.mjs scripts/verify-408-data.mjs docs/408-historical-mapping-progress.md
git commit -m "chore: add historical 408 mapping audit queue"
```

---

## Final Acceptance Checklist

- [ ] `prisma validate` passes.
- [ ] `npm run seed:408` is idempotent.
- [ ] Every V1/V2 knowledge ID remains stable.
- [ ] 2022–2026 exact mappings resolve only to active atomic points.
- [ ] Every 2022–2026 paper totals 150 points with DS45/CO45/OS35/CN25.
- [ ] Broad historical tags never enter exact primary-score calculations.
- [ ] Mastery, recent accuracy, wrong count, and retention update deterministically.
- [ ] Priority obeys monotonic weakness/forgetting tests and remains 0–100.
- [ ] Prerequisite gate, subject quota, novelty cap, cooldown, and time budget all pass tests.
- [ ] Attempt persistence + mastery + wrong-record update is one transaction.
- [ ] Same-day today-plan fetch is idempotent.
- [ ] Refresh preserves the old batch and creates a new snapshot.
- [ ] Recommendation failure falls back to the last valid batch with `stale=true`.
- [ ] Today Score Center works on desktop and mobile.
- [ ] `npm test`, `npm run smoke:migration`, `npm run test:integration:postgres`, `npm run build:web`, `npm run build:api`, and `npm run verify:ui` all pass.

## Recommended Execution Order

Use subagent-driven development with one reviewer gate per task. Tasks 1–5 establish stable contracts; Tasks 6–9 implement the product loop; Task 10 improves historical accuracy independently after the loop is working.
