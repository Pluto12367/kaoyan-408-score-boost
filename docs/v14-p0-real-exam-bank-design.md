# V14-P0 真题库建设详细设计（2009–2026 选择题 + 大题）

> 状态：**Design Gate 材料**（对应本设计本身即为 RULE-01 的 Read-only Audit + Design Gate 产物）。
> 性质：零代码 / 零 schema 变更 / 零数据变更。实施需 Owner 对 §14 决策点逐项批准后另行下达任务书。
> 任务来源：Owner 2026-09-25 指令「进行 P0-1 真题库建设的详细设计，不要修改代码」。
> 前置阅读：`docs/audit/codebrick-benchmark-2026-09-25.md`（竞品对比，本设计 §1 目标来源）、`docs/v13-p0-1-question-scoring-foundation-design.md`（Owner Decision v1.1 D1–D12，本设计全部继承）。

---

## 1. 目标与非目标

### 1.1 目标

1. 把 2009–2026 共 18 年 408 统考真题（约 846 道：每年 40 选择 + 7 综合）建成**可练习、可定价、可归因**的正式题库资产。
2. 每道真题携带：**分值**（`maxScore`，点燃 ScoreLoss coverage）、**题号**（`examNo`，作战板/套卷定位）、**考点映射**（粗粒度 KnowledgePoint + 细粒度 KnowledgeNode 双层）、选择题**逐选项陷阱解析**（CodeBrick 已验证的学生价值最高的内容形态）。
3. 大题（41–47）携带 rubric（判分标准），复用 F4 离线评分链与既有内容规范。
4. 全程复用既有导入管道与共享解析器，**不新建第二套内容 SoT**（RULE-09）。

### 1.2 非目标（本设计明确不做）

- 不实现呈现层 UI（作战板/套卷/陷阱展示/数据屏）——只在 §10 定义数据契约，实现另行立项。
- 不实现大题 AI 估分接线（属已出的 Owner Gate Packet，见 benchmark 报告 P1-3，本设计只保证 rubric 数据就绪）。
- 不改任何既有语义：ScoreLoss / Mastery / Recommendation priority / QuestionType / 学生视图既有行为全部不动。
- 不做 OJ、可视化、择校（P3 缓行轨）。
- 不自动把任何 AI 生成内容升级为 verified（RULE-10）。

---

## 2. 只读审计结论（一手事实，2026-09-25）

### 2.1 既有可复用资产

| 资产 | 位置 | 与本设计的关系 |
|---|---|---|
| CSV 批量导入器（干跑/替换/版本化/去重/硬校验） | `scripts/import-questions.mjs`（421 行） | 直接扩展复用：列解析（`parseCsv`，引号感知）、`validateRows` 硬校验框架、`toQuestionWrite` 版本化写入、family 版本链 |
| 共享解析器三件套 | `normalizeMaxScoreInput` / `normalizeQuestionSubtype` / `parseRubricInput`（`packages/shared`） | 陷阱解析新增第四件 `parseOptionAnalyses`，完全同模式（单一 shape 源、非法整行硬拒、缺席=null） |
| rubric v1 内容规范 | `kaoyan-408-content-starter/docs/large-question-authoring-guide.md`（§4 JSON 规范、§6 工作流、§7 红线「不得把 AI 生成内容直接当真题导入；真题必须有可核查出处」） | 大题内容生产全量继承，不新造规范 |
| 大题 CSV 模板（13 列） | `kaoyan-408-content-starter/imports/large-question-template.csv` | 真题模板的列基线 |
| **真题对标层已存在 5 年数据** | `408-codex-handoff/data/408/exam-mapping/408-2022..2026-question-knowledge-map.json`：每年 47 行，含 `questionNo / subject / questionType / score(verified) / summary / primaryKnowledgePointId / secondaryKnowledgePointIds / mappingConfidence`，且 meta 带 `copyrightNote: 仅保存题号、分值、自写摘要与知识点映射，不保存完整真题题干` | **重大复用点**：(a) 2022–2026 的分值/题号/节点映射已人工核验（`scoreStatus: verified`），可直接预填内容生产脚手架；(b) 该层经 `scripts/seed-408-v2.mjs`（`upsertExamYear`，paperId=`paper-408-YYYY`）已入库 `ExamPaper/ExamQuestion/ExamQuestionKnowledgeTag` |
| 节点直标写入链 | `QuestionKnowledgeNodeTag`（`prisma/schema.prisma:1010-1024`，role PRIMARY/SECONDARY、taggedBy、source 列）+ 桥接兜底脚本 `scripts/link-question-bank-to-nodes.mjs`（`BRIDGE_TAG_SOURCE='bridge:knowledge-point-map'`） | 真题的细粒度归因直写此表，`taggedBy=HUMAN` |
| 学生视图剥离 | `apps/api/src/questions/question-view.ts`：`toStudentQuestion` 置空 `answer`/`analysis`（综合题例外保留 analysis） | 陷阱解析必须加入剥离面（§10.1），这是本设计的安全边界 |
| ScoreLoss 定价链 | `Question.maxScore`（schema.prisma:433-436 注释：null=未定价≠0）+ S1 价格优先级①原生消费 maxScore + D8 coverage=有效分值×有效失分证据双条件 | 真题分值入库后 coverage>0 自动达成，**语义零变更** |
| 内容审计工具模式 | `npm run audit:large-question-content`（per-subtype trainable 计数 + 缺口清单 + verdict） | 新增 `audit:real-exam-content` 照此模式 |
| 内容审核留痕 | `QuestionImportBatch` 表 + `Question.importBatchId`（可空 FK，`schema.prisma:418`） | 真题导入建 batch 记录写入 `reviewedBy`，满足 RULE-10 可追溯（无需 schema 变更） |

### 2.2 缺口清单（本设计要补的）

1. **练习库真题 = 0**：`Question` 表无任何 2009–2026 真题（现有 320 题全部自编）。
2. **逐选项陷阱无存储形状**：`Question.analysis` 单一 blob（`schema.prisma:422`），无法表达「每个错误选项为什么错」。
3. **真题题号无字段**：作战板/套卷需要 `(year, examNo)` 定位，`Question` 只有 `year Int?`（`schema.prisma:426`）。
4. **exam-mapping 只覆盖 2022–2026**：2009–2021（13 年 × 47 = 611 行）的题号/分值/映射需新制。
5. **导入器无节点直标写入**：现有脚本只写 16 个粗粒度 `QuestionKnowledgePoint`（硬编码 `knowledgePointSeed`），不写 `QuestionKnowledgeNodeTag`。
6. **subtype 字典覆盖缺口**（Owner 决策 D-3）：7 码字典（`schema.prisma:51-59`）中 OS_PV/CN_ROUTING 无法覆盖真题 46 题（OS 内存/文件计算）与 47 题（TCP/应用层计算）等形态。

---

## 3. 总体设计：三条线

```
线 A  练习库（学生刷的题）      CSV ──► Question（完整题干/选项/答案/解析/陷阱/maxScore/examNo）
线 B  真题对标层（已存在）      exam-mapping JSON ──► ExamPaper/ExamQuestion/ExamQuestionKnowledgeTag
线 C  链接（读侧联结，零 schema）  Question.year + Question.examNo  ⇄  ExamQuestion(paperId, questionNo)
```

- **线 A 是本设计的主体**（内容 + 导入器 + 一条迁移）。
- **线 B 已存在**，2022–2026 已入库；2009–2021 由内容生产计划补制（§12），格式不变。
- **线 C 故意不做外键**：`Question` 是版本化表（family + versionNumber + isCurrent），外键指向「当前版本」意味着每次版本更替都要改写链接行，与「历史版本永不改写」的纪律纠缠。读侧按 `(year, examNo, isCurrent=true)` 联结即可满足全部已知消费方（作战板状态格、套卷定位、对标层下钻），零耦合。若未来出现强完整性需求，再以独立 additive 迁移加 `ExamQuestion.questionId String?`（已评估可行，非本期）。

---

## 4. Schema 变更设计（唯一迁移：40 号，additive nullable）

### 4.1 迁移内容

`prisma/migrations/20260926000000_real_exam_foundation/migration.sql`：

```sql
-- V14-P0 real-exam foundation (additive, nullable, zero backfill).
-- optionAnalyses: per-wrong-option trap analysis. NULL = 未撰写（≠ 空，≠ 无陷阱）。
-- 形状契约见 docs/v14-p0-real-exam-bank-design.md §5（parseOptionAnalyses 单一 shape 源）。
ALTER TABLE "Question" ADD COLUMN "optionAnalyses" JSONB;
COMMENT ON COLUMN "Question"."optionAnalyses" IS
  'V14-P0: per-wrong-option trap map {version:1, traps:{<letter>:<text>}}. NULL = not authored. Wrong-option keys only; correct-option key is a validation error. Never shown to students before submission.';

-- examNo: 真题在当年卷面的题号（1..47）。NULL = 非真题/未标注。绝不回填自编题。
ALTER TABLE "Question" ADD COLUMN "examNo" INTEGER;
COMMENT ON COLUMN "Question"."examNo" IS
  'V14-P0: real-exam question number within the year paper (1..47). NULL = not a real-exam question. Read-side linkage to ExamQuestion(paperId, questionNo) by (year, examNo, isCurrent).';
```

### 4.2 兼容性与守约论证

| 守约项 | 论证 |
|---|---|
| D11（单条 additive nullable migration） | 2 列、均 nullable、均零默认值、零回填、零 NOT NULL、零枚举变更 |
| 「禁止重构 QuestionType」 | 未触碰 `QuestionType`；`questionSubtype` 枚举未扩展（D-3 决策为暂缓） |
| 「历史版本永不改写」 | 两列随版本链走：update 省略时由版本化承继（与 rubric 完全同模式，PHASE 8 先例） |
| 既有读写路径 | 两列皆可空，所有 `SELECT *`/ORM 读路径零感知；无默认值意味着无隐式语义注入（NULL≠空≠0，RULE-06 同构） |
| 回滚 | `ALTER TABLE "Question" DROP COLUMN "optionAnalyses"; DROP COLUMN "examNo";` —— 两列均为新增派生内容，零数据损失 |
| 幂等 | `migrate deploy` 重复执行安全（列存在性由 prisma 迁移账本保证） |

### 4.3 为什么陷阱用 JSONB 列而不是子表

- **先例**：`Question.rubric Json?`（F4）已确立「复杂内容形状 + shared parser 单一 shape 源 + 版本化承继」模式，陷阱完全同构。
- **规模**：每题 ≤3 条陷阱 × ≤200 字 ≈ ≤2KB，无行级查询需求（总是整题读写）。
- **避免的复杂度**：子表需要连带处理版本化（陷阱行随 questionId 版本复制）、级联删除、导入事务里的一致性——收益为零。
- 选项数组本体（`options String[]`）不动，陷阱键以字母对齐（§5），不复制选项文本，避免双源漂移。

---

## 5. `optionAnalyses` 数据形状与校验规则

### 5.1 形状（shared 单一 shape 源：`packages/shared/src/score-center/option-analyses.ts`，新增）

```jsonc
{
  "version": 1,
  "traps": {
    "B": "把『顺序表插入』笼统等同于『要搬动元素』：表尾插入只写 a[length]，一个元素都不用动。",
    "C": "删除不是移动：表尾删除只需 length--，没有任何元素需要前移。"
  }
}
```

### 5.2 解析与校验规则（`parseOptionAnalyses`，与 `parseRubricInput` 同签名风格）

| # | 规则 | 失败处置 |
|---|---|---|
| 1 | 缺席 / 空串 → `{ value: null }` | 未撰写 ≠ 非法（NULL≠0 同构） |
| 2 | JSON 不可解析 / 顶层非对象 / `version !== 1` → invalid + 原因 | 导入/API 整行硬拒（400 或行级 error） |
| 3 | `traps` 非对象 / 空 → invalid（有 `optionAnalyses` 却无内容视为撰写事故，不静默吞） | 硬拒 |
| 4 | 键必须 ∈ `A`..（按 `options.length` 截断，如 4 选项 → A–D）；**等于正确答案字母的键 → invalid** | 硬拒（正确选项不存在「陷阱」） |
| 5 | 值必须为非空字符串，1..500 字符（去首尾空格后） | 硬拒 |
| 6 | `version` 字段为将来形状演进预留；`version !== 1` 一律 invalid（不做静默升级） | 硬拒 |
| 7 | 仅 `type=SINGLE_CHOICE` 允许携带；综合题/判断题携带 → invalid | 硬拒 |
| 8 | 提供 ≥1 条即可；不要求覆盖全部错误选项（覆盖数进内容审计指标，不卡导入） | — |

### 5.3 与 CodeBrick 呈现形态的对应（数据契约，实现另行立项）

- 「你为什么会选 B」= `optionAnalyses.traps[学生所选字母]`；所选选项恰好正确（蒙对）→ 无该键，呈现层显示「蒙对了，看看解析」。
- 「其他选项为什么错」= `traps` 中除所选外的全部键。
- 全站选项作答分布（91%·1003 人）= 运行时聚合（PracticeRecord 按题按选项计数），**不属于内容**；样本 < 阈值时必须显式「样本不足」（RULE-06），阈值属呈现层立项时的 Owner 决策项。

---

## 6. 内容生产设计：CSV 模板与列规范

### 6.1 新模板 `kaoyan-408-content-starter/imports/real-exam-template.csv`

在既有 13 列（`stem, options, answer, analysis, knowledgePointIds, difficulty, type, source, year, expectedTimeSec, questionSubtype, maxScore, 判分标准`）基础上新增 6 列：

```
examNo, knowledgeNodeIds, 陷阱解析A, 陷阱解析B, 陷阱解析C, 陷阱解析D, 录入参考摘要
```

### 6.2 列规范（真题专用，全部继承既有约定）

| 列 | 必填 | 规范 |
|---|---|---|
| `examNo` | 真题必填 | 整数 1–47；选择题 1–40、综合题 41–47（结构校验见 §7.3）；自编题此列必须为空 |
| `knowledgeNodeIds` | 真题必填 | `PRIMARY\|SECONDARY...`，PRIMARY 在前；节点 id 必须存在于 `KnowledgeNode` 且 `isActive`（对 DB 实时校验，不硬编码）；写入 `QuestionKnowledgeNodeTag{role, taggedBy: HUMAN, confidence: 1.0, source: 'real-exam-import'}` |
| `陷阱解析A..D` | 选填 | 纯文本整列；**与正确答案字母相同的列必须为空**（硬拒）；只有选择题可填，综合题填了硬拒 |
| `录入参考摘要` | 脚手架专用 | 仅内容生产辅助（来自 exam-mapping `summary`），导入器**显式忽略并警告**（白名单忽略列，防静默入库） |
| `knowledgePointIds` | 必填 | 维持既有 16 点词汇（经典闭环消费方不变）；节点层不替代它（双层归因两个消费方都要喂） |
| `source` | 必填 | 真题格式 `2009-408-真题`（继承大题指南「真题必须有可核查出处」红线）；解析/陷阱为自写原创 |
| `maxScore` | 真题必填 | 选择题 2；综合题用当年官方分值（2022–2026 从 exam-mapping `score(verified)` 预填） |
| `questionSubtype` | 选择题必填 `SINGLE_CHOICE`；综合题按 D-3 决策 | 无合适码 → 留空 = NULL（unknown stays unknown，D6），不得硬塞 |

### 6.3 转义事故规避（吸取大题模板两次 CSV 转义失败的教训，current-sprint 2026-09-19）

- 陷阱文本**逐列独立**，绝不嵌套 JSON 进 CSV（rubric 的 `判分标准` 列仍需 JSON 转义，但那是既有列、已有模板样例）。
- 导入器在解析前增加**行列护栏自检**：每行字段数必须等于表头数（现有 `parseCsv` 已保证）；增加「陷阱列含换行符 → 警告」与「任何列含未配对引号 → 拒绝」的显式检查，把历史事故模式变成硬门。
- 模板样例行**全部占位 + 顶部注释行声明「不得直接导入」**（继承大题模板做法）。

### 6.4 内容质量红线（继承 + 新增）

继承大题指南 §7 全部红线，新增：

1. **题干、选项、官方答案必须与当年真题一致**；题干为纯文本自包含（图形题用文字完整描述结构，v1 不支持图片；`formulas` 列可存 LaTeX）。
2. **解析与陷阱为自写原创**，禁止逐字搬运任何第三方解析（王道/CodeBrick 等）；引用官方答案口径须在解析中注明。
3. 每道选择题至少 1 条陷阱解析；鼓励 3 条全覆盖（覆盖数进审计指标）。
4. 大题 rubric 质量五条照旧（totalPoints=Σ分值 硬卡、采分点可判定、与官方口径一致或标注自编）。
5. AI 可用于**草稿**（解析/陷阱/rubric 初稿），必须经具名教研按 `docs/review-checklist.md` 互审后方可导入；导入命令必须携带 `--reviewed-by "教研名"`（写入 QuestionImportBatch，RULE-10 追溯链）。

---

## 7. 导入器设计

### 7.1 决策：新脚本 `scripts/import-real-exams.mjs`，共享逻辑函数级复用

理由：`import-questions.mjs` 的去重键是 `(stem, source, year)` 且无 examNo/节点直标/结构校验；真题有独立的校验面（年度结构、陷阱-答案互斥、节点存在性）。两脚本共同依赖下沉到共享模块（`normalizeMaxScoreInput` 等已在 shared，不需要动；CSV 解析函数复制或抽 `scripts/lib/csv.mjs`，**不重构既有脚本**——避免触碰 starter-320 的已验证链路）。

### 7.2 写入事务（每文件单事务，幂等）

1. `QuestionImportBatch` upsert（source=`real-exam-authoring`，metadata 记录 `reviewedBy/importedAt/fileSha`）。
2. 逐题复用既有去重语义：`(stem, source, year)` 命中 current → 按版本化更新（familyId 承继、versionNumber+1、`optionAnalyses`/`examNo` 缺席时承继旧值——与 rubric 承继规则逐字一致）；未命中 → 新建 family。
3. 每题写 `QuestionKnowledgeNodeTag`（先 `deleteMany({ questionId })` 该题本批次来源行再 create，保证重跑幂等；**只删 `source='real-exam-import'` 的行**，绝不触碰桥接行或其他来源）。
4. **不写 ExamPaper/ExamQuestion**（线 B 归 seed-408-v2 管，职责分离）。

### 7.3 硬校验清单（全部整行/整文件硬拒，拒绝信息带行号）

继承既有：type/difficulty/knowledgePointIds 词汇、year 范围、expectedTimeSec≥30、subtype 字典、maxScore 非负、rubric 形状、选择题 options≥2、综合题 options/answer 可空。

新增：

1. `examNo` ∈ 1–47 且与 type 匹配（选择题 1–40，综合题 41–47）。
2. 同一年内 `examNo` 不重复（文件内查重；跨文件靠去重键兜底）。
3. 陷阱键 ≠ 正确答案字母；陷阱列只允许选择题。
4. `knowledgeNodeIds` 每个节点存在且 isActive；PRIMARY 恰好 1 个。
5. **年度结构交叉校验**（仅当某年 47 题在本文件中齐全时启用）：40 单选（examNo 1–40，maxScore 合计=80）+ 7 综合（41–47，合计=70），总分=150；与 exam-mapping（若该年存在）的 `score` 逐题比对，不一致 → 拒绝并输出差异表（**双侧互证**：内容侧分值 vs 已核验对标层分值）。
6. `--replace` 语义与既有脚本一致（版本化，不改写历史行）。

### 7.4 干跑报告（`--dry-run`）

```
Real exam import dry run: <file>
Per-year: 2026 { mcq: 40/40, essay: 7/7, priced: 47/47, nodeTagged: 47/47, trapCoverage: 41/40×3 }
Structure: 2026 COMPLETE, sum(mcq)=80, sum(essay)=70, total=150 ✓; exam-mapping cross-check 47/47 match
Would create: 47 questions, 0 version bumps, 141 node tags
```

### 7.5 脚手架生成器 `scripts/gen-real-exam-scaffold.mjs`（只读派生，独立小工具）

- 输入：`exam-mapping/408-YYYY-question-knowledge-map.json`（2022–2026 现成）。
- 输出：逐行预填 CSV —— `year/examNo/type/questionSubtype(选择题=SINGLE_CHOICE，综合题留空)/maxScore(score)/source/knowledgeNodeIds(primary|secondary)/录入参考摘要(summary)`，其余列留空待教研填写。
- 价值：2022–2026 共 235 行的分值/题号/映射零重复劳动，教研只填题干/选项/答案/解析/陷阱/rubric。
- 2009–2021：先补制 exam-mapping bundle（同一 JSON 格式、同一校验），再跑生成器——内容计划见 §12。

---

## 8. 与既有数据资产的衔接（明确不动的部分）

| 资产 | 处置 |
|---|---|
| `ExamPaper/ExamQuestion/ExamQuestionKnowledgeTag`（2022–2026 已入库） | **零改动**。seed-408-v2 继续作为线 B 唯一写方；真题导入不碰这张表 |
| `KnowledgeFrequencySnapshot`（考频快照） | 零改动（由线 B 派生） |
| 16 个粗粒度 KnowledgePoint + `KnowledgePointNodeMap` 桥接 | 零改动；真题同时挂两层（§6.2） |
| starter-320 自编题 | 零改动（`examNo` 为空 = 非真题，天然区隔） |
| `Paper`/`LearningSession` 整卷链路 | 零改动；真题套卷（§10.4）走既有 paper prepare/submit 通道，分值来自 maxScore（S1 量纲规则：exam_total 口径） |
| ScoreLoss / Mastery / Recommendation | 零语义变更（§9 论证） |

---

## 9. ScoreLoss coverage 点燃链路（语义零变更论证）

1. 真题选择题入库即带 `maxScore=2` → S1 价格优先级①（原生消费 `Question.maxScore`）直接生效：学生答错 → `ScoreLossItem` 行 `lostScore=2`，来源 **OBSERVED**（真实分值+真实判分）。
2. 真题大题入库带 `maxScore` + rubric → 整卷自评路径（既有：`earned=ratio×price`，PROXY 源）与 F4 离线评分路径（`authoritative:false`，PROXY）均照旧；**本设计不改变任何 PROXY/OBSERVED 判定**。
3. D8 coverage = 有效分值 × 有效失分证据双条件：真题进入练习后两条件同时满足 → `GET /coach/score-loss` 的 coverage 从「仅 320 自编题」扩展到真题全集。
4. 可验证断言（进 E2E，§11.3）：导入真题 → 学生答错一道 2 分选择题 → ScoreLoss 出现 `lostScore=2` 的 OBSERVED 行 → coverage>0。
5. 边界重申：本设计**不产生任何新的「提分」宣称**；Verified Score Gain 仍未实现（RULE-11 不变）。

---

## 10. 呈现层契约（只定契约，实现另行立项）

### 10.1 学生视图剥离（安全边界，必须在任何呈现之前实现）

- `toStudentQuestion`（`question-view.ts`）扩展：`optionAnalyses` 在学生预提交视图**无条件置空**（null），与 `answer`/`analysis` 同面。陷阱即「哪些选项错」的剧透，泄露=判题无效。
- 答题后的详情路径（已暴露 `analysis` 的那些端点）返回完整 `optionAnalyses`。
- 静态演示模式（GitHub Pages）下同样遵守剥离面（mock 工厂同步）。

### 10.2 作战板/按年练

- 数据需求全部就绪：`Question{year, examNo, questionSubtype, maxScore}` × `PracticeRecord`（当前用户）→ 网格状态（全对/答错/未做）。
- 首考/回归考点侧栏：线 B `ExamQuestionKnowledgeTag` + `KnowledgeFrequencySnapshot` 聚合（读侧投影）。

### 10.3 陷阱呈现（题目页答错后）

- §5.3 契约；呈现顺序对齐 CodeBrick 实测形态：作答分布 → 所选选项陷阱 → 自报错因（既有受控错因 A1 组件直接复用）→ 其他选项陷阱 → 主解析 → 延伸学习。

### 10.4 真题套卷与自由组卷

- 套卷 = `POST /exam/papers/prepare` 既有通道，选题条件 `year=X + examNo ASC + isCurrent`；卷面分 = ΣmaxScore（150 口径，量纲按 S1 规则为 exam_total，与 accuracy_rate 结构隔离）。
- 组卷/半套卷属推荐行为周边，纳入 Gate 15 范围一并裁决（benchmark 报告 P1-1.5）。

### 10.5 数据屏族

- 矩阵/考频/漏网清单读线 B（已就绪）；「我的正确率」叠加层读线 A 练习记录。全部只读投影。

---

## 11. TDD 与验证门禁设计

### 11.1 RED（先行失败确认）

1. `test/option-analyses.test.js`（shared 契约，~14 断言）：§5.2 全部规则逐条（含「正确选项带陷阱=拒」「综合题携带=拒」「缺席=null」「version≠1=拒」「500 字上限」）。
2. `test/real-exam-importer.test.js`：结构校验（examNo/type 匹配、年内重复、年度合计 150）、脚手架生成器确定性（同输入两次输出逐字节一致）、忽略列警告。

### 11.2 GREEN 后回归基线

`npm test` 现基线 2607/2605/0/2（current-sprint 2026-09-19），新增用例零回归；`build:shared`/`build:api`/`build:web` exit 0。

### 11.3 集成 E2E（新 `test:integration:real-exam-import`，真实 PostgreSQL + HTTP）

1. 迁移 40 在测试库 `migrate deploy`。
2. 跑脚手架生成器（2026）→ 教研填入** fixture 年份子集（40 单选 + 1 大题，内容明标 integration）** → `--dry-run` 结构校验过。
3. 正式导入（`--reviewed-by "integration-fixture"`）→ 断言：Question 行（year/examNo/maxScore/subtype/optionAnalyses/版本链）、`QuestionKnowledgeNodeTag`（HUMAN，141→子集数）、`QuestionImportBatch` 留痕、ExamPaper/ExamQuestion 行数**不变**（线 B 零污染）。
4. **拒绝路径**（RULE-03）：正确选项带陷阱 → 整行拒；综合题带陷阱列 → 拒；未知节点 id → 拒；无 `--reviewed-by` → 拒；学生视图 GET 题目 → `optionAnalyses` 缺席且 `answer` 为空；未授权写路径 401。
5. **ScoreLoss 点燃断言**：学生答错一道 fixture 真题 → `ScoreLossItem.lostScore=2`（OBSERVED）→ score-loss 端点 coverage>0 → 重跑导入幂等（账本行数不变）。
6. 清理段（吸取 6 套件泄漏教训，current-sport 2026-09-18）：FK 安全序 `runCleanup()` 显式前置调用，测试库恢复基线（323 题/322 家族/8 用户——fixture 另计）。

### 11.4 内容审计命令

`npm run audit:real-exam-content`（只读）：per-year `{total/mcq/essay/priced/subtyped/nodeTagged/trapCoverage/rubricReady}`、与 exam-mapping 分值差异表、trainable 大题计数、verdict（READY/NOT READY per year）。发布判定以此为准，不以其替代测试门禁。

---

## 12. 内容生产计划与工作量（**PROXY 估算**，RULE-05 标注）

> 以下全部为未标定的估计值，仅供排期参考，不构成承诺。

| 批次 | 范围 | 题量 | 脚手架 | 预估工作量 |
|---|---|---|---|---|
| R1 | 2026 年全卷（试点，走通全链） | 47 | 已有映射，直接生成 | 选择题 40×15min + 大题 7×40min ≈ **14h** |
| R2 | 2025–2022（4 年） | 188 | 已有映射 | ≈ **55h** |
| R3 | 2021–2015（7 年） | 329 | 需先补制 exam-mapping（约 2h/年） | 映射 14h + 内容 ≈ **100h** |
| R4 | 2014–2009（6 年） | 282 | 同上 | 映射 12h + 内容 ≈ **90h** |
| 合计 | 18 年 | ≈846 | — | ≈ **260h** 教研/录入工作量（不含评审） |

- 生产节奏建议：R1 试点验收（E2E + 首页/作战板最小呈现）后再放量；R2–R4 可按年并行外包/承包，模板与审计命令即质控工具。
- 每批次独立过 D10 式审计（回滚 = `--replace` 前的版本链仍在 + batch 记录可溯源）。

---

## 13. 版权与合规（Owner 决策区）

1. **既有先例**：exam-mapping 的 meta 明确「仅保存题号、分值、自写摘要与知识点映射，不保存完整真题题干」——题干全文入库是对该口径的**升级**，必须 Owner 明确批准（D-1）。
2. 建议口径（供 Owner 参考，非结论）：真题题干/选项/答案属公开考试材料，行业惯例可收录；**解析/陷阱/rubric 必须自写原创**并保留教研署名；来源仅记录年份与题号，不复制任何第三方出版物排版。
3. 大题指南 §7 红线全量继承：「不得把 AI 生成内容直接当真题导入」。
4. 生产部署：本设计落地后涉及生产迁移 40 + 内容导入 → DEPLOYMENT PENDING（RULE-13，Owner 人工，按 Runbook 模式补一节）。

---

## 14. Owner 决策点汇总（RULE-14）

| # | 决策 | 建议 | 阻塞什么 |
|---|---|---|---|
| D-1 | 真题题干全文入库的版权口径 | 批准「题面原文 + 自写解析」口径 | 全部内容生产 |
| D-2 | 迁移 40（`optionAnalyses` + `examNo` 两列 additive nullable） | 批准（本设计 §4） | 任何代码实施 |
| D-3 | `QuestionSubtype` 字典是否扩展（46/47 题等形态无码） | **暂缓扩码**：无合适码 → NULL（D6 诚实语义）；待 R1 落地后按真实分布再议（扩码=独立 Owner Gate + additive 枚举迁移） | 大题 subtype 完整度（不阻塞选择题） |
| D-4 | 陷阱存储形态（JSONB 列 vs 子表） | JSONB 列（§4.3） | D-2 的一部分 |
| D-5 | 陷阱解析的 AI 草稿 + 具名教研互审流程 | 批准（RULE-10 合规形态） | 内容放量 |
| D-6 | 作答分布（91%·1003人）的样本量阈值 | 呈现层立项时定（建议 ≥30 且显式「样本不足」） | 不阻塞本设计 |
| D-7 | ExamQuestion.questionId 外键（未来可选） | 暂不做（§3 线 C 论证） | 无 |

**STOP 条件**：以上任一未决 → 本设计停在 Design Gate，终态 `BLOCKED`（合法终态），不进入 TDD。

---

## 15. 分阶段实施路线（待 Owner 批准后执行）

```
Phase R0  设计批准（本文档 §14 决策点裁决）
Phase R1  迁移 40 + parseOptionAnalyses 契约测试（TDD RED→GREEN）
          + 导入器/脚手架生成器 + E2E harness（2026 子集 fixture）
Phase R2  内容试点：2026 全卷 47 题走完 作者→互审→导入→审计→E2E
          + 学生视图剥离 + 答错陷阱呈现最小实现（另一任务书）
Phase R3  批量内容 R2–R4（§12），每批审计 + 抽检
Phase R4  呈现层立项（作战板/套卷/数据屏/陷阱完整呈现）——独立设计文档
```

## 16. 开源参考检查（AGENTS.md 要求）

1. **CodeBrick（实测，2026-09-25）**：逐选项陷阱 + 「你为什么会选 B」按所选选项个性化呈现 + 全站作答分布，是学生价值密度最高的内容形态——本设计 §5.3 契约直接对齐该形态，但数据形状与校验按本仓库规则自研。
2. **IMS QTI**（ISO 教育测评互操作标准）：选择题支持 per-choice feedback（modalFeedback per option）——佐证「逐选项反馈作为一等内容」是成熟标准做法，而非 CodeBrick 独创。
3. **Moodle quiz 多选题**：每个选项可挂独立 answer feedback，导入格式（GIFT/Aiken CSV）验证了「CSV 逐列承载选项反馈」的可行性与转义痛点——本设计 §6.3 的逐列 + 硬护栏设计受其启发。
4. 未直接复制任何外部源码；形状设计沿用本仓库 rubric 先例（单一 shape 源 + 版本化承继 + 非法硬拒）。

---

*设计者：ZCode 只读会话 2026-09-25。全部事实核验基于当日仓库 HEAD `73c607a5`（feature/v3-product-refactor）。*
