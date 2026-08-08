# Live Question → Atomic KnowledgeNode Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有 live Question 建立安全、确定性、可审计的 `KnowledgePoint → Atomic KnowledgeNode` 桥接（`KnowledgePointNodeMap` 为主桥接层），使真实 `PracticeRecord → UserKnowledgeMastery` 链路在生产环境开始工作。

**Architecture:** 纯逻辑与 Prisma persistence 分离。确定性 matcher / audit / reconciliation planner 放在 `packages/shared/src/score-center/bridge/`（纯函数，可单测，不依赖 Prisma）；Prisma 写入只在 `scripts/seed-knowledge-bridge.mjs`；resolver 只做最小安全增强（`status = ACTIVE` 过滤）；`seed-408-v2.mjs` 作为部署入口 orchestrator，保持 `deploy.sh` 不变。

**Tech Stack:** TypeScript (shared)、NestJS (API)、Prisma/PostgreSQL、node:test、Vite (web 不变)。

## Global Constraints

- 唯一需求来源：`docs/superpowers/specs/2026-08-08-live-question-atomic-bridge-design.md`。实现不得重新设计；代码与 Spec 冲突时按“兼容设计的最小实施方式”处理并记录。
- **Working tree 隔离**：执行者禁止 `git add .` / `git add -A`；每次提交前必须 `git diff --cached --name-only` 确认只包含当前 Task 文件。
- 以下既有工作区文件永不进入本功能 commit：`prisma/migrations/migration_lock.toml`（diff 为空，仅行尾）、`408-codex-handoff/`、`CODEX-KNOWLEDGE-CATALOG-FIRST-PROMPT.md`、`MANIFEST.json`、`api-run.err.log`、`api-run.log`、`var/`。
- `MEDIUM` 永不参与 mastery；`LOW` 永不入库；resolver 只消费 `ACTIVE`。
- `MANUAL` 永不被 AUTO 覆盖；`REJECTED` 永不被 AUTO 重新激活；stale AUTO → `INACTIVE`（保留历史，禁止 DELETE 重建）。
- 禁止 LLM / embedding / similarity-threshold 自动判定 HIGH；similarity 只用于候选排序、audit 展示、人工审核辅助。
- **`>= 70%` 是 rollout observation gate，不是 matcher threshold**。dry-run 覆盖率 `< 70%` 时：停止上线，输出 `affectedQuestionCount DESC` 的 `PENDING_REVIEW / UNMATCHED` 热点，请求人工 review；禁止自行降低 HIGH 标准、把 MEDIUM 改 ACTIVE、或调用 LLM 猜 mapping。
- 禁止自动生成 `QuestionKnowledgeNodeTag`；本阶段只打通 `QuestionKnowledgePoint → KnowledgePointNodeMap` fallback。
- `ExamQuestion` / `Question` 两套 ID 与语义继续分离；禁止用 `ExamQuestionKnowledgeTag` 反推 live Question mapping。
- 不扩展现有 Priority Engine、Score Center UI、Knowledge Catalog UI、`/today/plan` 语义；不做 retention 衰减、review 事务重构。
- 每个 Task 独立 review、独立 commit；不顺便重构、不扩大范围。

## File Structure

### Existing files expected to modify

- `prisma/schema.prisma` — `KnowledgePointNodeMap` 增加 metadata 字段与枚举；新增 4 个枚举。
- `prisma/migrations/<ts>_add_bridge_metadata/migration.sql` — 新增 additive migration（手写 SQL 策略，见 Migration Safety）。
- `packages/shared/src/score-center/index.ts` — 导出 bridge 模块。
- `apps/api/src/score-center/repository.ts` — fallback 的 `nodeMaps` 查询增加 `where: { status: 'ACTIVE' }`。
- `scripts/seed-408-v2.mjs` — evidence seed 完成后调用 bridge seed（orchestrator，deploy.sh 不变）。
- `scripts/verify-408-data.mjs` — 增加对 alias 配置与 audit JSON 的纯静态校验函数。
- `scripts/integration-postgres.mjs` — score-center 段改为基于真实 Question + seeded bridge 的 E2E，并新增 PENDING 安全 / MANUAL、REJECTED 保护 / seed 幂等断言。
- `test/score-center-data.test.mjs` — 增加 bridge metadata 枚举/字段断言与 resolver 源码断言。
- `.gitignore` — 忽略生成的 `data/408/knowledge-catalog/question-node-bridge-audit.json`。

### New files expected

1. `packages/shared/src/score-center/bridge/matcher.ts`
   - 职责：名称标准化、候选收窄、确定性匹配（Rule 1/2/3）、HIGH/MEDIUM/LOW 判定。纯函数，无 Prisma 依赖。
   - 导出接口：见 Architecture Decisions Locked。
   - 依赖：仅本地类型。
2. `packages/shared/src/score-center/bridge/audit.ts`
   - 职责：由 `BridgeDecision[]` 与 live Question 链接数据计算 audit 报告与两个覆盖率指标。纯函数。
   - 导出接口：`buildBridgeAudit`、`computeResolvableCoverage` 与类型。
3. `packages/shared/src/score-center/bridge/reconcile.ts`
   - 职责：输入现有 mapping + matcher decisions，输出写计划（upsert / deactivate / skip），实现 MANUAL、REJECTED 保护与 AUTO reconciliation。纯函数。
   - 导出接口：`planBridgeWrites` 与类型。
4. `data/408/knowledge-catalog/bridge-aliases.json`
   - 职责：显式 alias 配置（初始为合法空基础设施 `{ "version": 1, "aliases": [] }`；只有 audit 证明需要时才补充，且必须人工 review）。
   - 依赖：被 matcher 调用方（audit/seed 脚本）读取。
5. `scripts/bridge-audit.mjs`
   - 职责：读取 DB（KnowledgePoint / KnowledgeNode / Question / QuestionKnowledgePoint / 现有 mapping），构建 enriched nodes，运行 matcher + audit，输出 audit JSON 与热点清单。**只读，不写业务数据。**
   - 依赖：`@kaoyan408/shared`（dist）、`@prisma/client`、`DATABASE_URL`。
6. `scripts/seed-knowledge-bridge.mjs`
   - 职责：读取现有 mapping → 运行 matcher → `planBridgeWrites` → 事务内执行写计划 → 校验后置条件 → 输出摘要。幂等。
   - 依赖：同 bridge-audit，外加 reconcile。
7. `test/score-center-bridge-matcher.test.mjs`
   - 职责：matcher / normalize 纯函数单测。
8. `test/score-center-bridge-audit.test.mjs`
   - 职责：audit / coverage 纯函数单测。
9. `test/score-center-bridge-reconcile.test.mjs`
   - 职责：reconciliation planner 纯函数单测。

## Architecture Decisions Locked

### Prisma enum / type names（Task 1 锁定，实现时不得改名）

```prisma
enum BridgeConfidence {
  HIGH
  MEDIUM
}

enum BridgeSource {
  AUTO
  MANUAL
}

enum BridgeMappingType {
  EXACT_NAME
  NORMALIZED_NAME
  CONTEXT_MATCH
  MANUAL
}

enum BridgeStatus {
  ACTIVE
  PENDING_REVIEW
  REJECTED
  INACTIVE
}
```

`KnowledgePointNodeMap` 变更（仅 additive + 受控类型转换）：

- `confidenceLevel BridgeConfidence`（新增，无 Prisma 默认值）
- `source BridgeSource`（新增，无默认值）
- `status BridgeStatus`（新增，无默认值）
- `mappingType BridgeMappingType`（由 `String @default("PRIMARY")` 受控转换为枚举，**删除默认值**）
- 保留 `confidence Float?`（历史审计值，新代码不使用，不删除）
- 保留 `taggedBy ExamTagger @default(HYBRID)` 不变
- 唯一键不变：`@@id([knowledgePointId, knowledgeNodeId])`（已支持 1:N）
- 新增索引：`@@index([knowledgePointId, status])`、`@@index([knowledgeNodeId, status])`

### Matcher interface names

```ts
export type BridgeConfidence = 'HIGH' | 'MEDIUM';
export type BridgeSource = 'AUTO' | 'MANUAL';
export type BridgeMappingType = 'EXACT_NAME' | 'NORMALIZED_NAME' | 'CONTEXT_MATCH' | 'MANUAL';
export type BridgeStatus = 'ACTIVE' | 'PENDING_REVIEW' | 'REJECTED' | 'INACTIVE';

export interface BridgeKnowledgePoint {
  id: string;
  subject: string;   // 'DS' | 'CO' | 'OS' | 'CN'
  chapter: string;
  title: string;
}

export interface BridgeKnowledgeNode {
  id: string;
  subject: string;
  nodeType: string;      // 'atomicPoint'
  name: string;
  chapterName: string | null;
  sectionName: string | null;
}

export interface BridgeAlias {
  subject: string;
  from: string;
  to: string;
  note?: string;
}

export interface BridgeCandidate {
  knowledgeNodeId: string;
  similarity: number; // 仅用于排序/audit/人工审核辅助
}

export interface BridgeDecision {
  knowledgePointId: string;
  knowledgePointName: string;
  subject: string;
  chapter: string;
  section: string | null;
  candidateNodes: BridgeCandidate[];
  selectedNodeIds: string[];
  confidence: BridgeConfidence | null; // null = LOW，不入库
  mappingType: BridgeMappingType | null;
  status: BridgeStatus | null;
  reasons: string[];
}

export function normalizeKnowledgeName(name: string): string;
export function matchKnowledgePointToNodes(
  kp: BridgeKnowledgePoint,
  nodes: readonly BridgeKnowledgeNode[],
  aliases: readonly BridgeAlias[],
): BridgeDecision;
export function matchAllKnowledgePoints(
  kps: readonly BridgeKnowledgePoint[],
  nodes: readonly BridgeKnowledgeNode[],
  aliases: readonly BridgeAlias[],
): BridgeDecision[];
```

### Audit interface names

```ts
export interface LiveQuestionLike {
  id: string;
  knowledgePointIds: string[];      // 经 QuestionKnowledgePoint 关联的 KP id
  directTagNodeIds?: string[];      // QuestionKnowledgeNodeTag 的节点 id（当前为空，按 resolver 优先级计算）
}

export interface BridgeAuditSummary {
  knowledgePointTotal: number;
  activeKnowledgePoints: number;
  pendingKnowledgePoints: number;
  unmatchedKnowledgePoints: number;
  activeCoverage: number;            // 0..1
  liveQuestionTotal: number;
  resolvableQuestions: number;
  questionResolvableCoverage: number; // 0..1
}

export interface BridgeAuditEntry {
  knowledgePointId: string;
  knowledgePointName: string;
  subject: string;
  chapter: string;
  section: string | null;
  decision: BridgeDecision;
  candidateNodes: BridgeCandidate[];
  selectedNodes: string[];
  reasons: string[];
  affectedQuestionCount: number;
}

export interface BridgeAuditReport {
  generatedAt: string;
  summary: BridgeAuditSummary;
  active: BridgeAuditEntry[];
  pendingReview: BridgeAuditEntry[];
  unmatched: BridgeAuditEntry[];
  conflicts: BridgeAuditEntry[];
  oneToMany: BridgeAuditEntry[];
  lowCandidates: Array<BridgeAuditEntry & { similarity: number }>;
}

export function buildBridgeAudit(
  decisions: readonly BridgeDecision[],
  questions: readonly LiveQuestionLike[],
): BridgeAuditReport;
export function computeResolvableCoverage(
  questions: readonly LiveQuestionLike[],
): { total: number; resolvable: number; coverage: number };
```

Coverage 计算规则（锁定）：一个有效 live Question 视为 resolvable，当且仅当：

```text
存在 QuestionKnowledgeNodeTag（directTagNodeIds 非空）
或
存在至少一个 QuestionKnowledgePoint，且该 KP 至少有一条 ACTIVE KnowledgePointNodeMap 指向 isActive 的 atomic KnowledgeNode
```

`affectedQuestionCount` = 关联到该 KP 的不同 live Question 数量。

### Reconcile interface names

```ts
export interface ExistingBridgeMapping {
  knowledgePointId: string;
  knowledgeNodeId: string;
  source: BridgeSource;
  confidenceLevel: BridgeConfidence;
  mappingType: BridgeMappingType;
  status: BridgeStatus;
}

export interface BridgeUpsert {
  knowledgePointId: string;
  knowledgeNodeId: string;
  source: 'AUTO';
  confidenceLevel: BridgeConfidence;
  mappingType: BridgeMappingType;
  status: 'ACTIVE' | 'PENDING_REVIEW';
}

export interface BridgeWritePlan {
  upserts: BridgeUpsert[];
  deactivate: Array<{ knowledgePointId: string; knowledgeNodeId: string }>;
  skipped: Array<{ reason: string; knowledgePointId: string; knowledgeNodeId?: string }>;
}

export function planBridgeWrites(
  existing: readonly ExistingBridgeMapping[],
  decisions: readonly BridgeDecision[],
): BridgeWritePlan;
```

### Seed entry（锁定）

`scripts/seed-408-v2.mjs` 作为 orchestrator：evidence seed 全部完成后调用 `seedKnowledgeBridge(prisma)`（由 `scripts/seed-knowledge-bridge.mjs` 导出）。`deploy.sh` 不变，生产部署入口保持唯一。

### Resolver rule（锁定）

`resolveKnowledgeNodesForQuestion` 双路径顺序不变，仅 fallback 增加 ACTIVE 过滤：

```ts
nodeMaps: {
  where: { status: 'ACTIVE' },
  select: { knowledgeNodeId: true },
}
```

## Task 1 — KnowledgePointNodeMap metadata + additive migration

职责：为桥接表落地 `confidence / source / mappingType / status` 契约与 4 个枚举，全部 additive，保护既有数据。

Files：

- `prisma/schema.prisma`
- `prisma/migrations/<ts>_add_bridge_metadata/migration.sql`
- `test/score-center-data.test.mjs`

Interfaces：见 Architecture Decisions Locked（Prisma enum/type names）。

Step 1 (failing test)：在 `test/score-center-data.test.mjs` 增加：

```js
const requiredBridgeEnums = ['BridgeConfidence', 'BridgeSource', 'BridgeMappingType', 'BridgeStatus'];

test('bridge metadata enums exist', () => {
  for (const enumName of requiredBridgeEnums) {
    assert.match(schema, new RegExp(`enum\\s+${enumName}\\s+\\{`), `missing bridge enum ${enumName}`);
  }
});

test('KnowledgePointNodeMap carries bridge metadata', () => {
  const block = schema.match(/model\s+KnowledgePointNodeMap\s+\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(block, /confidenceLevel\s+BridgeConfidence/);
  assert.match(block, /source\s+BridgeSource/);
  assert.match(block, /mappingType\s+BridgeMappingType/);
  assert.match(block, /status\s+BridgeStatus/);
  assert.match(block, /@@id\(\[knowledgePointId,\s*knowledgeNodeId\]\)/);
  assert.match(block, /@@index\(\[knowledgePointId,\s*status\]\)/);
  assert.match(block, /@@index\(\[knowledgeNodeId,\s*status\]\)/);
});
```

Step 2 (verify FAIL)：`node --test test/score-center-data.test.mjs` → 新测试因 schema 缺少枚举/字段失败。

Step 3 (minimal implementation)：

1. 编辑 `prisma/schema.prisma`：新增 4 个枚举；按锁定字段修改 `KnowledgePointNodeMap`（`confidenceLevel`、`source`、`status` 无默认值；`mappingType` 改为 `BridgeMappingType` 且删除默认值；保留 `confidence Float?`；新增两个 index）。
2. `npx prisma format`
3. 准备迁移：`npm run db:test:up`；显式 `$env:DATABASE_URL='postgresql://postgres:postgres@localhost:55432/kaoyan408_test'`；`npx prisma migrate dev --create-only --name add_bridge_metadata`。
4. 人工 review / 编辑生成的 SQL，按 Migration Safety 补齐 backfill 与受控类型转换，确认无 DROP TABLE / DROP COLUMN / 非预期数据更新。
5. `npx prisma migrate dev` 应用到测试库。
6. `npx prisma validate`。

Step 4 (verify PASS)：`node --test test/score-center-data.test.mjs` → 全绿。

Step 5 (regression)：`node --test test/score-center-mastery.test.mjs test/score-center-priority.test.mjs test/score-center-plan.test.mjs` → 无回归。

Step 6 (git check)：`git status --short`、`git diff --cached --name-only`，确认仅 schema + migration + data test。

Step 7 (commit)：`git add prisma/schema.prisma prisma/migrations/<ts>_add_bridge_metadata test/score-center-data.test.mjs`；commit message：`feat: add knowledge bridge metadata schema`。

## Task 2 — Deterministic bridge matcher + normalization + alias contract

职责：纯函数 matcher 与名称标准化；建立最小合法 alias 基础设施。

Files：

- `packages/shared/src/score-center/bridge/matcher.ts`（新增）
- `packages/shared/src/score-center/index.ts`（导出）
- `data/408/knowledge-catalog/bridge-aliases.json`（新增，`{ "version": 1, "aliases": [] }`）
- `test/score-center-bridge-matcher.test.mjs`（新增）

Interfaces：见 Architecture Decisions Locked（matcher interface names）。`normalizeKnowledgeName` 仅做确定性标准化（trim、大小写、全角/半角、连续空格、中文/英文标点、括号形式、常见连接符），不做语义猜测。

Step 1 (failing test)：`test/score-center-bridge-matcher.test.mjs` 必须包含以下具体用例：

1. `EXACT_NAME`：同 subject + 原始名称完全一致 + 候选唯一 → `HIGH / EXACT_NAME / ACTIVE`。
2. `NORMALIZED_NAME`：全角括号/空格/标点差异，normalize 后相等 + 候选唯一 + 上下文无冲突 → `HIGH / NORMALIZED_NAME / ACTIVE`。
3. `context conflict`：名称相同但 chapter 冲突 → 不得 HIGH（`MEDIUM`，reasons 含 `CONTEXT_CONFLICT`）；跨 subject 候选被排除。
4. `multiple candidates`：多个合理候选 → `MEDIUM / PENDING_REVIEW`。
5. `LOW`：无确定性证据 → `confidence === null`（不生成 DB mapping）。
6. `determinism`：相同输入执行两次 → `assert.deepEqual`。
7. `similarity safety`：高 similarity 但候选不唯一或上下文歧义 → 不得 `ACTIVE`（保持 `MEDIUM`）。
8. `normalize` 纯函数用例：trim、大小写、全角/半角、连续空格、标点、括号、连接符。
9. `alias CONTEXT_MATCH`：显式 alias + 上下文一致 + 唯一 → `HIGH / CONTEXT_MATCH / ACTIVE`；alias 但上下文冲突 → `MEDIUM`。
10. 跨科目：任何情况下不得产生跨 subject 的候选（断言候选集为空或 LOW）。

Step 2 (verify FAIL)：`npm run build:shared && node --test test/score-center-bridge-matcher.test.mjs` → matcher 不存在，import 失败。

Step 3 (minimal implementation)：实现 `matcher.ts`（Rule 1 → Rule 2 → Rule 3 固定顺序；相似度仅排序；`selectedNodeIds` 空且 `confidence === null` 表示 LOW），并在 shared index 导出；创建空 alias 配置文件。

Step 4 (verify PASS)：同上命令全绿。

Step 5 (regression)：`node --test test/score-center-priority.test.mjs test/score-center-mastery.test.mjs test/score-center-plan.test.mjs` → 无回归。

Step 6 (git check)：`git status --short`、`git diff --cached --name-only`。

Step 7 (commit)：`git add packages/shared/src/score-center/bridge/matcher.ts packages/shared/src/score-center/index.ts data/408/knowledge-catalog/bridge-aliases.json test/score-center-bridge-matcher.test.mjs`；commit message：`feat: add deterministic knowledge bridge matcher`。

## Task 3 — Bridge audit + coverage + hotspot reporting

职责：纯函数 audit/coverage 计算 + 只读 dry-run 脚本（不写业务数据）。

Files：

- `packages/shared/src/score-center/bridge/audit.ts`（新增）
- `packages/shared/src/score-center/index.ts`（导出）
- `scripts/bridge-audit.mjs`（新增，只读）
- `test/score-center-bridge-audit.test.mjs`（新增）

Interfaces：见 Architecture Decisions Locked（audit interface names + coverage 规则）。

Step 1 (failing test)：`test/score-center-bridge-audit.test.mjs` 具体用例：

1. `buildBridgeAudit` 对 fixture decisions 正确分类 `ACTIVE / PENDING_REVIEW / UNMATCHED / conflicts / oneToMany / lowCandidates`，计数与 `activeCoverage` 正确。
2. `affectedQuestionCount`：同一 KP 关联 3 道不同 live Question → 计数 3。
3. `computeResolvableCoverage`：仅含 ACTIVE mapping 的 KP 才使 Question resolvable；MEDIUM/UNMATCHED 不计数；directTagNodeIds 优先于 fallback；coverage 数值正确（0..1）。
4. determinism：相同输入两次 → `deepEqual`。
5. `conflicts` 分类：`CONTEXT_CONFLICT` reason 的 entry 进入 conflicts。
6. `oneToMany` 分类：`selectedNodeIds.length > 1` 的 entry 进入 oneToMany。

Step 2 (verify FAIL)：`npm run build:shared && node --test test/score-center-bridge-audit.test.mjs` → audit 模块不存在。

Step 3 (minimal implementation)：实现 `audit.ts` 与 `scripts/bridge-audit.mjs`（脚本流程：读 DB → 构建 enriched nodes（沿 parentId 解析 chapterName/sectionName）→ matcher → buildBridgeAudit → 写 `data/408/knowledge-catalog/question-node-bridge-audit.json` → 打印 summary 与 `affectedQuestionCount DESC` 热点）。脚本无任何写业务数据操作。

Step 4 (verify PASS)：同上命令全绿；dry-run：`$env:DATABASE_URL='...test...' node scripts/bridge-audit.mjs` 输出 summary 且数据库 mapping 行数不变（前后各查一次 `KnowledgePointNodeMap` count 断言相等）。

Step 5 (regression)：`node --test test/score-center-data.test.mjs test/score-center-bridge-matcher.test.mjs` → 无回归。

Step 6 (git check)：`git status --short`、`git diff --cached --name-only`（audit JSON 为生成物，不提交；Task 7 将其加入 .gitignore）。

Step 7 (commit)：`git add packages/shared/src/score-center/bridge/audit.ts packages/shared/src/score-center/index.ts scripts/bridge-audit.mjs test/score-center-bridge-audit.test.mjs`；commit message：`feat: add knowledge bridge audit and coverage`。

## Task 4 — Idempotent bridge persistence + AUTO reconciliation + protection

职责：纯函数 reconciliation planner + Prisma 写入脚本（幂等、保护 MANUAL/REJECTED、stale AUTO → INACTIVE）。

Files：

- `packages/shared/src/score-center/bridge/reconcile.ts`（新增）
- `packages/shared/src/score-center/index.ts`（导出）
- `scripts/seed-knowledge-bridge.mjs`（新增）
- `test/score-center-bridge-reconcile.test.mjs`（新增）

Interfaces：见 Architecture Decisions Locked（reconcile interface names）。

Step 1 (failing test)：`test/score-center-bridge-reconcile.test.mjs` 具体用例：

1. 新 KP + HIGH decision → upsert `AUTO / HIGH / ACTIVE`。
2. 新 KP + MEDIUM decision → upsert `AUTO / MEDIUM / PENDING_REVIEW`。
3. LOW decision → 无任何写操作。
4. 现有 `MANUAL + ACTIVE`（Node-X）+ 新 decision 指向 Node-Y → Node-X 不在 upsert/deactivate 中，`skipped` 含 `MANUAL_PROTECTED`。
5. 现有 `REJECTED`（Node-X）+ 新 decision 再次指向 Node-X → 无重新激活，`skipped` 含 `REJECTED_PROTECTED`。
6. stale AUTO：现有 `AUTO + ACTIVE`（Node-X）不在新 decisions → `deactivate` 含 Node-X。
7. 稳定 AUTO：现有 `AUTO + ACTIVE`（Node-X）且新 decision 仍指向 Node-X → 无变化（幂等）。
8. planner 幂等：相同输入调用两次 → `deepEqual`。
9. 不变量：输出 `upserts` 与 `deactivate` 中绝不出现任何现有 MANUAL / REJECTED 行。

Step 2 (verify FAIL)：`npm run build:shared && node --test test/score-center-bridge-reconcile.test.mjs` → reconcile 不存在。

Step 3 (minimal implementation)：实现 `reconcile.ts`；实现 `scripts/seed-knowledge-bridge.mjs`（流程：读现有 mapping → matcher（复用）→ `planBridgeWrites` → `prisma.$transaction` 内 upsert/deactivate → 后置校验（重复执行结果一致）→ 打印 ACTIVE/PENDING/INACTIVE/MANUAL/REJECTED 计数）。

Step 4 (verify PASS)：同上命令全绿。

Step 5 (regression + DB 幂等)：`node --test test/score-center-bridge-reconcile.test.mjs test/score-center-bridge-matcher.test.mjs`；再在测试库执行 `node scripts/seed-knowledge-bridge.mjs` 两次，断言两次后各状态计数一致且无重复行（写入 `scripts/integration-postgres.mjs` 的 seed 幂等断言在本 Task 一并落地，DB 级验证在 Task 6 执行时覆盖）。

Step 6 (git check)：`git status --short`、`git diff --cached --name-only`。

Step 7 (commit)：`git add packages/shared/src/score-center/bridge/reconcile.ts packages/shared/src/score-center/index.ts scripts/seed-knowledge-bridge.mjs test/score-center-bridge-reconcile.test.mjs`；commit message：`feat: add idempotent knowledge bridge seed`。

## Task 5 — ACTIVE-only resolver safety

职责：最小安全增强，不重写 resolver。

Files：

- `apps/api/src/score-center/repository.ts`
- `test/score-center-data.test.mjs`（源码断言）

Interfaces：`resolveKnowledgeNodesForQuestion` 签名不变；fallback 的 `nodeMaps` 查询增加 `where: { status: 'ACTIVE' }`。

Step 1 (failing test)：`test/score-center-data.test.mjs` 增加：

```js
test('resolver fallback only consumes ACTIVE bridge mappings', () => {
  const repository = fs.readFileSync(new URL('../apps/api/src/score-center/repository.ts', import.meta.url), 'utf8');
  const fallback = repository.slice(repository.indexOf('nodeMaps:'));
  assert.match(fallback, /status:\s*'ACTIVE'/, 'fallback must filter status ACTIVE');
});
```

Step 2 (verify FAIL)：`node --test test/score-center-data.test.mjs` → 新测试失败（当前 fallback 无 status 过滤）。

Step 3 (minimal implementation)：`repository.ts` fallback 改为：

```ts
nodeMaps: {
  where: { status: 'ACTIVE' },
  select: { knowledgeNodeId: true },
}
```

Step 4 (verify PASS)：`node --test test/score-center-data.test.mjs` → 全绿。

Step 5 (regression)：`npm run build:api`；`node --test test/score-center-mastery.test.mjs test/score-center-priority.test.mjs test/score-center-plan.test.mjs` → 无回归。

Step 6 (git check)：`git status --short`、`git diff --cached --name-only`。

Step 7 (commit)：`git add apps/api/src/score-center/repository.ts test/score-center-data.test.mjs`；commit message：`fix: restrict mastery bridge to active mappings`。

## Task 6 — Real PostgreSQL Question → Mastery E2E

职责：用真实题库 Question 与 seeded bridge 验证 mastery 链路；多知识点题；PENDING 安全；MANUAL/REJECTED seed 保护；seed 幂等。

Files：

- `scripts/integration-postgres.mjs`（扩展 score-center 段）

Step 1 (failing test)：在 integration score-center 段增加：

1. 先执行 bridge seed（import `seedKnowledgeBridge` 到测试库）→ 断言存在至少一条真实 live Question 可解析（`resolvableQuestions >= 1`）。
2. 对真实可解析 Question 提交错误作答 → 断言：

```text
PracticeRecord created
UserKnowledgeMastery created
attempts === 1
wrongCount === 1
mastery < 0.5
```

3. 再提交正确作答 → 断言：

```text
correctCount === 1
recentAccuracy > 0.55
mastery 上升
```

4. 多知识点题：找到真实 Question 关联 ≥2 个 KnowledgePoint 且这些 KP 均有 ACTIVE mapping → 一次作答后断言多个 `UserKnowledgeMastery` 行被更新，PRIMARY/SECONDARY 权重语义不受破坏（不同节点 mastery 变化幅度与角色一致）。
5. PENDING 安全：为真实 KP（或独立测试 KP）创建 `status=PENDING_REVIEW` mapping → 提交作答 → 断言 `PracticeRecord` 写入、对应 `UserKnowledgeMastery` 不存在。
6. MANUAL/REJECTED 保护：创建 `MANUAL + ACTIVE` 与 `REJECTED` 行 → 重跑 bridge seed → 断言两行完全未变。
7. seed 幂等：连续执行 bridge seed 两次 → 断言 ACTIVE/PENDING/INACTIVE/MANUAL/REJECTED 计数一致、无重复行。

Step 2 (verify FAIL)：`npm run db:test:up`；`npm run test:integration:postgres` → 新断言失败（真实题无可解析映射 / 保护断言缺失）。

Step 3 (minimal implementation)：只改 `scripts/integration-postgres.mjs`（不实现业务代码；依赖 Task 1–5 已交付的 seed/resolver）。

Step 4 (verify PASS)：`npm run test:integration:postgres` → 全绿。

Step 5 (regression)：`node --test test/score-center-data.test.mjs test/score-center-bridge-matcher.test.mjs test/score-center-bridge-audit.test.mjs test/score-center-bridge-reconcile.test.mjs` → 无回归。

Step 6 (git check)：`git status --short`、`git diff --cached --name-only`。

Step 7 (commit)：`git add scripts/integration-postgres.mjs`；commit message：`test: verify real question mastery bridge e2e`。

## Task 7 — Production seed / verify integration + rollout gate

职责：bridge seed 进入现有部署入口；verify 静态校验；rollout gate 落地。

Files：

- `scripts/seed-408-v2.mjs`（orchestrator：evidence seed 后调用 bridge seed）
- `scripts/verify-408-data.mjs`（新增 alias 配置与 audit JSON 纯静态校验）
- `.gitignore`（忽略生成 audit JSON）
- 测试：在 `test/score-center-data.test.mjs` 中追加对 `verifyBridgeAliases` / `verifyBridgeAudit` 的纯函数用例（校验规则：无 ghost nodeId、无 duplicate、MEDIUM 不 ACTIVE、覆盖率字段存在）。

Step 1 (failing test)：为 `verify-408-data.mjs` 新增 `verifyBridgeAliases(aliases)` 与 `verifyBridgeAudit(audit)` 纯函数（导出），并给出无效 fixture（跨 subject alias、duplicate alias、ghost nodeId、MEDIUM 标 ACTIVE）→ 断言抛错；有效 fixture → 通过。先写测试，验证函数不存在而 FAIL。

Step 2 (verify FAIL)：`npm run build:shared && node --test test/score-center-data.test.mjs` → 新用例失败（`verifyBridgeAliases` / `verifyBridgeAudit` 尚未导出）。

Step 3 (minimal implementation)：

1. `verify-408-data.mjs` 增加两个纯校验函数（校验规则见上），并在 `verify408Data()` 中调用 `verifyBridgeAliases`。
2. `seed-408-v2.mjs`：evidence seed 完成后 `await seedKnowledgeBridge(prisma)`（import 自 `scripts/seed-knowledge-bridge.mjs`）；随后运行 bridge audit 并调用 `verifyBridgeAudit` 做部署后置校验。
3. `.gitignore` 增加 `data/408/knowledge-catalog/question-node-bridge-audit.json`。

Step 4 (verify PASS)：`npm run verify:408-data` 通过；`node scripts/bridge-audit.mjs` 输出完整 summary；`node scripts/seed-knowledge-bridge.mjs` 幂等可重复。

Step 5 (regression / full)：见 Verification 三层。

Step 6 (git check)：`git status --short`、`git diff --cached --name-only`。

Step 7 (commit)：`git add scripts/seed-408-v2.mjs scripts/verify-408-data.mjs .gitignore test/...`；commit message：`feat: wire knowledge bridge into seed and verify`。

## Migration Safety

目标语义（Spec 第九节）：已存在、没有 metadata 的历史 mapping 优先视为“已有可信人工/fixture mapping”，保持当前行为。

迁移策略（写入 `add_bridge_metadata` migration SQL）：

```sql
-- 1. Prisma 生成 4 个 enum 类型
-- 2. 新增 nullable 列
ALTER TABLE "KnowledgePointNodeMap" ADD COLUMN "confidenceLevel" "BridgeConfidence";
ALTER TABLE "KnowledgePointNodeMap" ADD COLUMN "source" "BridgeSource";
ALTER TABLE "KnowledgePointNodeMap" ADD COLUMN "status" "BridgeStatus";

-- 3. backfill：历史行视为 MANUAL/HIGH/ACTIVE，mappingType 收敛为 MANUAL
UPDATE "KnowledgePointNodeMap"
SET "source" = 'MANUAL',
    "confidenceLevel" = 'HIGH',
    "status" = 'ACTIVE',
    "mappingType" = 'MANUAL'
WHERE "source" IS NULL;

-- 4. mappingType String → BridgeMappingType（受控转换，先归一非法值再改类型）
UPDATE "KnowledgePointNodeMap"
SET "mappingType" = 'MANUAL'
WHERE "mappingType" NOT IN ('EXACT_NAME', 'NORMALIZED_NAME', 'CONTEXT_MATCH', 'MANUAL');
ALTER TABLE "KnowledgePointNodeMap"
ALTER COLUMN "mappingType" TYPE "BridgeMappingType" USING "mappingType"::"BridgeMappingType";
ALTER TABLE "KnowledgePointNodeMap" ALTER COLUMN "mappingType" DROP DEFAULT;

-- 5. 置 NOT NULL（无 Prisma 默认值，避免未来调用遗漏 metadata 被静默分类）
ALTER TABLE "KnowledgePointNodeMap" ALTER COLUMN "confidenceLevel" SET NOT NULL;
ALTER TABLE "KnowledgePointNodeMap" ALTER COLUMN "source" SET NOT NULL;
ALTER TABLE "KnowledgePointNodeMap" ALTER COLUMN "status" SET NOT NULL;

-- 6. additive 索引
CREATE INDEX "KnowledgePointNodeMap_knowledgePointId_status_idx" ON "KnowledgePointNodeMap"("knowledgePointId", "status");
CREATE INDEX "KnowledgePointNodeMap_knowledgeNodeId_status_idx" ON "KnowledgePointNodeMap"("knowledgeNodeId", "status");
```

安全性：

- 生产当前表为空，backfill 为 no-op；若存在历史行，按约定保留为 `MANUAL/HIGH/ACTIVE`，AUTO seed 永不触碰（MANUAL protection）。
- 无 `DROP TABLE / DROP COLUMN / DELETE`；`confidence Float?` 保留作为历史审计值。
- 不设置危险默认值：`source / status / confidenceLevel` 在 Prisma schema 中无默认值；`mappingType` 删除 `PRIMARY` 默认值。
- 唯一键 `(knowledgePointId, knowledgeNodeId)` 不变，1:N 已可表达；无需改键。

## Rollout Gate

生产上线顺序：

```text
migration
→ evidence seed（现有 seed-408-v2.mjs）
→ bridge dry-run（scripts/bridge-audit.mjs，不写库）
→ 人工 review audit（重点：0 known incorrect ACTIVE）
→ bridge seed（seed-408-v2.mjs orchestrator 内）
→ verify（verifyBridgeAudit + coverage 输出）
→ API healthy
```

覆盖率 gate：

- `questionResolvableCoverage >= 0.70` → 允许进入 seed。
- `questionResolvableCoverage < 0.70` → **STOP**：不执行生产 seed；输出 `affectedQuestionCount DESC` 的 `PENDING_REVIEW / UNMATCHED` 热点清单，请求人工 review 后补充确定性 alias 或 MANUAL mapping，再 rerun dry-run。
- 禁止为达标降低 HIGH 标准、将 MEDIUM 改为 ACTIVE、或使用 LLM 猜 mapping。

失败恢复：

- 旧 `ACTIVE / MANUAL` mapping 在 seed 重跑中保持不变（protection set）。
- 新 AUTO mapping 幂等 upsert；重复 deploy 安全（seed 连续两次逻辑状态一致）。

## Verification

### Level 1 — Focused

```bash
npm run build:shared
node --test test/score-center-bridge-matcher.test.mjs
node --test test/score-center-bridge-audit.test.mjs
node --test test/score-center-bridge-reconcile.test.mjs
node --test test/score-center-data.test.mjs
```

### Level 2 — Score Center Regression

```bash
node --test test/score-center-mastery.test.mjs
node --test test/score-center-priority.test.mjs
node --test test/score-center-plan.test.mjs
node --test test/today-score-center-ui.test.js
node --test test/today-plan-ui.test.js
```

### Level 3 — Full Verification

```bash
npm run db:test:up
npm test
npm run build:api
npm run build:web
npx prisma validate
npm run verify:408-data
npm run test:integration:postgres
```

（以上命令均来自根 `package.json` 真实 scripts；`npx prisma validate` 与迁移命令需显式提供测试库 `DATABASE_URL=postgresql://postgres:postgres@localhost:55432/kaoyan408_test`。）

## Reviewer Checkpoint

每个 Task 完成后：

```text
STOP
review diff（git diff --cached）
review tests（focused + regression）
确认 acceptance
再进入下一个 Task
```

禁止一口气实施全部 Task 后才 review。

## Self Review Checklist

计划完成后逐项核对 Design Spec：

1. Design Spec 每项 requirement 均落到 Task 1–7。
2. MEDIUM 始终 `PENDING_REVIEW`，永不参与 mastery（Task 1 契约、Task 4 planner、Task 5 resolver、Task 6 E2E 断言）。
3. LOW 始终不入库（matcher `confidence === null`、reconcile 无写入、Task 3 audit 记录）。
4. MANUAL 永不被 AUTO 覆盖（reconcile `MANUAL_PROTECTED` + Task 6 DB 断言）。
5. REJECTED 永不自动复活（reconcile `REJECTED_PROTECTED` + Task 6 DB 断言）。
6. stale AUTO → `INACTIVE`（reconcile deactivate，保留历史）。
7. resolver 仅 `ACTIVE`（Task 5 源码断言 + Task 6 行为断言）。
8. Question / ExamQuestion 分离（Global Constraints + E2E 只用 live Question）。
9. 无 QuestionTag 自动生成（Global Constraints + Non-Goals）。
10. 无 fuzzy/LLM → HIGH（matcher 规则 + 测试 7 + 测试 10）。
11. 保留 1:N 严格边界（matcher 1:N 规则 + audit oneToMany 分类）。
12. 有 dry-run audit（Task 3 `bridge-audit.mjs`）。
13. 有 coverage 指标（Task 3 `computeResolvableCoverage`）。
14. 有 affectedQuestionCount（Task 3 audit entry）。
15. `<70%` 明确 STOP 而非降低标准（Rollout Gate + Global Constraints）。
16. 有真实 PostgreSQL E2E（Task 6）。
17. 有多知识点题（Task 6 用例 4）。
18. 有 PENDING safety test（Task 6 用例 5）。
19. 有 seed 两次幂等 test（Task 4/6）。
20. 有 full regression gate（Verification Level 3）。
