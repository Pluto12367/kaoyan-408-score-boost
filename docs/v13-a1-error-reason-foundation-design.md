# V13-A1 Error Reason Foundation — Design（Read-only Design Check + Design 提案）

> **状态更新（2026-09-18 实施完成）**：任务书（V13-A1 Autonomous Implementation）下达后，本设计已按 §9 工作流完整实施并通过门禁——TDD RED→GREEN（9/9 契约测试）、`npm test` 2556/2554/0/2 零回归、`build:api` 0 错误、`test:integration:error-patterns`（真实 PG+HTTP）12 步 ALL PASS。实施细节见 §5（即最终实现语义）；门禁与 PRE-EXISTING 记录见 `docs/current-sprint.md` 顶部条目。零迁移、零语义漂移（MASTERY_SEMANTICS=legacy、recommendation priority 未触碰）。
> **上游裁决**：Owner Decision v1.0（2026-09-18）——接受 `docs/audit/v13-score-improvement-gap-analysis.md` 为事实基线；A1 = 第一实施阶段；§9 规定 Agent 工作流 = Read-only Design Check → TDD RED → GREEN → 真实 PG+HTTP E2E → 证据报告；§10 规定 A1 唯一前置 Owner Gate = 冻结 Taxonomy v1。
> **本文档性质**：完成 §9 的第一步（Read-only Design Check），给出 A1 设计提案与待冻结项。**未修改任何业务代码/schema/迁移。**
> **A1 范围（Owner Decision §7）**：Controlled Error Reason + Self Report + Backward Compatibility + Error Pattern Read Projection。**不解决**：题型 schema、大题、FSRS、Recommendation priority 重构、AI scoring、E1。

---

## 1. Read-only Design Check 结果（错因全触点，一手实测 2026-09-18）

| # | 触点 | 现状 | 证据 |
|---|---|---|---|
| 1 | 词汇表 | **受控 8 值已存在**：知识点没学过/概念混淆/公式记错/计算错误/审题错误/推理过程错误/时间不足/蒙题 | `packages/shared/src/domain.ts:12-21`（类型）；`packages/shared/src/learning.ts:22-31`（MISTAKE_REASONS） |
| 2 | 自动归因 | `classifyMistake` 只产出其中 6 值；**`公式记错`/`计算错误` 从不被自动赋值**；`概念混淆` 是兜底默认值（语义稀释实证） | `learning.ts:122-146`（:145 兜底） |
| 3 | 归一化机制 | **Legacy 映射器已存在**：概念不清/知识点混淆/审题问题/计算失误/速度偏慢 → 8 值；读路径已调用 | `learning.ts:44-56`；`apps/api/src/study/practice-record.repository.ts:258` |
| 4 | 存储 | `PracticeRecord.mistakeReason String?`（自由字符串，无 DB 枚举约束）；仅服务端自动写入 | `prisma/schema.prisma:612`；DTO 无 mistakeReason 入参（`create-practice-record.dto.ts:47-51` 仅 confidence/usedHint） |
| 5 | 自报通道 | 前端 `ErrorReasonSelector` 已是**受控单选**（8 值 + 已完成复盘）→ `POST /wrong-questions/:questionId/reason`；但**后端接受任意 ≤100 字符字符串**，受控只在客户端 | `apps/web/src/components/ErrorReasonSelector.tsx:16-26,44-50`；`apps/api/src/study/study.service.ts:2294-2295`；路由 `study.controller.ts:581` |
| 6 | 自报存储 | `ReviewSchedule.selfReportedReason`（每题一槽，覆盖写）+ `ReviewAttempt.reportedReason`（逐次保留）+ `inferredReason`（自报+启发拼接，`inferReviewReason`） | `prisma/schema.prisma:758,785,787`；`study.service.ts:5347-5357` |
| 7 | 聚合现状 | `buildMistakeReasonStats` 已按错因计数（含 `待归因` 桶），**但无时间窗、无知识节点连接、无趋势、无重复检测** | `apps/api/src/study/wrong-question.snapshot.ts:238,344`；快照契约 :179 |
| 8 | 节点归因 | `resolvePrimaryNodeByQuestion` 已存在（score-loss / practice-patterns 复用，单 PRIMARY 归因不变量 INV-16 先例） | `apps/api/src/study/question-node-resolution.ts:42` |
| 9 | 展示面 | 错因建议文案 `MISTAKE_SUGGESTIONS` 8 值全覆盖 | `learning.ts:33-42` |
| 10 | 时间窗先例 | outcome-tracking（14 天窗、<3 次=insufficient_data）、review-shadow（1d/7d/14d 窗、<30=insufficient_data）— A1 投影沿用同款诚实语义 | `packages/shared/src/score-center/outcome-tracking.ts:10,132`；`review-shadow.ts`（daily-brief.controller.ts:162 端点） |

**Design Check 修正结论**（相对 Gap Analysis §4/§12-G-B 的表述，须如实收窄）：A1 的真实增量不是"从零建受控词表"，而是四件事——
① **服务端受控化**（堵住任意字符串入口，#5）；
② **词汇表 8→14 扩展**（Owner 14 码中 8 个无现有中文值：method_error/careless_error/missing_step/boundary_condition/answer_structure/forgetting/large_question_scoring_loss，且现有 `蒙题` 不在 Owner 清单内——见 §2 待决项）；
③ **节点×错因×时间窗×趋势聚合投影**（#7 缺的四个维度，A1 核心交付）；
④ **重复出现检测**（node×reason 窗口内重复计数）。

---

## 2. Error Reason Taxonomy v1 提案（待 Owner 冻结）

### 2.1 14 码与现状映射（canonical = Owner 英文码；显示标签沿用中文）

| Owner 码（冻结候选） | 中文标签（提案） | 现有来源 | A1 变化 |
|---|---|---|---|
| knowledge_gap | 知识点没学过 | 自动（classifyMistake:139）+ 自报 | 无（码映射） |
| concept_confusion | 概念混淆 | 自动（:141,145 兜底）+ 自报 | 无 |
| formula_gap | 公式记错 | 仅自报（ErrorReasonSelector:20） | 无 |
| calculation_error | 计算错误 | 仅自报（:21） | 无 |
| **method_error** | 方法错误 | **无** | **新增值**（仅自报） |
| reasoning_error | 推理过程错误 | 自动（:142 usedHint 触发）+ 自报 | 无 |
| reading_error | 审题错误 | 自动（:137 过快启发）+ 自报 | 无 |
| **careless_error** | 粗心错误 | **无** | **新增值**（仅自报） |
| time_insufficient | 时间不足 | 自动（:135 未作答）+ 自报 | 无 |
| **missing_step** | 步骤缺失 | **无**（rubric criteria 有形状） | **新增值**（自报；大题侧后续接入） |
| **boundary_condition** | 边界条件遗漏 | **无** | **新增值**（仅自报） |
| **answer_structure** | 不会组织答案 | **无** | **新增值**（自报；大题侧后续接入） |
| **forgetting** | 遗忘 | **无**（review 语义） | **新增值**（复习重错场景自报） |
| **large_question_scoring_loss** | 大题采分点失分 | **无**（rubric lossKind 有形状） | **新增值**（A1 仅定义码；数据源属 P0-3） |
| （待决）蒙题 | 蒙题 | 自动（**答对**+完全不会，:135——非"错误原因"） | Owner 决定：保留为第 15 码 / 并入 knowledge_gap / 废弃 |

### 2.2 Owner 冻结项（STOP——未冻结不得进入 TDD RED）

```text
STOP CONDITION
Evidence: Owner Decision v1.0 §10 要求冻结 Taxonomy v1；上表 2 处语义待决
          （蒙题归属；单选/多标签）。§8 成功定义示例（8+7+5+3+1=24）隐含
          互斥单选，但决策文本未明示。
Risk: 语义一旦写库即不可逆聚合口径漂移；先编码后冻结将造成历史数据
      与冻结版词表不一致（违反"此语义一旦冻结，后续数据分析才能保持一致"）。
Decision Required:
  D1 确认 14 码清单及中文标签（含 蒙题 去留）；
  D2 单选 / 多选 / 多选组合（本设计建议：主标签互斥单选 + 不做多标签，
     理由=§8 示例算术、聚合口径唯一、与现有 UI 单选一致）；
  D3 确认新增 8 码中 6 个"仅自报"码不参与自动归因（自动归因仍限现有
     6 值启发，避免伪造语义——RULE-02/06）。
```

**多标签建议的依据**：Owner §8 成功定义的计数（8+7+5+3+1=24）只有互斥单选才能成立；现有 UI 为单选（ErrorReasonSelector:16-26 radio 语义）；单标签使"node×reason 计数"分母唯一。若 Owner 选择多标签，投影需改为"标签次计"（count of tags ≠ count of errors），§8 示例口径需相应修订。

---

## 3. A1 设计提案（冻结后生效）

### 3.1 数据流与写入面（**零迁移方案**）

```text
自动归因（不变）:  buildPracticeRecord → classifyMistake（6 值启发）
                    → PracticeRecord.mistakeReason（中文值，schema:612）
自报（服务端收口）: POST /wrong-questions/:questionId/reason
                    → 校验 selfReportedReason ∈ 受控词表（服务端，替代现任意字符串）
                    → 写 ReviewSchedule.selfReportedReason / ReviewAttempt.reportedReason（现表现列，零 schema 变更）
读侧归一:          normalizeMistakeReason 扩展（8→15 值 + Legacy 图扩容），
                    中文值 ↔ 英文码在 shared 层双向映射（CODE map）
投影（新增）:      PracticeRecord(自动标签) ∪ ReviewAttempt.reportedReason(自报)
                    × resolvePrimaryNodeByQuestion（单 PRIMARY 归因）
                    → GET /coach/error-patterns 只读投影
```

- **不新增列、不改枚举列、不加 flag**（符合 Owner Decision §6 Additive/Single-SoT 原则与 §9 禁令）。理由：现有列即自由字符串，受控性由 shared 词表 + 服务端校验 + 读侧归一化保证；若未来引入 AI 确认标签（reasonSource 权威分层）再单独立 Gate 加列（Design Check 已预留该演进位）。
- `概念混淆` 兜底语义：**A1 不改 classifyMistake 启发**（改启发=改变被测行为，需单独 Gate）；兜底产生的归因在投影中按 `source=auto` 呈现，与自报区分。

### 3.2 Error Pattern Read Projection（A1 核心交付）

- 端点：`GET /coach/error-patterns?days=7`（默认 7，上限 90；挂 DailyBriefController coach 家族先例，daily-brief.controller.ts:39）。
- 形状（对齐 Owner §8 成功定义）：

```text
{ window: { days, from, to },
  totals: { wrongCount, attributedCount, unattributedCount },   // 未归因计数≠0 清零（RULE-06）
  byReason: [ { code, label, count, share, source: auto|self_reported|mixed } ],
  byNode:   [ { nodeId, nodeName, wrongCount,
                topReasons: [ { code, count } ],                // ≤3
                repeated: bool,                                  // 窗口内同 node 同 code ≥2 次错
                prevWindowWrongCount | null } ],                 // 前窗无数据→null（不造 0）
  trend:  'up' | 'down' | 'flat' | 'no_data' }                   // 双窗均有数据才判定
```

- 不变量（将被测试钉死）：① 未归因是显式桶，绝不分摊/清零；② 节点归因只走 `resolvePrimaryNodeByQuestion` 单 PRIMARY（INV-16 同源）；③ 样本/窗口不足输出 `no_data`/null（RULE-05/06）；④ self-only（resolveUserId/assertAccess 先例）+ 全查询 take 有界；⑤ 只读——零写原语；⑥ 排序稳定（count desc, code asc）。
- 明确不做（Owner §8）：错误→分数因果（属 E1/后续实验）。

### 3.3 兼容性与回滚

- 旧数据：5 个 legacy 中文标签经既有 LEGACY_MISTAKE_REASON_MAP（learning.ts:44）归一；自由文本/无法映射值进 `unattributed`，可观测不清零。
- 回滚 = 移除新端点与自报校验（均为增量面），无数据迁移可回滚。

### 3.4 测试与 E2E 计划（冻结后执行）

- **RED 清单**：词表契约（15 值双向映射、legacy 图不丢条目）；自报服务端拒绝非法值 400（含超长、空白、非受控值）；投影 6 不变量各一；`蒙题`（若保留）仅统计不进 wrongCount 分母的口径测试。
- **真实 PG + HTTP E2E**（RULE-03，沿用 integration-*-*.mjs 模式）：种子节点+题目 → 混合自动/自报错误提交 → 断言 byReason/byNode/trend 精确计数 → **拒绝路径**：未认证 401、跨学生隔离 403、非法错因 400、非法 days 400 → 夹具清理。
- 门禁：`npm test` 全量零回归 + `build:api` + `test:integration:postgres` 相关套件；若沙箱环境阻塞按 RULE-04 标记 SUBSTITUTE GATE 并列丢失维度。

### 3.5 工作量边界

新增/改动预计：shared 词表与映射（1 文件）、自报校验（service+dto，≤30 行）、投影 selector+service+controller（3 文件，纯只读）、测试 2-3 文件、E2E 脚本 1 个。**零迁移、零前端必需改动**（ErrorReasonSelector 选项随词表自动扩展，选项 hint 复用 MISTAKE_SUGGESTIONS 模式）。

---

## 4. 执行顺序（Owner Decision §9 → 冻结后）

```text
[本轮已完成] Read-only Design Check + 本设计文档
→ [Owner] 冻结 Taxonomy v1（D1/D2/D3，§2.2 STOP）
→ TDD RED（词表契约 + 投影不变量 + 拒绝路径先红）
→ 最小 GREEN
→ 真实 PG+HTTP E2E + 全量回归
→ 证据报告（门禁逐项 PASS/FAIL 如实标记）+ current-sprint 更新
```

---

## 5. A1 实施设计（Owner Decision 落地版，2026-09-18）

> 前置说明：本节回答任务书 §4 Design Gate Q1-Q5，并把 §10 的 Taxonomy 冻结以"Owner 任务书 §5 授权 + 本设计逐码评估"方式落地。任务书 §5 提供 14 候选码并要求逐项评估而非机械接受——评估结论见 5.2。

### 5.1 Design Gate 回答

- **Q1 可复用字段**：存在。`PracticeRecord.mistakeReason String?`（schema:612）、`ReviewSchedule.selfReportedReason/note`（schema:758-759）、`ReviewAttempt.reportedReason`（schema:785）均为字符串列，可承载受控值，零迁移。
- **Q2 能否不新增 schema**：能（本实现采用零迁移）。受控性由 shared 词表 + 服务端校验 + 读侧归一化保证；若未来引入 reasonSource 权威分层（AI 确认标签）再单独立 Gate。
- **Q3 三者职责**：`classifyMistake`=shared 纯自动分类器（写 PracticeRecord.mistakeReason 前调用）；`mistakeReason`=逐次作答的自动归因存储（PracticeRecord）；`inferReviewReason`=复习时自报+启发拼接的可读信号串（ReviewSchedule.inferredReason，仅展示/审计，非逐次权威证据，A1 不改动）。
- **Q4 旧数据兼容**：三层归一化（英文码 ↔ 中文规范 8 值 ↔ legacy 5 值）在投影读侧完成；无法映射的自由文本 → `unclassified` 显式未知桶，计数保留不清零。**legacy 自报接口行为逐字保留**（integration-postgres.mjs:551 断言自由文本 'concept unclear' 原样保留，必须不破坏）。
- **Q5 SoT or Projection**：**Projection**。权威错误事实仍 = PracticeRecord.mistakeReason（自动）+ ReviewAttempt.reportedReason（自报）；ErrorPattern 为纯派生只读投影，零写入，无新表。

### 5.2 Taxonomy v1 冻结（16 值 = Owner 14 码 + guessing + unclassified）

| code（canonical，API 输出） | 存储标签（中文，学生可读） | 自动可推断 | 自报可确认 | 评估依据 |
|---|---|---|---|---|
| knowledge_gap | 知识点没学过 | ✔（confidence=完全不会） | ✔ | learning.ts:139 既有 |
| concept_confusion | 概念混淆 | ✔（仅 slow 启发） | ✔ | **解除兜底**（6.2） |
| formula_gap | 公式记错 | ✘ | ✔ | 无自动信号，仅自报 |
| calculation_error | 计算错误 | ✘ | ✔ | 无自动信号，仅自报 |
| method_error | 方法错误 | ✘ | ✔ | 新增，仅自报 |
| reasoning_error | 推理过程错误 | ✔（usedHint） | ✔ | learning.ts:142 既有 |
| reading_error | 审题错误 | ✔（过快启发） | ✔ | learning.ts:137 既有 |
| careless_error | 粗心错误 | ✘ | ✔ | 新增，仅自报（快+错+高信心可作未来候选，不在 A1 自动化） |
| time_insufficient | 时间不足 | ✔（未作答） | ✔ | learning.ts:135 既有 |
| missing_step | 步骤缺失 | ✘ | ✔ | 新增，仅自报（大题 rubric 侧后续接入） |
| boundary_condition | 边界条件遗漏 | ✘ | ✔ | 新增，仅自报 |
| answer_structure | 不会组织答案 | ✘ | ✔ | 新增，仅自报 |
| forgetting | 遗忘 | ✘ | ✔ | 新增，仅自报（复习重错场景；自动推断属 P1-7 FSRS 域，A1 不做） |
| large_question_scoring_loss | 大题采分点失分 | ✘ | ✔ | 新增，仅定义码；数据源属 P0-3 |
| guessing（蒙题） | 蒙题 | ✔（**答对**+完全不会） | ✘ | 保留兼容；非错误原因，错误投影天然不含 |
| unclassified | 待归因 | —（显式未知态） | ✘（不可提交） | §6 要求：UNKNOWN ≠ CONCEPT_CONFUSION |

- 存储规范值 = 中文标签（与全部存量数据一致，`WrongQuestionDetail.tsx:223` 直显 selfReportedReason 保持可读）；API/投影规范值 = 英文码。`controlledReason` 入参接受英文码或中文标签（二者一一映射，无歧义）。
- **自动归因集合不变**（仍限上表 ✔ 自动列）；新增 8 码全部"仅自报"，AI 候选标签机制不在 A1（避免伪造确定性，§5/§12）。

### 5.3 classifyMistake 兜底解除（任务书 §6）

- 变更：`learning.ts:145` 兜底 `return '概念混淆'` → `return null`（显式未知）。slow→概念混淆 分支（:141）有可观察信号（用时 ≥145% 预期），保留。
- 下游已兼容 null：`wrong-question.snapshot.ts:344` 渲染 '待归因'；投影把 null 计入 `unclassified`。
- **有理由的既有断言更新（RULE-02 单列）**：`test/appLogic.test.js:245-246`（normal speed → 期望 '概念混淆'）改为期望 `null`。`appLogic.test.js:144` 为 slow 分支不受影响。

### 5.4 自报接口改造（任务书 §7）

- `POST /wrong-questions/:questionId/reason` 新增可选 `controlledReason`（受控枚举）与 `optionalNote`（≤100）；`controlledReason` 提供时校验 ∈ 词表（否则 400），存其中文规范标签；`optionalNote` 写 `ReviewSchedule.note`（既有列）。
- **legacy `selfReportedReason` 路径逐字保留**（任意 1..100 字符串原样存储）——既有 E2E（integration-postgres.mjs:551 等）与前端 ErrorReasonSelector 无感。

### 5.5 ErrorPattern 投影（任务书 §8/§9）

- 端点：`GET /coach/error-patterns?days=7&viewUserId=`（days 默认 7，夹取 1..90；挂 daily-brief.controller coach 家族，resolveUserId 数据隔离，@Optional 无库诚实降级 `store_unavailable`）。
- 证据源（OBSERVED，仅此两处，绝不触 mastery/score）：① 错误 PracticeRecord（source=auto，标签经三层归一化）；② `redoCorrect=false` 的 ReviewAttempt（source=self_reported）。正确重做不计入错误。
- 行键 = (subject, nodeId, reasonCode)（subject/node 取自 `resolvePrimaryNodeByQuestion` + KnowledgeNode 行）；行值 = count（窗内）/ recentCount（窗内较近半区）/ trend（两半区均有数据才比较，否则 `no_data`——不为趋势造 PROXY）/ repeated（count≥2）/ lastOccurredAt / questionType（低成本附列，来自同批 question 查询）。
- totals：wrongCount = 窗内错误证据总数（OBSERVED count = eligible evidence count，不变量）；attributedCount（有节点归因）/ unattributedCount（无节点）；unclassified 计数在 byReason/totals 中显式呈现，绝不并入 concept_confusion。
- 有界：practice take ≤500、review take ≤200、节点/题目批量 findMany 按 distinct id。

### 5.6 不做（A1 边界重申）

Recommendation priority 不接 ErrorReason（§10，属 A2/A3）；AI 候选标签不做；前端不改（ErrorReasonSelector 走 legacy 路径继续工作）；schema 零迁移；MASTERY_SEMANTICS/FSRS/大题评分/Transfer Probe 全部不触碰。
