# V13-P0-1 Question Scoring & Question Type Foundation — Read-only Design Gate

> **状态更新（2026-09-18）**：Owner 已对 D1-D12 作出正式裁决（见 §24 Owner Decision v1.1），12 项全部冻结。本文档 §21 的建议值被裁决取代处以 §24 为准。实施（migration/内容链/映射）待 Owner 下达实施任务书后启动。
> **性质**：Read-only Design Check + 设计文档（2026-09-18）。**零代码/schema/migration/数据/前端/API 变更，零 Git 写操作**（边界记录见 §0）。
> **证据标注**：`file:line` = 本轮一手读取；`DB observed (test)` = 本机测试实例（kaoyan408-test-postgres-1）只读 SQL 实测；`static observed` = 内容库/脚本静态调查；生产库数据 = UNAVAILABLE（本沙箱无生产访问）。
> **上游依据**：`docs/audit/v13-score-improvement-gap-analysis.md`（G-A 断点）、Owner Decision v1.0 P0-1、`docs/audit/v13-p0-closed-loop-roadmap.md` R0.2/D2。本阶段不重做 Gap Analysis。

---

## 0. Git / 工作区边界（任务书 §5）

- branch `feature/v3-product-refactor`，HEAD `18b1aa66`（V13-A1 提交）。
- 工作区 modified/untracked 均为前序阶段或他属在途文件（.gitignore、project_understanding.md、docs/audit/* 等），本阶段**零触碰**。
- 本阶段新增文件仅本文档；**代码 0 changes / schema 0 / migration 0 / data 0 / Git 0 writes**。

---

## 1. Executive Summary

- `QuestionType` 当前是**「形式标签 + 评分通道」双语义混合体**：DB 枚举 3 值，但运行时评分与前端分支锚定在**中文字符串** `'综合题'`（study.service.ts:3409、ExamSession.tsx:62）——`'综合题'` ⇒ 主观自评（selfScore/maxScore ≥60% 及格），其余全部客观精确匹配。它**不携带任何 408 考试题型语义**（无法区分算法设计/CO 计算/OS PV/CN）。
- `Question.maxScore` 的真相是 **NULL（未定价），不是数值 0**（schema:419-422 nullable 无默认；`DB observed (test)` 7/7 NULL；migration 注释明令"backfill = fabrication"）。账本所称"maxScore 标注=0"指**定价题数=0**，不是字段值 0。根因 = 内容链（CSV 无该列）+ CRUD/导入链（代码零处写入 maxScore）+ 题库内无大题内容（内容库 COMPREHENSIVE=0）。
- 零迁移可完成：**maxScore 定价**（纯内容/数据回填）；**必须 schema change**：可靠的 `questionSubtype`（派生规则无法区分四类大题，证据 §6）。
- 推荐提案（**非批准架构**）：additive nullable `Question.questionSubtype` + 内容侧 maxScore 定价 + 既有 rubric/maxScore/selfScore 语义分层（§20）。12 项 Owner Gate 决策列于 §21。

---

## 2. Current Question Model（Question Data Model Map）

`prisma/schema.prisma`：

| 字段 | 定义 | 证据 | 语义（实测） |
|---|---|---|---|
| `type` | `QuestionType` enum：`SINGLE_CHOICE / COMPREHENSIVE / JUDGEMENT` | schema:41-45, 410 | 形式标签 + 评分通道（§3/§4） |
| `maxScore` | `Float?`，**nullable、无默认**；注释 INV-10：null=未定价≠0 | schema:419-422 | 内容侧单题分值（价格优先级 ①，score-loss.service.ts:100-112） |
| `rubric` | `Json?`（rubric-v1：version/totalPoints/criteria[]） | schema:416-418；large-question-rubric.ts:37-53 | 大题采分点评分标准（离线关键词评分，需人审） |
| `difficulty` | `BASIC/MEDIUM/HARD` | schema:35-39, 409 | 静态难度 |
| `source/year` | 来源与年份 | schema:411-412 | 内容溯源 |
| `options/answer` | 选项与标准答案 | schema:406-407 | 客观精确匹配基准 |
| 知识点 | `QuestionKnowledgePoint` M:N + `QuestionKnowledgeNodeTag` + `KnowledgePointNodeMap` 桥 | schema:594-601, 993-1008, 978-991 | 科目/知识点经 KnowledgePoint.subject 与 KnowledgeNode.subject |
| —— | **无任何 subtype 字段** | grep `questionSubtype` 全库零命中 | 题型维度 MISSING 的数据层实锤 |

**分值概念全景（防止混淆）**：

| 概念 | 位置 | 语义 | 证据 |
|---|---|---|---|
| `Question.maxScore` | 内容表 | 内容定价（题目该值多少分） | schema:419-422 |
| `PracticeRecord.maxScore` | 作答表 | **该次作答的分值快照**（提交时客户端为综合题提供；score-loss 价格优先级 ②） | schema:618；score-loss.service.ts:100-112 |
| `PracticeRecord.selfScore` | 作答表 | 主观自评得分（`gradingMode='self_assessed'`） | schema:617；study.service.ts:3410-3415 |
| `rubric.totalPoints` | rubric JSON | 采分点总分（评分标准维度） | large-question-rubric.ts:39-41 |
| `ScoreLossItem.maxScore/earnedScore/lostScore` | 派生投影 | 逐题失分账目（null≠0，INV-10） | schema:1214-1218 |
| `rubricEarnedScore` | score-loss fact | rubric 评分得分 ⇒ **OBSERVED**（对比 selfScore ⇒ PROXY） | score-loss.ts:128-129 |
| `ExamQuestion.score` | 真题表 | 真实 408 卷面该题分值（**第四个分值概念**，仅真题对标维度） | schema:927 |

---

## 3. QuestionType Consumer Map（任务书 §7）

| 消费者 | 判据字段 | 实际行为 | 证据 |
|---|---|---|---|
| 评分（单题/会话/整卷共用 buildPracticeRecord） | **`question.type === '综合题'`（中文字符串）** | 综合题 ⇒ 主观自评（必须带 selfScore/maxScore，≥60% correct，gradingMode='self_assessed'）；其余（含 JUDGEMENT）⇒ 客观 exact-match | study.service.ts:3409-3415, 3439 |
| 前端作答 UI | `question.type === '综合题'` | 自评面板/选项快捷键屏蔽/主观题列表分支 | ExamSession.tsx:62,114,148,392,555 |
| 枚举↔中文转换层 | enum 与中文互转 | questions.service.ts:373-380、import-validation.ts:277-280、import-candidate.service.ts:340-346、practice-record.repository.ts:245-247 | DB 存枚举，运行时对象存中文 |
| 导入 worker 自动定型 | `options.length ? SINGLE_CHOICE : COMPREHENSIVE` | **有选项=单选、无选项=综合**——type 由表单形态推导 | import-worker.service.ts:360 |
| 大题 rubric 服务 | `type==='COMPREHENSIVE'` + rubric | COMPREHENSIVE 且无 rubric ⇒ 质量阻断（探针内容 NOT READY） | probe-content.ts:204,326 |
| ExamDiagnosis | **不读 type** | 每科一律按"题数×2 分"客观口径估算，主观自评仅进汇总行 | exam-diagnosis.ts:9-19,154-163 |
| ScoreLoss | **不读 type** | 价格取 Question.maxScore → record.maxScore → null；OBSERVED/PROXY 由评分方式（exact/rubric vs self）决定 | score-loss.service.ts:100-112；score-loss.ts:128-129 |
| Recommendation priority | 不读 type | priority.ts 六分量无题型项 | priority.ts:45-87 |
| ErrorPattern（A1） | `question.type` 透传 | 仅作为附列 questionTypes（DB 行=枚举值；内存题=中文——**两种表示并存**） | error-pattern.service.ts:99,116-118 |
| 模考整卷汇总 | **`type === '综合题'`（中文字符串）** | objective/subjective 题目与成绩拆分 | study.service.ts:4972-4975 |
| 练习选题 | `item.type === '综合题' || difficulty === '困难'` | 快速会话排除综合题与困难题 | study.service.ts:2682 |
| 测试/夹具 | 枚举→中文映射 | paper 夹具按枚举写中文标签（'综合题'/'单选题'） | integration-score-loss.mjs:185 |

**Q1 结论**：`QuestionType` 3 值的原因 = 它由**表单形态**（有无 options）决定（import-worker.service.ts:360），承担的是**形式标签（展示/UI）+ 评分通道（自评 vs 精确匹配）**双语义；`JUDGEMENT` 除标签外无任何独立评分行为（同走 exact-match）。它**不是**考试题型维度（408 的"单选 40×2 / 大题 70 分分类"在系统中不存在）。**是 UI 分类与评分方式的混合，不是业务题型维度。**

---

## 4. Real Question Data Distribution

| 数据源 | 观测 | 证据 |
|---|---|---|
| 内容库 `starter-320-questions.csv`（static observed） | 320 行，type 列 **100% 选择题**；**COMPREHENSIVE=0、JUDGEMENT=0；无 maxScore 列** | 本轮字节级解析实测（320/320 同一类型值）；CSV header：`stem,options,answer,analysis,knowledgePointIds,difficulty,type,source,year,expectedTimeSec` |
| 测试实例 DB（`DB observed (test)`，只读 SQL） | Question 总数 7（集成夹具残留）；**priced=0，unpriced=7，maxScore=0 值的行=0（全 NULL）**，rubric 非空=0；SINGLE_CHOICE×6 + COMPREHENSIVE×1（夹具），无 JUDGEMENT 行 | 本轮 psql 实测 |
| 生产库 | **UNAVAILABLE**（无生产访问）；账本侧一致性证据：ScoreLoss coverage=0（ledger），与"定价题数=0"自洽 | ledger current-sprint |

**COMPREHENSIVE 里混了什么**：static observed + 代码证据——内容库 COMPREHENSIVE=0，不存在"混合内容"可查；测试/夹具中的 COMPREHENSIVE 均为**自评主观题**（score-loss E2E 的 selfScore 4/10、9/10 场景，integration-score-loss.mjs:172-177）。因此"COMPREHENSIVE=综合选择题"不成立——当前它实际语义是 **"主观自评题"**，与 408 的"综合应用题/大题"不是同一概念。

---

## 5. MaxScore Root Cause（任务书 §9）

| 情况 | 判定 | 证据 |
|---|---|---|
| A 字段存在但内容未填 | **成立** | CSV 无该列（§4）；schema 可空 |
| B 默认 0 导致全 0 | **不成立** | schema:422 `Float?` 无默认；`DB observed (test)` 全 NULL 无 0 值行 |
| C 导入链无映射 | **成立** | grep `maxScore` 于 `apps/api/src/questions/`、`scripts/import-questions.mjs`、`generate-starter-320-questions.mjs`、`seed-408-v2.mjs` **零命中** |
| D 大题内容未进入 | **成立** | 内容库 COMPREHENSIVE=0（§4）——大题内容根本不存在，遑论定价 |
| E 其他字段承担该语义 | **部分** | `record.maxScore`（作答级快照价格，优先级②）与 `ExamQuestion.score`（真题卷面分）各自独立存在，但都不替代内容定价①；三层并存正是混淆源（§2 表） |
| F 代码默认 vs 实际数据 | **已区分** | 两者一致：均为 NULL。账本"maxScore=0"=定价题数 0，**不是**字段值 0（INV-10 明令 null≠0） |

**根因结论**：maxScore 为"0"（定价题数=0）= **A+C+D 叠加**——内容生产链（CSV 模板、导入映射、CRUD DTO）自始不携带分值，且题库中不存在任何大题。这不是数据事故，是**内容建模缺口**：修复主体是内容生产与导入映射，不是数据库修复。

---

## 6. 408 Question Type Mapping（任务书 §14）

| 408 题型 | 当前 type | 数据可识别？ | maxScore 来源 | 需要 subtype？ | 需要 rubric？ | 进 ScoreLoss？ |
|---|---|---|---|---|---|---|
| 单选题（40×2） | SINGLE_CHOICE | ✔（枚举） | 内容定价（①）+ 作答快照（②） | 否（type 已表达） | 否 | 是：OBSERVED（错答×定价；score-loss.ts:120） |
| 判断题（非 408 真实题型，408 客观全为单选） | JUDGEMENT | ✔ 枚举，但**评分上与单选无差别**（exact-match，study.service.ts:3413-3415） | 同上 | 否（可保留为形式标签） | 否 | 同单选 |
| 综合选择题（多选/不定项——408 不考，但内容库未来可能进） | 无（现 enum 无 MULTI_CHOICE） | ✘ | 同上 | 若要支持需 type 扩展或 subtype | 否 | 同单选 |
| 算法大题（DS，~13 分） | COMPREHENSIVE（若录入） | **✘ 无法与"CO 计算"区分**——两者同为 COMPREHENSIVE；无 subtype/rubric 差异字段可推断内容类别 | rubric.totalPoints / 内容定价 / 自评 | **是** | 是（采分点） | 是：rubric 评分 ⇒ OBSERVED（rubricEarnedScore，score-loss.ts:128）；仅自评 ⇒ PROXY |
| 组成原理计算题（~10 分） | 同上 | ✘ 同上 | 同上 | **是** | 是 | 同上 |
| OS PV / 综合题（~7 分） | 同上 | ✘ 同上 | 同上 | **是** | 是 | 同上 |
| CN 路由/计算（~9 分） | 同上 | ✘ 同上 | 同上 | **是** | 是 | 同上 |

> 408 真实卷面结构（客观 40 单选×2=80 + 综合 7 题≈70 分）在系统中的唯一体现 = `STANDARD_OBJECTIVE_MAX=80`（exam-diagnosis.ts:19）的估算常数；逐题分值与大题分类均不存在（DB observed + static observed）。

---

## 7. Type vs Subtype vs Ability Semantics（任务书 §13）

| 维度 | 承担语义 | 载体 | 不承担 |
|---|---|---|---|
| **QuestionType** | 答题形式 + 评分通道（客观精确匹配 / 主观自评） | 现有 enum（保持） | 训练形态、考试题型、能力 |
| **QuestionSubtype**（提案，未批准） | **内容/训练形态**：算法设计、组成计算、OS PV、CN 路由计算、综合单选、普通单选…… | Question 上的 additive 属性 | 能力水平、学生状态 |
| **Ability / 微技能** | 学生在某技能上的估计（PV 建模、信号量设计、死锁分析） | **KnowledgeNode 即微技能载体**（1296 节点粒度，账本）+ 未来 Projection | 不新增 SoT、不塞进 subtype |
| **知识点** | 内容归属与掌握度 SoT（UserKnowledgeMastery） | 现状不变 | — |

判定依据：`OS PV` 既是节点（KnowledgeNode 树已有 PV 类节点，账本生产走查）也是大题类别（OS 综合题）——**同一名词分属两个维度**：题目"考 PV 的大题" = subtype=OS 综合题 + node=PV 节点；学生"PV 掌握度" = mastery@node。三者正交，subtype 只回答"这是哪类题"。

---

## 8. Candidate Domain Models（任务书 §10/§11，三方案事实对照）

**Option A：零 schema change（派生 subtype）**
- 做法：由 subject + KnowledgeNode 名/rubric 存在性 + 内容关键词派生 subtype。
- 事实约束：四类大题在数据上**无可靠判别特征**（COMPREHENSIVE=0 条内容存在；rubric=0 条；节点名≠题型——PV 节点下也有单选题）；中文/枚举双表示已并存，派生规则会引入第三套隐式口径。
- trade-off：migration 成本 0；语义清晰度差（派生规则=隐式 SoT，违反"题型维度 MISSING（数据层）"的修复本意）；ErrorPattern/ScoreLoss 消费时无法区分"真 subtype"与"猜测 subtype"，OBSERVED/PROXY 边界被模糊化。

**Option B：additive nullable `questionSubtype`**
- 形态选择事实：nullable（历史题=unknown，不伪造）；enum vs string——enum（Prisma `QuestionSubtype`）获得类型安全与迁移校验，代价是扩字典需 migration；string+共享字典获得零成本扩字典，代价是脏值风险（A1 错因教训：自由文本不可聚合）。两者都以**新列+零回填**落地（与 maxScore 迁移同款 additive 模式，migration 20260913000000 先例）。
- trade-off：migration 成本 = 1×ADD COLUMN（低）；回填成本 = 内容轨（Owner D10 决定是否允许）；查询复杂度不变（直接列）；ScoreLoss/ErrorPattern 可直接消费（权威值）；历史兼容 = null 语义 + 分支降级。

**Option C：重构 QuestionType（type 语义拆分为 form + gradingChannel + 新 examCategory）**
- 事实约束：type 的中文/枚举双表示遍布评分（study.service.ts:3409）、前端（ExamSession.tsx:62 等 5 处）、导入（4 文件）、仓库层（practice-record.repository.ts:245-247）——重构 = enum migration（改值需数据迁移）+ 全消费者改造；JUDGEMENT/COMPREHENSIVE 行为由 `'综合题'` 字符串承载，拆分语义必然触及评分行为（违反"不为题型重构而改变被测评分行为"的风险）。
- trade-off：语义最清晰；但 migration/测试/回归成本与业务风险显著高于 B，且评分通道语义（现有 '综合题'⇒自评）并无错误需要修复。**仅作为备选分析，本设计不推荐在本阶段实施。**

---

## 9. Zero-Migration Feasibility（任务书 §19）

| 部分 | 结论 | 依据 |
|---|---|---|
| maxScore 定价 | **零迁移可完成**（字段已在，纯内容/数据回填） | schema:419-422；score-loss 消费链现成（score-loss.service.ts:100-112） |
| ScoreLoss 消费结构 | **零迁移**（已具备，等定价数据） | score-loss.ts 全部不变量 IL-1..IL-9 已实现并有测试 |
| subtype | **零迁移不可靠**（§6/§8-A） | 四类大题无数据判别特征 |
| 历史题兼容 | **零迁移**（null 语义即可） | nullable 设计 + INV-10 |
| 「数据回填 ≠ schema migration」 | 回填 = 对**已有列**写值（内容轨，需 Owner D10 授权 + 教研定价）；migration = 结构变更（D12） | migration 20260913000000 注释："backfill = fabrication"（未经授权的回填即伪造） |

---

## 10. Schema Change Analysis（若 Owner 批准 D12）

最小 additive 形态（与 20260913000000 同款模式）：
1. `ALTER TABLE "Question" ADD COLUMN "questionSubtype" TEXT NULL`（enum 值域由共享字典约束，或 Prisma enum——D3 决定）；零回填、零默认、可 `DROP COLUMN` 回滚。
2. （可选，D3 若选 string）无第二列——来源标记 `questionSubtypeSource` 仅在需要区分"人工定价/导入继承"时才加，本设计默认不加（YAGNI，A1 经验：先最小面）。
无 drop/rename/改值，既有 API 响应纯增量（向后兼容）。

---

## 11. Historical Compatibility（任务书 §18）

| 旧数据形态 | 策略 | 语义 |
|---|---|---|
| 无 subtype | 读作 `unknown`，可观察不参与题型聚合分母的"已分类"侧 | null 永不猜 |
| maxScore=NULL | 维持 NULL=未定价，ScoreLoss 继续计 unpricedLostQuestions | INV-10 |
| maxScore=0（若未来出现） | 合法"确值零分题"，OBSERVED 0 分 | score-loss.ts:17 IL-4 |
| COMPREHENSIVE 旧题 | type 不动（评分通道不变），subtype 缺省 unknown；已有 rubric 的题 subtype 可由内容轨补录 | 评分行为零变更 |
| 无 rubric 大题 | 自评 ⇒ PROXY；rubric 后补 ⇒ 新 attempt 起 OBSERVED，历史 attempt 不改写（append-only） | score-loss.ts:128；ledger append-only 原则 |
| backfill / lazy derivation / null / unknown 使用边界 | backfill：仅内容轨对 maxScore（D10）；lazy derivation：**不用于权威 subtype**（仅 UI 展示降级）；null：字段缺省；unknown：subtype 查询结果语义 | — |

---

## 12. ScoreLoss Integration（任务书 §16，Q1-Q5）

- **Q1 为什么 coverage=0**：定价题数=0（§5 根因）→ 所有 fact 的 maxScore=null → lostScore 全 null（score-loss.ts:115-117）→ 机器可读信号 `coverageGap.unpricedLostQuestions` 全量、无任何非 null lostScore 行。
- **Q2 只补 maxScore 是否 coverage>0**：**是（对已发生的错答作答）**——价格优先级 ① 生效后，客观错答立即产出 OBSERVED lostScore（score-loss.ts:120）；前提是该错答经真实提交路径（paper 会话或带幂等键的单题提交）且 scoreEntryKind 关联成立。**注意**：补价不回溯历史 ScoreLossItem 行（append-only；重派生幂等键=(scoreEntryKind,scoreEntryId,questionId)）。
- **Q3 哪些题仍进不了**：①正确作答（无损失，score-loss.ts:114）；②无节点归因（nodeId=null，进 coverageGap）；③未发生过真实提交的题（无 evidence）；④maxScore 仍 NULL 的未定价题（计数不成数）。
- **Q4 大题经 rubricEarnedScore 进 OBSERVED？** **是**：`lossKind = isRubric ? 'OBSERVED' : 'PROXY'`（score-loss.ts:128）——前提=该题有 rubric + 走 large-question 评分路径 + 内容定价（或 rubric.totalPoints 作 maxScore 语义需 D4 裁决）。
- **Q5 哪些只能是 PROXY**：selfScore 自评（无 rubric）——`rawEarned = selfScore`（:129）；以及未来任何由 mastery/预测推导的"预计丢分"（predictedGain 另列，永不混入 observedLoss，IL-6）。

---

## 13. OBSERVED / PROXY Contract（任务书 §17，不可破坏）

| 层 | 数据来源 | 本阶段设计约束 |
|---|---|---|
| OBSERVED | 内容定价（Question.maxScore）× 真实作答 × 客观判分/rubric 评分 | subtype/maxScore 一经内容轨授权写入即为事实；投影只读 |
| PROXY | selfScore 自评、估算公式（exam-aligned predictedGain 等） | 永远单独列示（observedLoss/proxyLoss 分列，IL-6）；自评≠教师评分 |
| UNVERIFIED | 样本不足/来源缺失 | insufficient_data/coverage 缺口显式输出，不伪造 |
| 禁止 | mastery→丢分、预测→得分、自评→教师分、AI 猜测→verified | A1 已钉死同款边界（任务书 §12 同源） |

---

## 14. ErrorPattern Integration（任务书 §20，只设计不实施）

- A1 的 `ErrorPatternAttemptFact` 已携带 `questionType` 透传（error-pattern.service.ts:99,116-118）。未来接入 = 在该 fact 上增加 `questionSubtype`（服务端从 DB 行直读，权威值），聚合键扩展为 (subject, node, **subtype**, reason)。
- 目标查询形态（Owner §2 之例）：`OS + PV节点 + calculation_error × 大题subtype` 一次聚合可得。
- 双表示风险（本阶段发现，须在实施时收口）：DB 行 type=枚举、内存题 type=中文（§3）——subtype 接入时统一以 DB 行为准，避免第三套表示。
- 本阶段不改 error-pattern 任何代码。

---

## 15. Recommendation Impact（任务书 §20）

- **数据准备**：subtype/maxScore 落库后，`buildEvidence`（recommendation.service.ts:482）未来可携带题型证据——这是数据轨。
- **生产策略改变**：priority 六分量不加题型项（priority.ts:45-87）；排序货币切换属 S4，Owner 锁定。本阶段与 A1 同边界：**只备数据，不改策略**。R8（rubric 丢分进推荐）仍为路线图 B2 事项。

## 16. Mastery Impact

- **不新建第二套 Mastery SoT**（AGENTS RULE-09/Owner Decision §6）。题型表现若需状态，一律 **Projection**（如按 subtype 聚合 PracticeRecord 正确率），不建 `UserQuestionTypeMastery` 表。
- 掌握度唯一写方（score-center）零接触；UserKnowledgeMastery 粒度不变（userId,nodeId）。

## 17. Large Question Impact

- 四类大题可由 `questionSubtype` 表达（算法设计/组成计算/OS PV/CN 路由——D3 字典冻结后成为权威分类）。
- 大题失分模型（后续阶段）= `subtype`（分类）+ `maxScore`（定价，来源可 rubric.totalPoints，D4）+ `rubric.criteria`（采分点）+ `rubricEarnedScore`（OBSERVED 得分）→ ScoreLoss 大题行。本阶段不开发训练闭环（P0-3）。

## 18. API / Frontend Impact（只读结论）

- 现状：`type` 中文字符串在前端 5 处分支（ExamSession.tsx:62,114,148,392,555）；题目查询对客户端剥答案（question-view）；**前端当前不显示任何分值字段**（grep maxScore 于 apps/web 零命中）。
- 未来（本阶段不改）：①题目卡/错题卡题型标签（subtype 中文标签）；②作答页大题分值显示（maxScore/selfScore 上限）；③报告页失分源按题型分组——均需新增 UI 字段消费新数据，属实施阶段任务。

## 19. Test Strategy（Future Test Matrix，只设计）

| 测试 | 断言目标 |
|---|---|
| Subtype contract | 字典封闭性、unknown 降级、中文标签唯一性（复用 A1 error-reason 测试模式） |
| MaxScore contract | null≠0（INV-10）；价格优先级 ①→②→null；OBSERVED/PROXY 判定 |
| Legacy compatibility | 旧题（无 subtype/maxScore NULL）读路径与 API 响应逐字段不变 |
| ScoreLoss coverage | 定价后 coverage>0；unpriced 计数；append-only 重派生幂等 |
| Observed/Proxy separation | selfScore⇒PROXY、rubric⇒OBSERVED 永不合并 |
| Large Question score | rubricEarnedScore 进 OBSERVED 的端到端路径 |
| QuestionType mapping | D6/D7 映射表全行断言 |
| Unknown subtype | unknown 不进题型聚合分母的已分类侧 |
| E2E（RULE-03） | 真实 PG+HTTP：定价题错答→ScoreLoss OBSERVED 行→error-patterns 含 subtype 行；含 401/403 拒绝路径 |

## 20. Recommended Design（**证据驱动提案，非批准架构**）

```text
Question
 ├─ type          QuestionType（现状保留 = 形式+评分通道；语义由 D1 正式命名）
 ├─ subtype       String? / QuestionSubtype?（additive nullable；字典 D3 冻结；
 │                unknown 语义 = NULL；不回填除非 D10 授权）
 ├─ maxScore      Float?（现状保留；内容轨定价 → coverage>0；D4 语义正式化）
 ├─ rubric        Json?（现状保留；大题 OBSERVED 得分来源）
 ├─ subject       经 KnowledgePoint/KnowledgeNode（现状）
 └─ knowledge mappings（现状）
```

- **推荐路径 = Option B（additive nullable subtype）+ 内容轨 maxScore 定价**；Option A 仅作为 UI 降级展示的派生（非权威）；Option C 不在本阶段。
- 依据：①题型维度 MISSING 的根因是数据层（gap analysis G-A），派生无法修复数据层（§6 判别特征缺失）；②additive nullable 与 20260913000000 先例同款、可逆；③ScoreLoss/ErrorPattern/大题三个消费方都需要**权威**题型值。

## 21. Owner Gate Decisions（D1-D12，全部待裁决）

| # | 决策 | 本设计建议（仅供参考） |
|---|---|---|
| D1 | QuestionType 最终语义 | 正式命名为"作答形式+评分通道"，不承担考试题型 |
| D2 | 是否新增 QuestionSubtype | 建议新增（additive nullable） |
| D3 | subtype 完整字典 | 建议最小集：algorithm_design / co_computation / os_pv / cn_routing / comprehensive_choice / single_choice / unknown；是否再细分由教研定 |
| D4 | MaxScore 正式语义 | 内容侧单题分值（试卷口径）；大题=rubric.totalPoints 对齐；与 record.maxScore（作答快照）明确分层 |
| D5 | maxScore=NULL 历史题 | 保持 NULL=未定价；不伪造 0 |
| D6 | 综合题映射 | COMPREHENSIVE=自评通道不变；subtype=按内容归类（含 comprehensive_choice） |
| D7 | 四类大题映射 | algorithm_design / co_computation / os_pv / cn_routing 四码（D3） |
| D8 | coverage 正式口径 | 建议口径：非 null lostScore 行数 ÷ eligible 错答数（或等价的 unpricedLostQuestions=0 事件），以 score-loss 文档化为准 |
| D9 | OBSERVED/PROXY 边界 | 维持 §13 契约，禁止混算（IL-6） |
| D10 | 是否允许数据回填 | maxScore：允许（内容轨、教研定价、显式工具）；subtype：允许（人工标注）；均不回填历史作答/投影行 |
| D11 | 历史兼容策略 | §11 表（null/unknown 分层，lazy 派生仅 UI） |
| D12 | 是否允许 schema migration | 若 D2=是：允许 1×ADD COLUMN additive（可 DROP 回滚） |

## 22. Implementation Order After Approval（批准后建议序）

1. Owner 裁决 D1-D12 → 2.（若 D12）additive migration + shared 字典模块（TDD：subtype 契约 RED→GREEN，复用 A1 模式）→ 3. Question CRUD/导入链映射 subtype+maxScore（含 CSV 模板列）→ 4. 内容轨定价与大题标注（教研）→ 5. ScoreLoss 接入验证（coverage>0 E2E）→ 6. error-patterns fact 增加 subtype（只读投影扩展）→ 7. 前端题型标签/分值显示（独立小步）→ 8. 每步真实 PG+HTTP E2E + 全量回归。

## 23. Risks / Information Gaps

- 生产题库分布 UNAVAILABLE（本设计仅测试实例 DB observed + 内容库 static observed）；批准实施前建议对生产库跑只读统计复核定价面。
- D3 字典的教学准确性（四类大题的实际名称/分值）属教研判断，代码侧无法验证。
- COMPREHENSIVE 在生产是否存在非自评用法 UNVERIFIED（内容库无样本）。
- 中文/枚举双表示（§3）是历史债：subtype 实施时必须只认 DB 行，否则会复制第三套口径。
- `record.maxScore`（作答快照价）与内容价（①）在存量行上可能不一致——实施时需在报告中并列展示两种价格来源（score-loss 已按优先级处理，但数据一致性未审计）。

---

**本阶段到此 STOP。** 零代码/schema/migration/数据/前端/API/Git 变更；唯一新文件 = 本文档。等待 Owner 对 D1-D12 裁决后方可进入 V13-P0-1 Implementation。

---

## 24. Owner Decision v1.1 — D1-D12 正式冻结（2026-09-18）

> 本节为 Owner 正式裁决记录，取代 §21 的"建议"性质。§21 保留为设计提案留档。

| Gate | 裁决 |
|---|---|
| **D1** QuestionType 语义 | 保留现有 3 值作为**历史/基础形式类型兼容层**，不承担完整 408 题型语义 |
| **D2** QuestionSubtype | **新增 additive nullable 字段** |
| **D3** subtype 字典 | 第一版至少覆盖：单选、判断、综合选择、算法大题、组成原理计算、OS PV、CN 路由/计算 |
| **D4** maxScore 语义 | **题目在 408 考试中的最高可得分值** |
| **D5** maxScore=NULL | 表示**未定价**，绝不解释为 0 分 |
| **D6** 历史题 | subtype=NULL、maxScore=NULL 时保留 unknown/unpriced，**不猜测** |
| **D7** COMPREHENSIVE | 暂时保留现有评分行为，不把它直接等同某一种 408 subtype |
| **D8** ScoreLoss coverage | 仅统计具有**有效题目分值**且存在**有效失分证据**的题；未定价继续进入 unpriced 口径 |
| **D9** OBSERVED/PROXY | 延续现有契约；**真实题目分值 + 真实评分**才能进入 OBSERVED |
| **D10** 数据回填 | 允许内容侧定价/回填，但**必须有独立审计和回滚记录** |
| **D11** Schema | 允许 **1 条 additive nullable migration**，**禁止重构原 QuestionType** |
| **D12** Recommendation/Mastery | P0-1 只建设数据基础，不改变 priority 权重，不增加第二套 Mastery SoT |

### 三条锁死原则（Owner 明示，全程有效）

1. **NULL ≠ 0**：全系统统一——`NULL` = 未定价/未知；`0` = 真实的 0 分题（如业务允许）。不得因 coverage=0 把两者混在一起。
2. **双层题型模型**：`QuestionType` = 历史/基础形式层（评分通道、形式标签，语义不动）；`QuestionSubtype` = 408 业务题型层（新权威维度）。**禁止把 COMPREHENSIVE 重构成 ALGORITHM/CO_COMPUTATION/OS_PV/CN_ROUTING**——`type === '综合题'` 参与评分/前端/导入逻辑（study.service.ts:3409 等），重构会破坏现有消费者。
3. **MaxScore 主修复链不是 migration**：实施链 = Schema 能表达（D2）→ QuestionSubtype → 内容生产规范 → 导入映射 → 存量题定价 → ScoreLoss coverage > 0。不是改数据库默认值。

### 与 §21 建议的差异记录

- D4：Owner 语义（"408 考试中最高可得分值"）比设计建议（"内容侧单题分值"）更明确地锚定考试口径——rubric.totalPoints 与 maxScore 的对齐关系在实施时按此口径处理。
- D8：coverage 口径采纳"有效分值 × 有效失分证据"双条件（与设计建议的"非 null lostScore 行占比"兼容，实施时以文档化公式落地）。
- D10：回填授权附加了设计未明示的硬条件——**独立审计 + 回滚记录**。

**实施（migration/内容链/导入映射/存量定价）待 Owner 下达 V13-P0-1 Implementation 任务书后启动。本阶段保持 STOP。**
