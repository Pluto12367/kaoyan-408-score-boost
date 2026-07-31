# Excel 题库导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员通过中文 Excel/CSV 模板完成题库校验、预览、确认导入、版本保护和批次停用。

**Architecture:** 文件解析和字段校验保持为无数据库依赖的纯模块；预览结果持久化为有过期时间的导入批次，确认接口在 PostgreSQL 事务中写入题目版本。现有 `QuestionsService` 只向学生返回启用版本，导入完成后刷新内存缓存。

**Tech Stack:** NestJS 10、Prisma 5、PostgreSQL、ExcelJS、Multer、React 18、TypeScript 5、Node test runner。

## Global Constraints

- 只接受 `.xlsx` 和 `.csv`，单文件最多 10MB、1000 道题。
- 中文模板不要求管理员填写内部知识点 ID。
- 上传阶段只解析和校验，不写入正式题库。
- 存在阻断性错误时禁止确认导入，并提供行号、列名、原因和修改建议。
- 重复题按“规范化题干 + 来源 + 年份”识别，默认跳过。
- 更新重复题时创建新版本并停用旧版本，绝不覆盖有历史记录的题目。
- 停用导入批次不得删除学生答题、错题或报告记录。
- 相同文件摘要、相同策略的重复确认必须返回原导入结果。
- 上传临时数据到期后自动清理；审计日志不得记录题目全文。
- 本计划依赖 `2026-07-29-invitation-account-management.md` 提供的 `AuditEventService` 和管理员认证。

---

## File Structure

- `apps/api/src/questions/import/question-import.types.ts`：跨解析、预览和确认的稳定类型。
- `apps/api/src/questions/import/question-import-normalize.ts`：中文字段、题型、难度和题干规范化。
- `apps/api/src/questions/import/question-import-parser.ts`：解析 Excel/CSV Buffer。
- `apps/api/src/questions/import/question-template.service.ts`：生成中文模板。
- `apps/api/src/questions/import/question-import.service.ts`：预览、确认、幂等和批次停用。
- `apps/api/src/questions/import/question-import.controller.ts`：管理员文件上传与批次 API。
- `apps/api/src/questions/import/dto/confirm-question-import.dto.ts`：确认策略。
- `prisma/schema.prisma`：题目版本和导入批次模型。
- `apps/api/src/questions/questions.service.ts`：只加载启用题目并提供缓存刷新。
- `apps/web/src/features/admin/QuestionImportPanel.tsx`：上传、错误、预览和确认。
- `apps/web/src/features/admin/QuestionImportHistory.tsx`：批次历史和停用。
- `apps/web/src/api/endpoints/question-import.ts`：multipart 和批次请求。
- `test/question-import-normalize.test.js`、`test/question-import-parser.test.js`、`test/question-import-ui.test.js`：纯逻辑和 UI 契约。
- `scripts/integration-postgres.mjs`：真实数据库版本与幂等验证。

### Task 1: 中文字段规范化、CSV/Excel 解析与模板

**Files:**
- Create: `apps/api/src/questions/import/question-import.types.ts`
- Create: `apps/api/src/questions/import/question-import-normalize.ts`
- Create: `apps/api/src/questions/import/question-import-parser.ts`
- Create: `apps/api/src/questions/import/question-template.service.ts`
- Create: `test/question-import-normalize.test.js`
- Create: `test/question-import-parser.test.js`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Test: `test/question-import-normalize.test.js`
- Test: `test/question-import-parser.test.js`

**Interfaces:**
- Produces: `parseQuestionImport(buffer: Buffer, fileName: string): Promise<ParsedImport>`
- Produces: `normalizeQuestionRow(row: RawQuestionRow, rowNumber: number): NormalizedQuestionRow | QuestionImportIssue[]`
- Produces: `buildQuestionTemplate(): Promise<Buffer>`
- Produces: `QuestionImportIssue { row; column; code; message; suggestion; severity }`

- [ ] **Step 1: 安装 Excel 解析依赖**

Run: `npm install exceljs -w apps/api`

Expected: `apps/api/package.json` 和 `package-lock.json` 更新，安装 exit 0。

- [ ] **Step 2: 写失败的规范化测试**

```js
test('normalizes a valid Chinese template row', () => {
  const result = normalizeQuestionRow({
    科目: ' 操作系统 ',
    章节: '进程管理',
    知识点: '进程同步与互斥',
    题型: '选择题',
    难度: '中等',
    题干: '  PV 操作的主要用途是？ ',
    '选项 A': '进程同步',
    '选项 B': '磁盘调度',
    '选项 C': '地址转换',
    '选项 D': '文件分配',
    正确答案: 'A',
    答案解析: 'P、V 操作用于同步与互斥。',
    来源: '原创',
    年份: '2026',
    '建议答题时间（秒）': '90',
  }, 2);
  assert.equal(result.value.stem, 'PV 操作的主要用途是？');
  assert.deepEqual(result.value.options, ['进程同步', '磁盘调度', '地址转换', '文件分配']);
  assert.equal(result.issues.length, 0);
});
```

再写无效答案、未知题型、缺少解析、年份越界、时间少于 30 秒和 1001 行上限测试。

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test test/question-import-normalize.test.js`

Expected: FAIL，找不到规范化模块。

- [ ] **Step 4: 定义稳定类型并实现规范化**

```ts
export interface NormalizedQuestionRow {
  rowNumber: number;
  subject: '数据结构' | '计算机组成原理' | '操作系统' | '计算机网络';
  chapter: string;
  knowledgePointTitles: string[];
  type: '选择题' | '综合题' | '判断题';
  difficulty: '基础' | '中等' | '困难';
  stem: string;
  normalizedStem: string;
  options: string[];
  answer: string;
  analysis: string;
  source: string;
  year?: number;
  expectedTimeSec: number;
}

export interface QuestionImportIssue {
  row: number;
  column: string;
  code: string;
  message: string;
  suggestion: string;
  severity: 'error' | 'warning';
}
```

`normalizeStem()` 使用 Unicode NFKC、连续空白折叠和首尾去空格，不移除实际标点，以避免不同题目被误判为重复。

- [ ] **Step 5: 写失败的 xlsx/csv 解析测试**

```js
test('parses both xlsx and utf-8 csv into the same raw rows', async () => {
  const xlsx = await fixtureWorkbookBuffer();
  const csv = Buffer.from('科目,章节,知识点,题型,难度,题干,选项 A,选项 B,选项 C,选项 D,正确答案,答案解析,来源,年份,建议答题时间（秒）\n操作系统,进程管理,进程同步与互斥,选择题,中等,题干,A,B,C,D,A,解析,原创,2026,90');
  assert.equal((await parseQuestionImport(xlsx, 'questions.xlsx')).rows.length, 1);
  assert.equal((await parseQuestionImport(csv, 'questions.csv')).rows.length, 1);
});
```

- [ ] **Step 6: 实现解析与模板**

`parseQuestionImport()` 按扩展名选择 ExcelJS workbook 或 CSV parser；CSV 必须支持带引号逗号和 UTF-8 BOM。模板工作簿包含：

1. `题库导入` 工作表与固定中文表头。
2. `填写说明` 工作表。
3. 科目、题型、难度和正确答案的数据验证下拉列表。
4. 一道不进入正式导入的示例行。

```ts
export async function buildQuestionTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('题库导入');
  sheet.addRow(CHINESE_HEADERS);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  // add validations and one example row
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
```

- [ ] **Step 7: 运行测试与构建**

Run: `node --test test/question-import-normalize.test.js test/question-import-parser.test.js`

Expected: PASS。

Run: `npm run build:api`

Expected: exit 0。

- [ ] **Step 8: 提交**

```bash
git add apps/api/package.json package-lock.json apps/api/src/questions/import/question-import.types.ts apps/api/src/questions/import/question-import-normalize.ts apps/api/src/questions/import/question-import-parser.ts apps/api/src/questions/import/question-template.service.ts test/question-import-normalize.test.js test/question-import-parser.test.js
git commit -m "feat: parse Chinese question import workbooks"
```

### Task 2: 题目版本与导入批次数据模型

**Files:**
- Create: `prisma/migrations/20260729130000_question_import_batches/migration.sql`
- Create: `test/question-import-schema.test.js`
- Modify: `prisma/schema.prisma`
- Modify: `apps/api/src/questions/questions.service.ts`
- Test: `test/question-import-schema.test.js`
- Modify: `scripts/import-questions.mjs`

**Interfaces:**
- Produces: `QuestionImportBatch`
- Produces: `QuestionImportStatus`, `QuestionImportStrategy`
- Produces: `Question.isActive`, `Question.version`, `Question.normalizedStem`, `Question.supersedesId`, `Question.importBatchId`
- Produces: `QuestionsService.refreshFromDatabase(): Promise<void>`

- [ ] **Step 1: 写失败的 schema 测试**

```js
test('question schema supports import batches and immutable versions', () => {
  assert.match(schema, /model QuestionImportBatch\s*\{/);
  assert.match(schema, /fileSha256\s+String/);
  assert.match(schema, /preview\s+Json/);
  assert.match(schema, /expiresAt\s+DateTime/);
  assert.match(schema, /normalizedStem\s+String/);
  assert.match(schema, /isActive\s+Boolean\s+@default\(true\)/);
  assert.match(schema, /supersedesId\s+String\?/);
  assert.match(schema, /importBatchId\s+String\?/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/question-import-schema.test.js`

Expected: FAIL。

- [ ] **Step 3: 增加模型和迁移**

```prisma
enum QuestionImportStatus {
  VALIDATED
  IMPORTED
  FAILED
  DISABLED
  EXPIRED
}

enum QuestionImportStrategy {
  SKIP
  UPDATE
}

model QuestionImportBatch {
  id            String                 @id @default(cuid())
  fileName      String
  fileSha256    String
  uploadedById  String
  status        QuestionImportStatus
  strategy      QuestionImportStrategy?
  preview       Json
  result        Json?
  expiresAt     DateTime
  confirmedAt   DateTime?
  disabledAt    DateTime?
  createdAt     DateTime               @default(now())
  questions     Question[]

  @@index([createdAt])
  @@index([fileSha256, strategy, status])
  @@index([expiresAt, status])
}
```

`Question` 增加版本字段和自关联：

```prisma
normalizedStem String
isActive       Boolean  @default(true)
version        Int      @default(1)
supersedesId   String?
importBatchId  String?
supersedes     Question? @relation("QuestionVersions", fields: [supersedesId], references: [id], onDelete: Restrict)
newerVersions  Question[] @relation("QuestionVersions")
importBatch    QuestionImportBatch? @relation(fields: [importBatchId], references: [id], onDelete: SetNull)

@@index([normalizedStem, source, year, isActive])
@@index([importBatchId, isActive])
```

迁移使用现有题干生成初始 `normalizedStem`；PostgreSQL SQL 只执行 `trim(regexp_replace(stem, '\s+', ' ', 'g'))`，应用首次加载时再统一 NFKC。

- [ ] **Step 4: 只向新练习暴露启用题**

```ts
async refreshFromDatabase() {
  if (!this.persistenceEnabled) return;
  const rows = await this.prisma.question.findMany({
    where: { isActive: true },
    include: { knowledgePoints: true },
    orderBy: { createdAt: 'asc' },
  });
  this.questions.splice(0, this.questions.length, ...rows.map(toSharedQuestion));
}
```

`onModuleInit()` 调用该方法；`listQuestions()` 的内存路径保持不变。旧题仍可通过学习会话快照和历史关联读取。

`createQuestion()`、`updateQuestion()` 和 `scripts/import-questions.mjs` 的所有题目写入都必须设置 `normalizedStem`。教师更新题干时同步重新计算；旧命令行导入默认只匹配启用版本。

- [ ] **Step 5: 运行验证**

Run: `npx prisma generate --schema prisma/schema.prisma`

Expected: exit 0。

Run: `node --test test/question-import-schema.test.js`

Expected: PASS。

Run: `npm run build:api`

Expected: exit 0。

- [ ] **Step 6: 提交**

```bash
git add prisma/schema.prisma prisma/migrations/20260729130000_question_import_batches/migration.sql apps/api/src/questions/questions.service.ts scripts/import-questions.mjs test/question-import-schema.test.js
git commit -m "feat: add versioned question import batches"
```

### Task 3: 预览服务与管理员上传 API

**Files:**
- Create: `apps/api/src/questions/import/question-import.service.ts`
- Create: `apps/api/src/questions/import/question-import.controller.ts`
- Create: `test/question-import-api-contract.test.js`
- Modify: `apps/api/src/questions/questions.module.ts`
- Modify: `apps/api/src/questions/import/question-import.types.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Test: `test/question-import-api-contract.test.js`

**Interfaces:**
- Consumes: `parseQuestionImport()` from Task 1
- Consumes: batch model from Task 2
- Produces: `POST /admin/question-imports/preview`
- Produces: `GET /admin/question-imports/template`
- Produces: `GET /admin/question-imports`
- Produces: `GET /admin/question-imports/:batchId`

- [ ] **Step 1: 安装上传类型**

Run: `npm install -D @types/multer -w apps/api`

Expected: package files update。

- [ ] **Step 2: 写失败的 API 契约测试**

```js
test('question import endpoints are admin-only and limit uploads', async () => {
  const source = await readFile(new URL('../apps/api/src/questions/import/question-import.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /@Controller\('admin\/question-imports'\)/);
  assert.match(source, /@Roles\('admin'\)/);
  assert.match(source, /FileInterceptor\('file'/);
  assert.match(source, /limits:\s*\{\s*fileSize:\s*10 \* 1024 \* 1024/);
  assert.match(source, /@Post\('preview'\)/);
  assert.match(source, /@Get\('template'\)/);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test test/question-import-api-contract.test.js`

Expected: FAIL。

- [ ] **Step 4: 实现预览**

`QuestionImportService.preview()`：

1. 校验扩展名和 MIME。
2. 计算 SHA-256。
3. 解析并规范化全部行。
4. 一次查询中文知识点映射。
5. 查询疑似重复题。
6. 生成统计、最多 20 道完整预览和全部错误。
7. 将完整规范化行保存在 `preview` JSON，`expiresAt=now+2h`。
8. 返回批次 ID、统计、错误和预览。

预览成功或拒绝后通过 `AuditEventService.record()` 写入 `question_import.preview`，元数据只包含文件摘要、行数和错误数。

```ts
export interface QuestionImportPreview {
  batchId: string;
  fileName: string;
  expiresAt: string;
  canConfirm: boolean;
  summary: { total: number; newCount: number; duplicateCount: number; errorCount: number; warningCount: number };
  distribution: Record<string, Record<string, number>>;
  sample: NormalizedQuestionRow[];
  issues: QuestionImportIssue[];
}
```

知识点无法唯一匹配时返回 `KNOWLEDGE_POINT_AMBIGUOUS`，建议明确章节；不存在时返回 `KNOWLEDGE_POINT_UNKNOWN`。

- [ ] **Step 5: 实现 Controller**

```ts
@Controller('admin/question-imports')
@UseGuards(RoleGuard)
@Roles('admin')
export class QuestionImportController {
  @Get('template')
  async template(@Res() response: Response) {
    response.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('content-disposition', 'attachment; filename="question-import-template.xlsx"');
    response.end(await this.templates.buildQuestionTemplate());
  }

  @Post('preview')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  }))
  preview(@CurrentUser() user: UserProfile, @UploadedFile() file: Express.Multer.File) {
    return this.imports.preview(file, user.id);
  }
}
```

显式使用 `memoryStorage()`，文件只在单次请求内存中存在；解析后只保存规范化 JSON，不向磁盘写入上传原文件。

- [ ] **Step 6: 运行测试与构建**

Run: `node --test test/question-import-api-contract.test.js test/question-import-parser.test.js`

Expected: PASS。

Run: `npm run build:api`

Expected: exit 0。

- [ ] **Step 7: 提交**

```bash
git add apps/api/package.json package-lock.json apps/api/src/questions/import/question-import.service.ts apps/api/src/questions/import/question-import.controller.ts apps/api/src/questions/import/question-import.types.ts apps/api/src/questions/questions.module.ts test/question-import-api-contract.test.js
git commit -m "feat: preview question workbook imports"
```

### Task 4: 确认导入、版本保护、幂等与批次停用

**Files:**
- Create: `apps/api/src/questions/import/dto/confirm-question-import.dto.ts`
- Modify: `apps/api/src/questions/import/question-import.controller.ts`
- Modify: `apps/api/src/questions/import/question-import.service.ts`
- Modify: `apps/api/src/questions/questions.service.ts`
- Modify: `scripts/integration-postgres.mjs`
- Test: `scripts/integration-postgres.mjs`

**Interfaces:**
- Produces: `POST /admin/question-imports/:batchId/confirm`
- Produces: `POST /admin/question-imports/:batchId/disable`
- Produces: `QuestionImportResult { batchId; created; versioned; skipped; status }`

- [ ] **Step 1: 先写失败的集成场景**

```js
const preview = await previewQuestionImport(validWorkbook);
const first = await confirmQuestionImport(preview.batchId, 'update');
const retry = await confirmQuestionImport(preview.batchId, 'update');
ensure(first.batchId === retry.batchId, 'repeat confirmation must return same batch');
ensure(first.created === retry.created, 'repeat confirmation must not duplicate questions');

const answeredQuestionId = await createAnsweredQuestion();
const updateBatch = await importUpdatedVersion(answeredQuestionId);
const oldQuestion = await prisma.question.findUnique({ where: { id: answeredQuestionId } });
ensure(oldQuestion.isActive === false, 'old answered version must become inactive');
ensure(await countPracticeRecords(answeredQuestionId) > 0, 'historical records must remain attached');
```

- [ ] **Step 2: 运行集成测试确认失败**

Run: `npm run test:integration:postgres`

Expected: FAIL，确认接口不存在。

- [ ] **Step 3: 实现确认事务**

```ts
async confirm(batchId: string, strategy: 'skip' | 'update', actorId: string) {
  const result = await this.prisma.$transaction(async (tx) => {
    const batch = await tx.questionImportBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('导入批次不存在');
    if (batch.status === 'IMPORTED') return batch.result as QuestionImportResult;
    if (batch.expiresAt <= new Date()) throw new BadRequestException('导入预览已过期，请重新上传');
    const preview = decodeStoredPreview(batch.preview);
    if (preview.issues.some((item) => item.severity === 'error')) {
      throw new BadRequestException('存在阻断性错误，不能确认导入');
    }
    // for each row: create, skip, or create new version and deactivate old
    // update batch result and audit event before commit
    return importResult;
  }, { isolationLevel: 'Serializable', timeout: 30_000 });
  await this.questions.refreshFromDatabase();
  return result;
}
```

`UPDATE` 始终创建新 `Question`，`version=old.version+1`、`supersedesId=old.id`，再将旧题 `isActive=false`。知识点关联在新版本上重新创建。

- [ ] **Step 4: 实现批次停用**

事务规则：

1. 将该批次创建的当前启用题设为 `isActive=false`。
2. 如果被停用题 `supersedesId` 指向旧版本，且不存在其他启用的新版本，则恢复该旧版本。
3. 不删除任何题、关联或作答记录。
4. 批次状态改为 `DISABLED` 并写审计。
5. 完成后刷新题库缓存。

```ts
@Post(':batchId/disable')
disable(@CurrentUser() user: UserProfile, @Param('batchId') batchId: string) {
  return this.imports.disableBatch(batchId, user.id);
}
```

- [ ] **Step 5: 清理过期预览**

`onModuleInit()` 把超过 `expiresAt` 且状态仍为 `VALIDATED` 的批次改为 `EXPIRED`，并将 `preview` 改成只保留统计和错误摘要，删除完整规范化行。

- [ ] **Step 6: 运行集成与构建**

Run: `npm run test:integration:postgres`

Expected: 新增、跳过、版本化、幂等、停用恢复和历史记录保护全部 PASS。

Run: `npm run build:api`

Expected: exit 0。

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/questions/import/dto/confirm-question-import.dto.ts apps/api/src/questions/import/question-import.controller.ts apps/api/src/questions/import/question-import.service.ts apps/api/src/questions/questions.service.ts scripts/integration-postgres.mjs
git commit -m "feat: confirm versioned question imports"
```

### Task 5: 管理后台上传、预览和批次历史

**Files:**
- Create: `apps/web/src/api/endpoints/question-import.ts`
- Create: `apps/web/src/features/admin/QuestionImportPanel.tsx`
- Create: `apps/web/src/features/admin/QuestionImportHistory.tsx`
- Create: `test/question-import-ui.test.js`
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/api/index.ts`
- Modify: `apps/web/src/features/admin/AdminWorkspace.tsx`
- Modify: `apps/web/src/hooks/useRoleWorkspaceData.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `test/question-import-ui.test.js`

**Interfaces:**
- Consumes: Tasks 3–4 API
- Produces: 管理员四态 UI：未上传、校验中、可确认、已完成/失败

- [ ] **Step 1: 写失败的 UI 契约测试**

```js
test('admin question import UI provides template, upload, issue and confirmation controls', async () => {
  const panel = await readFile(new URL('../apps/web/src/features/admin/QuestionImportPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /下载 Excel 模板/);
  assert.match(panel, /accept="\.xlsx,\.csv"/);
  assert.match(panel, /错误清单/);
  assert.match(panel, /确认导入/);
  assert.match(panel, /更新重复题/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/question-import-ui.test.js`

Expected: FAIL。

- [ ] **Step 3: 增加 API 类型与请求**

```ts
export async function previewQuestionImport(file: File): Promise<QuestionImportPreview> {
  const body = new FormData();
  body.append('file', file);
  const response = await authenticatedFetch(`${API_BASE_URL}/admin/question-imports/preview`, {
    method: 'POST',
    body,
  });
  if (!response.ok) throw await apiError(response, '题库文件校验失败');
  return response.json();
}
```

不要手动设置 multipart `content-type`，由浏览器生成 boundary。错误对象统一读取后端 `message` 和 `x-request-id`。

- [ ] **Step 4: 实现上传与预览面板**

`QuestionImportPanel`：

- 文件选择后显示文件名和大小。
- 上传时禁用重复提交。
- 错误表按行号排序，列出列名、原因和建议。
- 用 Blob 生成 UTF-8 BOM CSV 错误清单下载。
- 可确认时展示新增/重复数量和分布。
- 默认策略为“跳过重复题”；管理员主动选择后才能“更新重复题”。
- 确认前二次提示版本化影响。

- [ ] **Step 5: 实现历史面板**

`QuestionImportHistory` 列出文件名、操作人、时间、状态、新增/版本化/跳过数量。只有 `IMPORTED` 批次显示“停用本批题目”，点击后要求二次确认。

成功确认或停用后同时刷新批次列表、管理员指标和教师题库资源。

- [ ] **Step 6: 运行测试和构建**

Run: `node --test test/question-import-ui.test.js`

Expected: PASS。

Run: `npm run build:web`

Expected: exit 0。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/api/endpoints/question-import.ts apps/web/src/features/admin/QuestionImportPanel.tsx apps/web/src/features/admin/QuestionImportHistory.tsx apps/web/src/api/types.ts apps/web/src/api/index.ts apps/web/src/features/admin/AdminWorkspace.tsx apps/web/src/hooks/useRoleWorkspaceData.ts apps/web/src/App.tsx apps/web/src/styles.css test/question-import-ui.test.js
git commit -m "feat: add admin question import workflow"
```

### Task 6: 端到端验收、模板样例和管理员文档

**Files:**
- Create: `kaoyan-408-content-starter/imports/question-import-template.xlsx`
- Create: `docs/admin/question-import.md`
- Modify: `kaoyan-408-content-starter/docs/csv-import-workflow.md`
- Modify: `scripts/staging-smoke.mjs`
- Modify: `test/staging-smoke.test.js`
- Test: `test/staging-smoke.test.js`

**Interfaces:**
- Consumes: Tasks 1–5
- Produces: 可下载模板、重复执行的 staging 验收和中文操作说明

- [ ] **Step 1: 扩展失败的冒烟测试**

```js
test('staging smoke previews and imports a one-row workbook as admin', async () => {
  const result = await runStagingSmoke(config, {
    fetchImpl,
    adminCredentials,
    questionWorkbook: validWorkbook,
    log: () => {},
  });
  assert.equal(result.questionImport.created, 1);
  assert.equal(result.questionImport.retryCreated, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/staging-smoke.test.js`

Expected: FAIL，结果中没有 `questionImport`。

- [ ] **Step 3: 更新冒烟流程**

新增管理员凭据环境变量。流程先用一份包含错误答案的文件验证 `canConfirm=false`，再用有效文件验证：

1. 上传预览成功。
2. 确认新增 1 题。
3. 重试确认返回相同批次结果。
4. 教师题库列表能看到新题。
5. 停用批次后学生抽题列表不再出现新题。

- [ ] **Step 4: 生成模板资产并写文档**

使用 `QuestionTemplateService` 的同一生成逻辑输出仓库样例，避免手工模板与接口模板漂移。文档包含：

- 每列含义和允许值。
- 常见错误及修改示例。
- 默认跳过与更新重复题的区别。
- 已作答题目为何会生成新版本。
- 批次停用不会删除学生历史记录。

- [ ] **Step 5: 运行完整验证**

Run: `npm test`

Expected: 全部 Node tests PASS。

Run: `npm run build:api`

Expected: exit 0。

Run: `npm run build:web`

Expected: exit 0。

Run: `npm run test:integration:postgres`

Expected: 导入、幂等、版本、停用和历史保护场景 PASS。

- [ ] **Step 6: 提交**

```bash
git add kaoyan-408-content-starter/imports/question-import-template.xlsx docs/admin/question-import.md kaoyan-408-content-starter/docs/csv-import-workflow.md scripts/staging-smoke.mjs test/staging-smoke.test.js
git commit -m "docs: verify Excel question import workflow"
```
