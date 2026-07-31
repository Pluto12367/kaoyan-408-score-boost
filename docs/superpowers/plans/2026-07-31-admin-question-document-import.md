# 管理员题库文档导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员通过网站上传 PDF、XLSX 或 CSV，在异步解析和原文对照审核后分批导入题库，同时保护重复题、题目版本、历史作答和永久图片。

**Architecture:** PostgreSQL 保存导入批次、子任务、候选题和状态，是后台任务的唯一事实来源；本地私有 Docker 数据卷保存临时原件和题目资源。表格解析与 PDF 解析最终生成统一候选题，确认接口在串行化事务中创建新的不可变 `Question` 版本。PDF 默认通过 MinerU 远程 SDK 解析，低质量页面按规则回退到腾讯云 OCR；2GB 生产服务器只负责单并发任务调度、逐页渲染和数据整理。

**Tech Stack:** NestJS 10、Prisma 5、PostgreSQL 16、React 18、TypeScript 5、Node 24、ExcelJS、Multer、MinerU TypeScript SDK、腾讯云 OCR Node SDK、KaTeX、Docker Compose、qpdf、Poppler。

## Global Constraints

- 只有管理员可以上传、审核、重试、确认和清理导入资料。
- 第一版只接受 PDF、`.xlsx` 和 `.csv`；拒绝 `.xls`、宏、可执行内容和伪造文件类型。
- 所有解析结果先进入候选区；未经管理员明确确认绝不进入正式题库。
- 正确题目可以分批确认；失败、疑似重复或待修改题目继续留在原批次。
- 完全重复默认跳过；“更新”必须创建新 `Question` 版本，不能覆盖旧行。
- `PracticeRecord`、`LearningSession.questionSnapshot`、错题和复习记录继续引用作答时的旧 `Question.id`。
- 原始文件和整页预览默认保留 30 天；正式版本引用的局部图片永久保留。
- 来源必填，`rightsConfirmed=true`、确认管理员和确认时间必须持久化。
- 外部解析结果不能静默补猜答案、选项归属或题目边界；不确定内容留空并生成警告。
- 生产服务器保持 2 核 CPU、2GB 内存、40GB 系统盘；不在该服务器运行 MinerU、PaddleOCR 或 Docling 模型。
- PDF 子任务默认不超过 200 页；限制必须通过环境变量配置。
- 后台导入默认单并发，学生登录和答题优先。
- 原始文件、页面预览、API 密钥和提供商原始响应不能通过公共静态 URL 暴露。
- 开发时不得直接复制参考项目源码；只采用设计规格第 4 节总结的接口、状态和审核模式。

---

## File Structure

### 数据与领域

- `prisma/schema.prisma`：题目族、不可变题目版本、批次、子任务、候选题、资源和确认记录。
- `prisma/migrations/20260731120000_question_document_import/migration.sql`：兼容现有题目和历史外键的数据迁移。
- `packages/shared/src/questionImport.ts`：前后端共享的状态、DTO 和纯字段规范化。
- `apps/api/src/questions/import/import-fingerprint.ts`：稳定内容指纹与重复候选排序。
- `apps/api/src/questions/import/import-validation.ts`：知识点和题型字段校验。

### 表格和批次基础

- `apps/api/src/questions/import/table-import.parser.ts`：XLSX/CSV Buffer 到统一行模型。
- `apps/api/src/questions/import/question-template.service.ts`：生成标准 XLSX/CSV 模板。
- `apps/api/src/questions/import/import-storage.service.ts`：私有文件原子落盘、读取、提升和安全删除。
- `apps/api/src/questions/import/import-config.ts`：集中读取并校验大小、目录、配额和并发环境变量。
- `apps/api/src/questions/import/import-batch.service.ts`：创建、列表、统计、取消和重试批次。
- `apps/api/src/questions/import/import-worker.service.ts`：从 PostgreSQL 原子认领任务并执行单并发循环。
- `apps/api/src/questions/import/import-candidate.service.ts`：候选题保存、编辑、筛选和乐观锁。
- `apps/api/src/questions/import/import-confirmation.service.ts`：分批确认、重复策略、版本创建和幂等。
- `apps/api/src/questions/import/question-import.controller.ts`：管理员导入 API。

### PDF 与资源

- `apps/api/src/questions/import/providers/document-parser.provider.ts`：提供商无关契约。
- `apps/api/src/questions/import/providers/mineru.provider.ts`：MinerU SDK 适配。
- `apps/api/src/questions/import/providers/tencent-page-ocr.provider.ts`：低质量页 OCR 回退。
- `apps/api/src/questions/import/pdf-document.service.ts`：qpdf 页数检查和子文件拆分。
- `apps/api/src/questions/import/pdf-page-renderer.ts`：Poppler 单页预览。
- `apps/api/src/questions/import/document-blocks.ts`：页面、文本、公式、图片和坐标统一结构。
- `apps/api/src/questions/import/question-structure.service.ts`：文档块到候选题。
- `apps/api/src/questions/import/import-quality.service.ts`：低质量信号和回退决策。
- `apps/api/src/questions/import/import-cleanup.service.ts`：30 天清理、引用保护和配额统计。

### 管理端

- `apps/web/src/api/endpoints/question-import.ts`：导入 API 请求。
- `apps/web/src/features/admin/question-import/QuestionImportWorkspace.tsx`：导入模块入口。
- `apps/web/src/features/admin/question-import/NewImportPanel.tsx`：上传和来源确认。
- `apps/web/src/features/admin/question-import/ImportBatchList.tsx`：批次状态和费用。
- `apps/web/src/features/admin/question-import/CandidateReview.tsx`：筛选、编辑和确认。
- `apps/web/src/features/admin/question-import/SourcePagePreview.tsx`：鉴权获取整页图片并定位坐标。
- `apps/web/src/features/admin/question-import/QuestionAssetEditor.tsx`：题图保留和浏览器端裁剪。
- `apps/web/src/features/admin/question-import/FormulaPreview.tsx`：安全 KaTeX 预览。

### 测试与运维

- `test/question-import-schema.test.js`
- `test/question-import-normalize.test.js`
- `test/question-import-table.test.js`
- `test/question-import-api-contract.test.js`
- `test/question-import-worker.test.js`
- `test/question-import-provider.test.js`
- `test/question-import-ui.test.js`
- `scripts/integration-question-import.mjs`
- `scripts/benchmark-question-parser.mjs`
- `docs/development/reference-notes/2026-07-31-question-document-import.md`
- `docs/admin/question-document-import.md`

### Stable Interfaces

```ts
export interface SourceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImportWarning {
  code: string;
  severity: 'warning' | 'error';
  field?: string;
  message: string;
  suggestion: string;
}

export interface StoredFileMetadata {
  fileName: string;
  mediaType: string;
  sha256?: string;
  batchId?: string;
  pageNumber?: number;
}

export interface StoredFile {
  storageKey: string;
  sha256: string;
  mediaType: string;
  byteSize: number;
}

export type ImportFileType = 'pdf' | 'xlsx' | 'csv';
export type ImportBatchStatus =
  | 'uploaded' | 'queued' | 'parsing' | 'parsing_partial_failure'
  | 'review' | 'partially_imported' | 'completed' | 'failed'
  | 'cancelled' | 'expired';
export type ImportCandidateStatus =
  | 'pending_review' | 'needs_edit' | 'duplicate_suspected'
  | 'approved' | 'ignored' | 'parse_failed' | 'imported';

export interface CandidateQuestionDraft {
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  type: '选择题' | '综合题' | '判断题';
  difficulty: '基础' | '中等' | '困难';
  source: string;
  year?: number;
  expectedTimeSec: number;
  knowledgePointIds: string[];
  pageNumber?: number;
  sourceRegion?: { x: number; y: number; width: number; height: number };
  formulas: Array<{ latex: string; region?: SourceRegion }>;
  assetIds: string[];
  warnings: ImportWarning[];
}

export interface DocumentParserProvider {
  readonly name: 'mineru' | 'tencent-ocr';
  submit(input: ProviderInput): Promise<{ externalTaskId: string }>;
  poll(externalTaskId: string): Promise<ProviderPollResult>;
  fetchResult(externalTaskId: string): Promise<ParsedDocument>;
}

export interface ProviderInput {
  jobId: string;
  storageKey: string;
  fileName: string;
  pageStart: number;
  pageEnd: number;
}

export type ProviderPollResult =
  | { state: 'queued' | 'running'; retryAfterMs: number }
  | { state: 'succeeded' }
  | { state: 'failed'; code: string; retryable: boolean; message: string };

export interface ParsedDocument {
  provider: 'mineru' | 'tencent-ocr';
  model: string;
  pages: ParsedPage[];
  rawResultKey?: string;
}

export interface ParsedPage {
  pageNumber: number;
  width: number;
  height: number;
  blocks: DocumentBlock[];
  quality: { score: number; signals: string[] };
}

export interface ImportStorage {
  putIncoming(path: string, metadata: StoredFileMetadata): Promise<StoredFile>;
  createReadStream(storageKey: string): NodeJS.ReadableStream;
  putBuffer(scope: 'temporary' | 'permanent', buffer: Buffer, metadata: StoredFileMetadata): Promise<StoredFile>;
  promote(storageKey: string): Promise<StoredFile>;
  deleteIfUnreferenced(storageKey: string): Promise<boolean>;
}
```

All tasks consume these names. If implementation reveals a required signature change, update this plan and every later reference before continuing.

---

### Task 1: 题目族、版本和导入状态数据模型

**Files:**
- Create: `prisma/migrations/20260731120000_question_document_import/migration.sql`
- Create: `test/question-import-schema.test.js`
- Create: `docs/development/reference-notes/2026-07-31-question-document-import.md`
- Modify: `prisma/schema.prisma`
- Modify: `apps/api/src/questions/questions.service.ts`
- Modify: `scripts/import-questions.mjs`

**Interfaces:**
- Produces: `QuestionFamily`, `QuestionImportBatch`, `QuestionImportJob`, `QuestionImportCandidate`, `QuestionImportAsset`, `QuestionImportConfirmation`
- Produces: `Question.familyId`, `Question.versionNumber`, `Question.isCurrent`, `Question.contentFingerprint`
- Produces: `QuestionsService.refreshFromDatabase(): Promise<void>`

- [ ] **Step 1: 记录已完成的开源参考检查**

创建 `docs/development/reference-notes/2026-07-31-question-document-import.md`，明确记录 MinerU、PP-StructureV3、Docling 和 Moodle 的链接、借鉴点、未采用的本地模型方案，以及“无源码复制”。运行：

```powershell
rg -n "MinerU|PP-StructureV3|Docling|Moodle|不复制" docs/development/reference-notes/2026-07-31-question-document-import.md
```

Expected: 五个关键词都存在。

- [ ] **Step 2: 写失败的 schema 契约测试**

```js
test('schema keeps immutable question versions and resumable import state', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  assert.match(schema, /model QuestionFamily\s*\{/);
  assert.match(schema, /familyId\s+String/);
  assert.match(schema, /versionNumber\s+Int\s+@default\(1\)/);
  assert.match(schema, /isCurrent\s+Boolean\s+@default\(true\)/);
  assert.match(schema, /model QuestionImportBatch\s*\{/);
  assert.match(schema, /model QuestionImportJob\s*\{/);
  assert.match(schema, /model QuestionImportCandidate\s*\{/);
  assert.match(schema, /model QuestionImportAsset\s*\{/);
  assert.match(schema, /model QuestionImportConfirmation\s*\{/);
});
```

Run: `node --test test/question-import-schema.test.js`

Expected: FAIL because the models do not exist.

- [ ] **Step 3: Add enums and models**

Use Prisma enums matching the shared string statuses. Add:

```prisma
model QuestionFamily {
  id        String     @id @default(cuid())
  versions Question[]
  createdAt DateTime   @default(now())
}

model QuestionImportConfirmation {
  id             String   @id @default(cuid())
  batchId        String
  idempotencyKey String   @unique
  actorId        String
  result         Json
  createdAt      DateTime @default(now())
  batch          QuestionImportBatch @relation(fields: [batchId], references: [id], onDelete: Restrict)

  @@index([batchId, createdAt])
}
```

`QuestionImportBatch` stores upload actor, original storage key, SHA-256, file type, source, rights confirmation, status counts, provider/cost JSON, expiry timestamps and optimistic `revision`. `QuestionImportJob` stores range, provider task ID, attempt, retry time, state, quality and cost. `QuestionImportCandidate` stores normalized fields in typed columns plus formulas/assets/warnings JSON, source page/region, content fingerprint, target family, review metadata and `revision`. `QuestionImportAsset` stores scope, key, SHA-256, media metadata, page/region, candidate or question reference and expiry.

`QuestionImportCandidate` also stores `duplicateAction` with `skip | create | new_version`. `QuestionImportAsset` uses separate optional relations for candidate and正式 `Question` 版本；a database check constraint requires exactly one owner after promotion.

Add to `Question`:

```prisma
familyId          String
versionNumber     Int       @default(1)
isCurrent         Boolean   @default(true)
contentFingerprint String
importBatchId     String?
family            QuestionFamily @relation(fields: [familyId], references: [id], onDelete: Restrict)

@@unique([familyId, versionNumber])
@@index([isCurrent, createdAt])
@@index([contentFingerprint, isCurrent])
```

- [ ] **Step 4: Write the backward-compatible SQL migration**

The migration must create one `QuestionFamily` for every existing `Question`, set `familyId='legacy-' || Question.id`, `versionNumber=1`, `isCurrent=true`, and initialize a non-security fingerprint with PostgreSQL `md5(stem || options::text)`. Only after the backfill succeeds may `familyId` and `contentFingerprint` become `NOT NULL`.

Run: `npx prisma validate --schema prisma/schema.prisma`

Expected: schema valid.

- [ ] **Step 5: Make current-version reads explicit**

Implement:

```ts
async refreshFromDatabase() {
  if (!this.persistenceEnabled) return;
  const rows = await this.prisma.question.findMany({
    where: { isCurrent: true },
    include: { knowledgePoints: true },
    orderBy: { createdAt: 'asc' },
  });
  this.questions.splice(0, this.questions.length, ...rows.map(toSharedQuestion));
}
```

`onModuleInit()` calls it. `createQuestion()`, teacher updates and `scripts/import-questions.mjs` create a `QuestionFamily`, version 1 and an application SHA-256 fingerprint. They never mutate an old imported version in place.

When a teacher or administrator edits an existing persisted question, create version N+1 in the same family and mark the previous row non-current in one transaction. The existing static-demo in-memory path can retain its current behavior because it has no student history.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npx prisma generate --schema prisma/schema.prisma
node --test test/question-import-schema.test.js
npm run build:api
```

Expected: all exit 0.

Commit:

```powershell
git add prisma apps/api/src/questions/questions.service.ts scripts/import-questions.mjs test/question-import-schema.test.js docs/development/reference-notes/2026-07-31-question-document-import.md
git commit -m "feat: add versioned question import model"
```

---

### Task 2: 统一字段规范化、XLSX/CSV 解析和模板

**Files:**
- Create: `packages/shared/src/questionImport.ts`
- Create: `apps/api/src/questions/import/table-import.parser.ts`
- Create: `apps/api/src/questions/import/question-template.service.ts`
- Create: `test/question-import-normalize.test.js`
- Create: `test/question-import-table.test.js`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `normalizeCandidateDraft(raw, location): { value?: CandidateQuestionDraft; issues: ImportWarning[] }`
- Produces: `computeContentFingerprint(draft): string`
- Produces: `TableImportParser.parse(buffer, fileName): Promise<TableParseResult>`
- Produces: `QuestionTemplateService.buildXlsx(): Promise<Buffer>`

- [ ] **Step 1: Install the table dependency**

Run: `npm install exceljs@4.4.0 -w apps/api`

Expected: API package and lockfile updated.

- [ ] **Step 2: Write failing normalization tests**

Test a valid Chinese row, missing source, invalid answer, unknown difficulty, a formula cell without cached value, UTF-8 BOM CSV, quoted commas, and 1001 rows. The valid assertion is:

```js
assert.deepEqual(result.value.options, ['进程同步', '磁盘调度', '地址转换', '文件分配']);
assert.equal(result.value.source, '合法原创资料');
assert.equal(result.issues.length, 0);
assert.equal(computeContentFingerprint(result.value).length, 64);
```

Run: `npm run build:shared && node --test test/question-import-normalize.test.js`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement shared normalization**

Use Unicode NFKC, trim and whitespace folding. Normalize option labels and full-width punctuation, but retain numbers, units, formulas and asset placeholders. Validate:

```ts
export interface ImportWarning {
  code: string;
  severity: 'warning' | 'error';
  field?: keyof CandidateQuestionDraft;
  message: string;
  suggestion: string;
}
```

Selection questions require 2–8 non-empty options and an answer within the option letters. `source` is always required. Unknown knowledge-point names remain an error until mapped by the API.

- [ ] **Step 4: Write and run failing parser tests**

Build an in-memory workbook with `题库导入` and a CSV containing a quoted comma. Assert both produce the same raw fields and source row numbers. Assert `.xls` and a workbook with 1001 data rows are rejected.

Run: `npm run build:api && node --test test/question-import-table.test.js`

Expected: FAIL because `TableImportParser` is absent.

- [ ] **Step 5: Implement parser and templates**

`TableImportParser` reads only values; it never evaluates formulas or macros. A required formula cell with no cached value yields `FORMULA_VALUE_UNAVAILABLE`. CSV output templates use UTF-8 BOM. XLSX contains fixed headers, a `填写说明` sheet and validation lists for subject, type, difficulty and answer.

```ts
export interface TableParseResult {
  rows: Array<{ rowNumber: number; values: Record<string, unknown> }>;
  issues: ImportWarning[];
}
```

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm run build:shared
npm run build:api
node --test test/question-import-normalize.test.js test/question-import-table.test.js
```

Expected: PASS.

Commit:

```powershell
git add packages/shared apps/api/src/questions/import apps/api/package.json package-lock.json test/question-import-normalize.test.js test/question-import-table.test.js
git commit -m "feat: parse question import tables"
```

---

### Task 3: 私有存储、流式上传和批次 API

**Files:**
- Create: `apps/api/src/questions/import/import-config.ts`
- Create: `apps/api/src/questions/import/import-storage.service.ts`
- Create: `apps/api/src/questions/import/import-batch.service.ts`
- Create: `apps/api/src/questions/import/question-import.controller.ts`
- Create: `apps/api/src/questions/import/dto/create-import-batch.dto.ts`
- Create: `test/question-import-api-contract.test.js`
- Modify: `apps/api/src/questions/questions.module.ts`
- Modify: `apps/api/src/public-environment.ts`
- Modify: `.env.production.example`
- Modify: `deploy/tencent-ip/.env.production.example`

**Interfaces:**
- Produces: `POST /admin/question-imports`
- Produces: `GET /admin/question-imports`
- Produces: `GET /admin/question-imports/:batchId`
- Produces: `GET /admin/question-imports/templates/:format`
- Produces: `POST /admin/question-imports/:batchId/cancel`
- Produces: `POST /admin/question-imports/:batchId/retry`

- [ ] **Step 1: Write failing controller and config tests**

Assert `@Roles('admin')`, Multer `diskStorage`, random file names, required `source`, explicit `rightsConfirmed`, supported extensions, and no public static directory. Assert defaults:

```ts
maxPdfBytes: 500 * 1024 * 1024
maxTableBytes: 50 * 1024 * 1024
temporaryQuotaBytes: 10 * 1024 * 1024 * 1024
diskStopPercent: 80
```

Run: `node --test test/question-import-api-contract.test.js`

Expected: FAIL.

- [ ] **Step 2: Implement validated import configuration**

`loadImportConfig(process.env)` resolves all directories beneath `QUESTION_IMPORT_DATA_DIR`, rejects relative traversal, creates `incoming`, `temporary` and `permanent` directories on startup, and verifies the data directory is not the web root.

- [ ] **Step 3: Implement safe storage**

`ImportStorageService.putIncoming()` computes SHA-256 while moving the Multer temporary file atomically. Validate PDF `%PDF-`, XLSX ZIP signature and text CSV without NUL bytes. On validation failure, remove only the exact random incoming file after confirming it is inside the configured directory.

- [ ] **Step 4: Implement batch creation**

Multipart fields:

```ts
class CreateImportBatchDto {
  source!: string;
  rightsConfirmed!: boolean;
  title?: string;
  year?: number;
  defaultSubject?: string;
  defaultChapter?: string;
  pageRange?: string;
}
```

Create the batch and first `pending` job in one transaction. Record `rightsConfirmedAt` and actor ID. Return `202` with batch ID and status; never wait for parsing.

Record upload, rejection, cancel and retry with `AuditEventService`; metadata contains file SHA-256, type, byte count and status counts, never file or question text.

- [ ] **Step 5: Add list, detail, template, cancel and retry APIs**

Pagination defaults to 20 and caps at 100. Retry accepts explicit failed job IDs and increments attempt only after a successful database claim. Cancel prevents new external submissions but retains existing candidates.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
node --test test/question-import-api-contract.test.js
npm run build:api
npm run validate:env:development
```

Expected: PASS.

Commit:

```powershell
git add apps/api/src/questions/import apps/api/src/questions/questions.module.ts apps/api/src/public-environment.ts .env.production.example deploy/tencent-ip/.env.production.example test/question-import-api-contract.test.js
git commit -m "feat: create private question import batches"
```

---

### Task 4: PostgreSQL 任务认领和表格候选题

**Files:**
- Create: `apps/api/src/questions/import/import-worker.service.ts`
- Create: `apps/api/src/questions/import/import-candidate.service.ts`
- Create: `apps/api/src/questions/import/import-validation.ts`
- Create: `apps/api/src/questions/import/import-fingerprint.ts`
- Create: `test/question-import-worker.test.js`
- Modify: `apps/api/src/questions/import/question-import.controller.ts`
- Modify: `apps/api/src/questions/questions.module.ts`
- Modify: `scripts/integration-question-import.mjs`

**Interfaces:**
- Produces: `ImportWorkerService.claimNextJob(): Promise<ClaimedJob | null>`
- Produces: `ImportCandidateService.list(batchId, filters, page): Promise<CandidatePage>`
- Produces: `ImportCandidateService.update(id, revision, patch, actorId): Promise<CandidateView>`

- [ ] **Step 1: Write failing worker unit tests**

Test that two worker instances cannot claim the same job, a crash leaves a lease that can be reclaimed, one invalid row does not discard valid rows, and batch counts reflect candidate states.

```js
assert.equal(new Set([claimA?.id, claimB?.id].filter(Boolean)).size, 1);
assert.equal(result.validCandidates, 2);
assert.equal(result.failedCandidates, 1);
```

- [ ] **Step 2: Implement database-backed claiming**

Use a short transaction with `FOR UPDATE SKIP LOCKED`, set `leaseOwner`, `leaseExpiresAt`, and commit before parsing. The loop sleeps when empty and stops cleanly in `onModuleDestroy`. It must never keep a database transaction open while reading a file.

- [ ] **Step 3: Process table jobs**

Parse rows, resolve knowledge points by subject/chapter/title, normalize, fingerprint, find exact current duplicates, and save each row as a candidate. Exact duplicates get `duplicate_suspected` plus target family; invalid rows get `needs_edit` or `parse_failed` with field warnings. Correct rows enter `pending_review`.

Record candidate edit, bulk approval and ignore operations through `AuditEventService`, storing candidate IDs and warning counts only.

- [ ] **Step 4: Add candidate APIs**

Add paginated `GET /:batchId/candidates`, `PATCH /candidates/:candidateId`, and bulk approval for warning-free candidates. Updates require `revision`; stale revisions return `409` with the latest candidate.

- [ ] **Step 5: Verify restart behavior**

Extend `scripts/integration-question-import.mjs`: upload a CSV, stop the API after job claim, wait for lease expiry, restart, and assert candidates are created exactly once.

Run:

```powershell
npm run build:api
node --test test/question-import-worker.test.js
npm run db:test:up
node scripts/integration-question-import.mjs
npm run db:test:down
```

Expected: PASS and test Compose cleaned up.

- [ ] **Step 6: Commit**

```powershell
git add apps/api/src/questions/import apps/api/src/questions/questions.module.ts scripts/integration-question-import.mjs test/question-import-worker.test.js
git commit -m "feat: process table imports asynchronously"
```

---

### Task 5: 分批确认、重复策略和历史版本保护

**Files:**
- Create: `apps/api/src/questions/import/import-confirmation.service.ts`
- Create: `apps/api/src/questions/import/dto/confirm-import.dto.ts`
- Modify: `apps/api/src/questions/import/question-import.controller.ts`
- Modify: `apps/api/src/questions/questions.service.ts`
- Modify: `scripts/integration-question-import.mjs`

**Interfaces:**
- Produces: `POST /admin/question-imports/:batchId/confirm`
- Consumes: `{ candidateIds: string[]; idempotencyKey: string }`
- Candidate-specific strategy: `skip | create | new_version`

- [ ] **Step 1: Write failing integration scenarios**

Create four candidates: new, exact duplicate, similar independent question, and update of a question with a `PracticeRecord`. Assert default skip, explicit create, explicit new version, and old history retention.

```js
assert(oldQuestion.isCurrent === false);
assert(newQuestion.familyId === oldQuestion.familyId);
assert(newQuestion.versionNumber === oldQuestion.versionNumber + 1);
assert(await prisma.practiceRecord.count({ where: { questionId: oldQuestion.id } }) === 1);
```

Run: `node scripts/integration-question-import.mjs`

Expected: FAIL because confirm is absent.

- [ ] **Step 2: Implement pre-transaction confirmation validation**

Reject non-approved candidates, candidates from another batch, missing duplicate strategy, expired idempotency keys and any candidate already imported by a different confirmation. Recompute fingerprints against current questions immediately before the transaction.

- [ ] **Step 3: Implement serializable confirmation**

Inside `prisma.$transaction(..., { isolationLevel: 'Serializable' })`:

1. Create or load `QuestionImportConfirmation` by unique idempotency key.
2. Lock candidate rows.
3. Create a new `QuestionFamily` plus version 1 for `create`.
4. For `new_version`, lock the target family, mark its current row false, create version N+1.
5. For `skip`, mark candidate imported with no new question.
6. Promote referenced assets and attach them to the new `Question.id`.
7. Update candidate and batch counts and store result.
8. Write `AuditEvent` without题目全文.

Retry serialization conflicts up to three times with bounded jitter. After commit, call `QuestionsService.refreshFromDatabase()`.

- [ ] **Step 4: Prove idempotency and concurrency**

Send the same idempotency key twice and then two different keys concurrently for the same candidate. Assert one result is reused and only one current version exists.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npm run build:api
node scripts/integration-question-import.mjs
npm test
```

Expected: all PASS.

Commit:

```powershell
git add apps/api/src/questions/import apps/api/src/questions/questions.service.ts scripts/integration-question-import.mjs
git commit -m "feat: confirm versioned question imports"
```

---

### Task 6: Excel/CSV 管理员工作区

**Files:**
- Create: `apps/web/src/api/endpoints/question-import.ts`
- Create: `apps/web/src/features/admin/question-import/QuestionImportWorkspace.tsx`
- Create: `apps/web/src/features/admin/question-import/NewImportPanel.tsx`
- Create: `apps/web/src/features/admin/question-import/ImportBatchList.tsx`
- Create: `apps/web/src/features/admin/question-import/CandidateReview.tsx`
- Create: `test/question-import-ui.test.js`
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/api/index.ts`
- Modify: `apps/web/src/features/admin/AdminWorkspace.tsx`
- Modify: `apps/web/src/layouts/RoleNavigation.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Tasks 3–5 APIs
- Produces: complete XLSX/CSV upload-review-confirm UI

- [ ] **Step 1: Write failing UI contract tests**

Assert admin-only navigation, `.xlsx,.csv,.pdf` file input, required source, rights checkbox, progress counts, abnormal-only filter, duplicate strategy, bulk approval and confirmation summary.

- [ ] **Step 2: Implement API client and types**

Use `authenticatedFetch` and `FormData`; never set multipart `content-type` manually. Decode backend `message` and `x-request-id`.

```ts
export async function createQuestionImport(file: File, metadata: CreateImportMetadata) {
  const body = new FormData();
  body.append('file', file);
  body.append('source', metadata.source);
  body.append('rightsConfirmed', String(metadata.rightsConfirmed));
  return expectJson(await authenticatedFetch(`${API_BASE_URL}/admin/question-imports`, { method: 'POST', body }));
}
```

- [ ] **Step 3: Implement upload and batch list**

Disable submit until source and rights confirmation are present. Poll only active batches with exponential backoff (2s, 4s, then 10s); stop polling when the component unmounts. Show estimated versus confirmed costs distinctly.

- [ ] **Step 4: Implement candidate review and confirm**

Support single edit, warning-free bulk approval, filters, exact/similar duplicate comparison, and `crypto.randomUUID()` idempotency keys. Default duplicate action is skip; new-version requires a second confirmation.

Provide a downloadable UTF-8 BOM CSV error list with candidate row/page, field, code, reason and suggestion. Persist only non-sensitive recent defaults (`source`, year, subject and chapter) in local storage, and keep advanced page-range/provider controls collapsed by default. PDF selection shows that the file will be processed by a third-party parsing service.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
node --test test/question-import-ui.test.js
npm run build:web
npm test
```

Expected: PASS.

Commit:

```powershell
git add apps/web/src test/question-import-ui.test.js
git commit -m "feat: add admin table import workspace"
```

At this checkpoint, deploy to a non-production test environment and complete one XLSX and one CSV import before starting PDF work.

---

### Task 7: PDF provider contract and MinerU sample gate

**Files:**
- Create: `apps/api/src/questions/import/document-blocks.ts`
- Create: `apps/api/src/questions/import/providers/document-parser.provider.ts`
- Create: `apps/api/src/questions/import/providers/mineru.provider.ts`
- Create: `apps/api/src/questions/import/providers/fake-document.provider.ts`
- Create: `apps/api/src/questions/import/import-quality.service.ts`
- Create: `test/question-import-provider.test.js`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Modify: `apps/api/src/public-environment.ts`
- Modify: `.env.production.example`

**Interfaces:**
- Produces: `ParsedDocument { pages: ParsedPage[]; provider; model; rawResultKey? }`
- Produces: `ParsedPage { pageNumber; width; height; blocks; quality }`
- Produces: `MineruProvider` implementing `DocumentParserProvider`

- [ ] **Step 1: Install and pin the official SDK**

Run: `npm install mineru-open-sdk -w apps/api`

Expected: lockfile records the exact resolved version. Record that version in the reference note.

- [ ] **Step 2: Write provider contract tests**

Use `FakeDocumentProvider` to test queued, running, succeeded, failed and timeout states. MinerU HTTP/SDK calls must be mocked; unit tests never spend credits.

- [ ] **Step 3: Implement normalized document blocks**

```ts
export type DocumentBlock =
  | { kind: 'text'; text: string; region: SourceRegion; confidence?: number }
  | { kind: 'formula'; latex: string; region: SourceRegion; confidence?: number }
  | { kind: 'image'; providerAssetId: string; region: SourceRegion }
  | { kind: 'table'; html: string; region: SourceRegion };
```

Coordinates are normalized to page width and height. Preserve raw provider IDs for diagnostics, but candidate code depends only on this union.

- [ ] **Step 4: Implement MinerU adapter**

Construct `new MinerU(token)`, call `extract()` for one split PDF with `model: 'vlm'` and `timeout: 600`, store returned JSON/zip privately, and map layout JSON into `ParsedDocument`. Never log token, original document, response body or temporary signed links.

- [ ] **Step 5: Add a credential-free sample gate**

When `MINERU_API_TOKEN` is absent, PDF batches fail with the administrator message “PDF 解析服务尚未配置，Excel/CSV 导入仍可使用” and request ID. Table imports remain healthy.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
node --test test/question-import-provider.test.js
npm run build:api
npm run validate:env:development
```

Expected: PASS.

Commit:

```powershell
git add apps/api package-lock.json .env.production.example test/question-import-provider.test.js docs/development/reference-notes/2026-07-31-question-document-import.md
git commit -m "feat: add MinerU document provider"
```

---

### Task 8: PDF 拆分、页面预览和题目结构化

**Files:**
- Create: `apps/api/src/questions/import/pdf-document.service.ts`
- Create: `apps/api/src/questions/import/pdf-page-renderer.ts`
- Create: `apps/api/src/questions/import/question-structure.service.ts`
- Create: `test/question-import-pdf.test.js`
- Modify: `apps/api/src/questions/import/import-worker.service.ts`
- Modify: `apps/api/src/questions/import/question-import.controller.ts`
- Modify: `apps/api/src/questions/questions.module.ts`
- Modify: `Dockerfile`

**Interfaces:**
- Produces: `PdfDocumentService.pageCount(storageKey): Promise<number>`
- Produces: `PdfDocumentService.split(storageKey, ranges): Promise<StoredFile[]>`
- Produces: `PdfPageRenderer.render(storageKey, page): Promise<QuestionImportAsset>`
- Produces: `QuestionStructureService.structure(document): CandidateQuestionDraft[]`

- [ ] **Step 1: Add qpdf and Poppler to the API image**

Install `qpdf` and `poppler-utils` in the runtime stage, clear apt lists in the same layer, and add a Docker test asserting `qpdf --version` and `pdftoppm -v` exit successfully.

- [ ] **Step 2: Write failing split and structure tests**

Use a tiny generated PDF fixture. Assert 401 pages produce ranges 1–200, 201–400 and 401–401; page numbers remain global. Use a block fixture containing two numbered questions, a cross-page analysis and one formula; assert two candidates and an ambiguity warning where ownership is uncertain.

- [ ] **Step 3: Implement bounded child-process execution**

Use `spawn(command, args, { shell: false })`, explicit absolute paths inside private storage, one process at a time, 10-minute timeout and captured output capped at 64KB. Never concatenate user input into a shell command.

- [ ] **Step 4: Extend PDF jobs**

The first PDF job runs `qpdf --show-npages`, creates child jobs of at most configured 200 pages, and marks itself succeeded. Child jobs submit to MinerU, poll with persisted external task ID, save results, render required page previews and structure candidates. A failed child produces `parsing_partial_failure` without hiding successful candidates.

After splitting by page count, check every child file against MinerU's 200MB precision limit. Recursively halve an oversized multi-page range until every child is at most 200MB; reject a single page over 200MB with `PDF_PAGE_TOO_LARGE` and leave other page ranges processable.

- [ ] **Step 5: Add protected page-preview API**

`GET /admin/question-imports/:batchId/pages/:pageNumber` verifies admin role and batch ownership scope, streams the stored JPEG with `Cache-Control: private, max-age=300`, `X-Content-Type-Options: nosniff`, and no filesystem path.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
node --test test/question-import-pdf.test.js test/question-import-worker.test.js
npm run build:api
docker build -t kaoyan408-import-test .
docker run --rm kaoyan408-import-test sh -lc "qpdf --version && pdftoppm -v"
```

Expected: PASS.

Commit:

```powershell
git add Dockerfile apps/api/src/questions/import test/question-import-pdf.test.js
git commit -m "feat: process PDF question imports"
```

---

### Task 9: 题目资源、公式和原页审核 API

**Files:**
- Create: `apps/api/src/questions/import/import-asset.service.ts`
- Create: `apps/api/src/questions/import/dto/update-candidate.dto.ts`
- Create: `test/question-import-assets.test.js`
- Modify: `apps/api/src/questions/import/import-candidate.service.ts`
- Modify: `apps/api/src/questions/import/import-confirmation.service.ts`
- Modify: `apps/api/src/questions/import/question-import.controller.ts`
- Modify: `scripts/integration-question-import.mjs`

**Interfaces:**
- Produces: authenticated asset fetch
- Produces: candidate asset upload/crop association
- Consumes: formulas and source region from Task 8

- [ ] **Step 1: Write failing asset lifecycle tests**

Assert temporary page image access is admin-only, MIME is fixed from stored metadata, candidate crop can be uploaded, confirmation promotes only selected assets, and cleanup cannot delete a promoted asset.

- [ ] **Step 2: Implement asset endpoints**

Add:

```text
GET  /admin/question-import-assets/:assetId
POST /admin/question-import-candidates/:candidateId/assets
DELETE /admin/question-import-candidates/:candidateId/assets/:assetId
```

Uploads accept PNG/JPEG/WebP only, max 10MB, verify magic bytes and candidate batch relation. Store crop coordinates and SHA-256.

- [ ] **Step 3: Make promotion transactional**

First copy the file to a content-addressed permanent key, then in the confirmation transaction create the permanent DB reference. If the transaction fails, a later orphan sweep removes the unreferenced copy. Never move the only temporary copy before commit.

- [ ] **Step 4: Verify formulas and history**

Integration fixture creates a formula and image, confirms a new version, then asserts the old question asset remains reachable through old history and the new current version owns its promoted asset.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
node --test test/question-import-assets.test.js
node scripts/integration-question-import.mjs
npm run build:api
```

Expected: PASS.

Commit:

```powershell
git add apps/api/src/questions/import scripts/integration-question-import.mjs test/question-import-assets.test.js
git commit -m "feat: preserve question import assets"
```

---

### Task 10: PDF 原页对照、公式和图片审核界面

**Files:**
- Create: `apps/web/src/features/admin/question-import/SourcePagePreview.tsx`
- Create: `apps/web/src/features/admin/question-import/QuestionAssetEditor.tsx`
- Create: `apps/web/src/features/admin/question-import/FormulaPreview.tsx`
- Modify: `apps/web/src/features/admin/question-import/CandidateReview.tsx`
- Modify: `apps/web/src/api/endpoints/question-import.ts`
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Modify: `test/question-import-ui.test.js`

**Interfaces:**
- Consumes: Tasks 8–9 APIs
- Produces: desktop split-pane review and usable narrow-screen stacked review

- [ ] **Step 1: Install KaTeX**

Run: `npm install katex@0.16.22 -w apps/web && npm install -D @types/katex -w apps/web`

Expected: package files updated.

- [ ] **Step 2: Extend failing UI tests**

Assert source-page alt text, highlighted region overlay, formula input and preview, image retain/delete/crop controls, low-confidence badges, keyboard next/approve shortcuts and object URL cleanup.

- [ ] **Step 3: Implement authenticated page image loading**

Fetch with `authenticatedFetch`, convert to Blob URL, and revoke the old URL on page change or unmount. Overlay the normalized source region using percentages; never inject a storage URL directly.

- [ ] **Step 4: Implement safe formula preview**

Use `katex.render(latex, element, { throwOnError: false, trust: false, strict: 'warn' })`. Show parse errors beside the editable LaTeX field and preserve the literal value.

- [ ] **Step 5: Implement browser crop**

Draw the authenticated page Blob into a canvas, let the admin select a rectangle, export `image/png`, upload it to the candidate asset endpoint, and immediately revoke temporary URLs. Original extracted assets can be retained without crop.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
node --test test/question-import-ui.test.js
npm run build:web
npm test
```

Expected: PASS.

Commit:

```powershell
git add apps/web package-lock.json test/question-import-ui.test.js
git commit -m "feat: add PDF question review tools"
```

---

### Task 11: 腾讯云 OCR 回退、清理、配额和生产配置

**Files:**
- Create: `apps/api/src/questions/import/providers/tencent-page-ocr.provider.ts`
- Create: `apps/api/src/questions/import/import-cleanup.service.ts`
- Create: `test/question-import-cleanup.test.js`
- Modify: `apps/api/src/questions/import/import-quality.service.ts`
- Modify: `apps/api/src/questions/import/import-worker.service.ts`
- Modify: `apps/api/src/public-environment.ts`
- Modify: `compose.production.yml`
- Modify: `deploy/tencent-ip/nginx.conf`
- Modify: `Dockerfile`
- Modify: `.env.production.example`
- Modify: `deploy/tencent-ip/.env.production.example`
- Modify: `deploy/tencent-ip/backup.sh`
- Modify: `deploy/tencent-ip/verify-restore.sh`
- Modify: `test/deployment-config.test.js`

**Interfaces:**
- Produces: `TencentPageOcrProvider`
- Produces: daily `ImportCleanupService.run(now): Promise<CleanupSummary>`
- Produces: disk/quota admission guard

- [ ] **Step 1: Install the official OCR SDK and write failing fallback tests**

Run: `npm install tencentcloud-sdk-nodejs-ocr -w apps/api`

Mock the SDK. Assert fallback happens only for configured signals: empty page, abnormal character ratio, missing choice options or missing required blocks. Assert a normal page never incurs a second provider call.

- [ ] **Step 2: Implement per-page OCR fallback**

Send the already rendered private page JPEG to Tencent OCR, map text boxes into `ParsedPage`, retain both provider results, record the chosen result and cost, and never overwrite MinerU raw output.

- [ ] **Step 3: Implement cleanup and quotas**

Run cleanup once on startup and then daily. Delete expired temporary files only when no unresolved candidate requires them. Alert and retain unresolved batches. Delete permanent objects only when no `QuestionImportAsset` reference exists. Return counts and bytes, not file contents.

- [ ] **Step 4: Update production topology**

Add a named `question_import_data` volume mounted only into `app`; set worker concurrency 1 and memory-aware environment defaults. Raise Nginx `client_max_body_size` to the configured PDF maximum and set upload/read timeouts without exposing the volume.

- [ ] **Step 5: Extend backup and restore verification**

Back up the permanent asset directory into a timestamped archive with SHA-256 alongside the database dump. Restore verification checks archive integrity and at least one referenced asset when present. Temporary originals are excluded from backup.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
node --test test/question-import-cleanup.test.js test/deployment-config.test.js test/question-import-provider.test.js
npm run build:api
docker compose --env-file .env.production.example -f compose.production.yml config
npm run db:backup:verify
```

Expected: PASS without real cloud calls.

Commit:

```powershell
git add apps/api compose.production.yml deploy Dockerfile .env.production.example test package-lock.json
git commit -m "feat: operate resilient document imports"
```

---

### Task 12: 基准测试、管理员手册和端到端发布门

**Files:**
- Create: `scripts/benchmark-question-parser.mjs`
- Create: `docs/admin/question-document-import.md`
- Create: `docs/operations/question-import-benchmark.md`
- Modify: `scripts/staging-smoke.mjs`
- Modify: `test/staging-smoke.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: complete Tasks 1–11 implementation
- Produces: reproducible quality/cost JSON and release decision

- [ ] **Step 1: Implement the benchmark manifest and metrics**

The script accepts a private manifest not committed to Git:

```json
{
  "samples": [
    { "kind": "text", "path": "text.pdf", "expectedQuestions": 20 },
    { "kind": "scan", "path": "scan.pdf", "expectedQuestions": 20 },
    { "kind": "complex", "path": "complex.pdf", "expectedQuestions": 20 }
  ]
}
```

It uploads as admin, waits for review, exports candidate JSON, and reports split precision/recall, required-field completeness, answer association, formula/image retention, manual-warning rate, elapsed time and cost per 100 pages. It never prints token or extracted题目全文.

- [ ] **Step 2: Extend staging smoke**

Use generated CSV and a tiny generated PDF with the fake provider. Verify unauthorized rejection, upload, job restart, partial failure, edit, duplicate skip, version creation, repeated confirm, cleanup protection and current-question visibility.

- [ ] **Step 3: Write the administrator manual**

Document:

1. Table templates and allowed values.
2. PDF source/rights confirmation.
3. Progress, failure-page retry and costs.
4. Original-page review, formulas and crops.
5. Skip/create/new-version decisions.
6. Partial confirmation.
7. 30-day expiry and storage warnings.
8. Error messages and request IDs.
9. How to configure MinerU and Tencent credentials without committing them.

- [ ] **Step 4: Perform the automated release gate**

Run:

```powershell
npm test
npm run build:api
npm run build:web
npm run test:integration:postgres
npm run smoke:production-compose
node scripts/staging-smoke.mjs
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 5: Perform the manual sample gate**

The administrator supplies three legally usable PDFs outside Git. Run:

```powershell
node scripts/benchmark-question-parser.mjs --manifest C:\private-question-samples\manifest.json --output C:\private-question-samples\result.json
```

Review `result.json` together. Do not enable whole-book uploads in production until the administrator explicitly accepts the measured correction rate, cost per 100 pages and processing time. If rejected, keep PDF limited to small test files while Excel/CSV remains available.

- [ ] **Step 6: Commit final docs and gates**

```powershell
git add scripts/benchmark-question-parser.mjs scripts/staging-smoke.mjs test/staging-smoke.test.js docs/admin/question-document-import.md docs/operations/question-import-benchmark.md README.md
git commit -m "docs: verify document question imports"
```

---

## Execution Checkpoints

1. **After Task 1:** Review migration safety and existing history preservation.
2. **After Task 3:** Review private storage paths, upload limits and admin authorization.
3. **After Task 6:** Deploy Excel/CSV workflow to a test environment and obtain administrator acceptance.
4. **After Task 8:** Run MinerU only on one legally usable small sample and review quality/cost.
5. **After Task 11:** Run isolated backup/restore and disk-pressure tests.
6. **After Task 12:** Obtain explicit approval before enabling whole-book PDF import in production.

## Required Manual Inputs

These are not needed for Tasks 1–6:

- A MinerU API token for real PDF tests.
- Tencent Cloud OCR credentials with least-privilege OCR access for fallback tests.
- Three legally usable sample PDFs: text, scan and complex layout.
- Administrator acceptance thresholds after seeing the benchmark; the system must not invent these thresholds before real measurements.

Credentials must be entered only in `.env.production` on the server or approved test-environment secrets. They must never be pasted into chat logs, committed files, screenshots or test fixtures.
