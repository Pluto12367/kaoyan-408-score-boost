# Feature 1：真题对标练习模式 — Implementation Plan

> 状态：Phase 1 Implementation Plan（待所有者 Review，通过后进入 Milestone 1 Coding）。
> 日期：2026-09-07。Track：LE-V10（Learning Engine Upgrade）。
> 上游：`docs/v10-learning-engine-roadmap.md` Feature 1。
> 纪律重申：不修改 Recommendation Engine / Student State / Mastery Engine / Knowledge Graph；全部新增能力以 Selector/Projection/ViewModel 落地；0 migration。

---

# 1. Feature Overview

## 背景
系统推荐引擎已消费真题考频（见 §2 审计——`calculatePriority` 以 `KnowledgeFrequencySnapshot` 为 evidence 输入，`HIGH_RECENT_FREQUENCY` 理由码在生产运行），但这份"智能"**对用户不可见**：推荐练习集只携带集合级一句话理由（"优先覆盖 X，当前正确率 Y%"）。

## 用户痛点
- "为什么练这道题？"——推荐缺乏可感知的正当性，练习像执行系统指令而非真题指挥。
- 学生不知道自己的薄弱点在真题里值多少分，时间无法按分值密度投放。

## 解决的问题
把已有的频率×掌握度决策链**产品化为可见的理由链**：每道推荐题携带真题对标数据（频次/最近年份/掌握度/估算收益/关联真题），训练结束输出真题覆盖报告。

## 对 408 提分价值
- 动机侧：真题是考研学生唯一完全信任的锚——练习与真题的可见关联直接提升执行率与坚持度。
- 效率侧：`mode=exam_aligned` 按"考频 × 掌握缺口"重排候选，把有限练习时间投放到分值密度最高的节点（`primaryScore5y` 已在快照中）。

---

# 2. Existing Capability Audit（基于仓库实际代码，非假设）

| # | 模块 | 文件:位置 | 职责 | 复用结论 |
|---|---|---|---|---|
| 1 | **频率→引擎接线** | `apps/api/src/study/recommendation.service.ts:400-418`（`buildEvidence`） | 读 `loadLatestFrequencySnapshots` → 组装 `recent3Y/recent5Y{frequency,primaryScore}/allTimeEvidence/trend/confidence` 喂给引擎 | ✅ **已接线，F1 不需要改引擎** |
| 2 | **频率加权优先级** | `packages/shared/src/score-center/recommendation.ts:79-97` | `calculatePriority(evidence, userState, daysToExam)` → `priority.score + reasons`（含 `HIGH_RECENT_FREQUENCY`）→ `candidate.reasonCodes` → `composeDailyPlan` drafts | ✅ 已生产运行；F1 复用其 reasonCodes 语义 |
| 3 | **题→节点解析** | `apps/api/src/score-center/service.ts:280`（`resolveKnowledgeNodesForQuestion`） | 题库题经 `QuestionKnowledgeNodeTag` 解析到知识节点（节点口径契约） | ✅ 直接复用 |
| 4 | **节点→考频** | `score-center/service.ts:285`（`loadLatestFrequencyForNodes`） | 节点批量取最新 `KnowledgeFrequencySnapshot` | ✅ 直接复用 |
| 5 | **节点→真题命中** | `score-center/service.ts:286`（`loadExamQuestionsForNodes`）+ `:290-298`（examHits 组装：exam/year/questionNo/节点名） | 经 `ExamQuestionKnowledgeTag` 反查真题题号 | ✅ **关联真题卡片的数据链完整存在**（现为 `GET /wrong-questions/:id/exam-links` 专供错题） |
| 6 | **推荐练习集入口** | `apps/api/src/study/study.service.ts:2574`（`getRecommendedPracticeSet`，`?minutes=` 预算档） | 生成推荐题组；**响应仅集合级 reason + knowledgePointIds（节点口径）+ questions** | ⚠️ 这是 F1 的主改造点：附加对齐投影（增量字段） |
| 7 | **用户能力 SoT** | `UserKnowledgeMastery`（OCC 写方 `ScoreCenterService`） | 每节点 mastery/accuracy/attempts | ✅ 只读复用 |
| 8 | **练习管线** | PracticePanel → `usePracticeSession`（8s 自动保存/断点恢复）→ `POST /practice-sets/:id/submit` → ScoreCenter.applyAttempts | 练习-判题-掌握度闭环 | ✅ 零改动（对齐数据只读伴随） |
| 9 | **前端渲染位** | `apps/web/src/features/practice/PracticePanel.tsx`（集卡片）+ `training-room/TrainingHero|Summary`（会话头/尾） | 练习 UI 骨架 | ✅ 新组件嵌入，不重构 |
| 10 | **理由展示先例** | V8 #11 任务行理由 + 错题页"推荐依据面板" | 透明→信任的 UI 模式 | ✅ 视觉模式复用 |

**审计结论**：数据链（题→节点→频次/真题/掌握度）**全部现成**且已在生产被 exam-links 端点验证；引擎不动；缺口只有两处——①练习集路径缺 per-question 对齐投影；②前端无理由卡与覆盖报告。

---

# 3. User Experience Flow

```
练习面板（PracticePanel）
   └─ 入口：「真题强化」模式开关（与 15/30/60 分钟预算档并列）
        ↓
生成训练集合（mode=exam_aligned：候选按 考频×掌握缺口 重排）
        ↓
集合卡顶部：本次对标摘要（覆盖 N 个真题考点 · 最高 ★★★★★ · 涉及 2022-2026）
        ↓
逐题作答（ExamSession 既有流程不变）
   └─ 每题头部：RecommendationReasonCard（可折叠"展开依据"）
        ↓
完成训练（既有提交流程 → 掌握度更新照常）
        ↓
TrainingSummary 新增区块：ExamCoverageSummary
   ├─ 覆盖知识点（节点名 + 频次星级）
   ├─ 覆盖年份（2022-2026 命中分布）
   ├─ 高频程度（★数分布）
   └─ 掌握变化（会话前后 mastery 对比——数据来自既有 mastery map 刷新，非本 Feature 计算）
```

推荐卡内容（对齐用户示例，全部字段有数据源）：

```
推荐原因：★★★★★ 高频考点
近 5 年出现：6 次            ← KnowledgeFrequencySnapshot.recent5Frequency
最近出现：2025 年             ← ExamQuestionKnowledgeTag→ExamQuestion.paper.year 最大值
你的当前掌握度：62%           ← UserKnowledgeMastery.mastery
预计收益：补齐该知识点可能提升约 8 分（估算）  ← 公式见 §5，强制"估算"标记
关联真题：2025·数据结构 第8题 / 2024·数据结构 第10题  ← loadExamQuestionsForNodes
```

---

# 4. Recommendation Flow Design

**输入**（全部既有，零新建）：

```
UserKnowledgeMastery ──┐
KnowledgeFrequencySnapshot ──┤
Question Difficulty（Question.difficulty）──┤→ exam-aligned.selector（新，纯函数）
Question Knowledge Tags（QuestionKnowledgeNodeTag）──┤        ↓
Recent Practice History（近 7 日 PracticeRecord，用于去重/降权）──┘  RecommendedQuestion + RecommendationReason
```

**输出**：`{ items: [{ questionId, order, reason: {...} }] }` —— 只决定**排序与理由**，不改变题目集合的来源（题目仍来自既有推荐/薄弱匹配管线，保持既有质量兜底）。

**是否修改 Recommendation Engine：否。** 接线方式：
1. 排序：`mode=exam_aligned` 时，在 StudyService 的推荐集组装处调用新纯选择器 `rankByExamAlignment(candidates, snapshots, mastery, recentPractice)` 对**已选出的题集**重排 + 去重降权（近 7 日已练题目优先换出，从既有候选池取替补）。
2. 引擎语义不重复实现：节点的"高频"判定阈值与 `HIGH_RECENT_FREQUENCY` 的触发语义对齐（从 shared types 读取同一常量源，不另造口径——V8 同屏矛盾红线）。

---

# 5. Recommendation Reason Chain Design

```
Question
  → KnowledgeNode(s)         QuestionKnowledgeNodeTag（节点口径，KP 仅 fallback）
  → FrequencySnapshot        loadLatestFrequencyForNodes（每节点最新一条）
  → UserMastery              UserKnowledgeMastery（无记录 → insufficient，卡片降级）
  → RecommendationReason     exam-alignment.selector（纯函数，无 IO）
  → UI Explanation           RecommendationReasonCard（每字段旁可展开"依据"）
```

**可追溯性规则（测试钉死）**：
- 每个展示字段在 reason payload 中携带 `source: { table, key }`（如 `{ table: 'KnowledgeFrequencySnapshot', key: nodeId }`）；UI"展开依据"显示来源与原始值。
- **禁止幻觉式解释**：selector 只做映射与四则运算，不生成自然语言推断句；所有文案为模板插值（对齐 sprite-persona 模式）。
- 数据缺失分支：无快照节点 → 卡片不显示频次行（显示"暂无真题数据"，绝不显示 0 次）；无 mastery 记录 → "尚未练习过该考点"（≠ 0% 掌握，V8 红线）。

**诚实估算公式（predictedGain，强制"估算"前缀 + 可展开）**：

```
predictedGainEstimate = primaryScore5y × (1 − mastery) × 0.6（保守折算系数）
```
- `primaryScore5y`：该节点近 5 年真题主考分值（快照字段）。
- `(1 − mastery)`：掌握缺口。
- `0.6`：保守系数（假设补齐到 100% 掌握通常不可达）；系数在代码常量 + 文档声明，展开依据时完整展示公式。
- 四舍五入到整分；`evidenceConfidence = LOW` 时整行隐藏（宁缺毋假）。

**星级映射（高频程度，阈值与引擎口径同源）**：

| recent5Frequency | 星级 | 标签 |
|---|---|---|
| ≥ 5 | ★★★★★ | 高频考点 |
| 3-4 | ★★★★ | 常考考点 |
| 1-2 | ★★★ | 偶考考点 |
| 无快照/LOW 置信 | 无星 | 暂无真题数据 |

---

# 6. Backend Plan

| 层 | 变更 | 说明 |
|---|---|---|
| **Selector（新）** | `apps/api/src/study/exam-alignment.selector.ts` | 纯函数：`rankByExamAlignment` + `buildQuestionAlignment`（零 IO/零依赖，沙箱可测——daily-brief/sprite-state 同款纪律） |
| **Service（新）** | `apps/api/src/study/exam-alignment.service.ts` | 只读组装：复用 score-center 的 `resolveKnowledgeNodesForQuestion / loadLatestFrequencyForNodes / loadExamQuestionsForNodes`（若为模块私有则导出复用——**纯 export 增量，不改逻辑**）；+ UserKnowledgeMastery 批量读 + 近 7 日 PracticeRecord 有界读 |
| **StudyService（改，最小）** | `getRecommendedPracticeSet` 末尾追加调用 | `mode` 参数透传；响应**增量**附加 `examAlignment`（见 §9）；非 exam_aligned 模式仅在有数据时附带轻量徽标字段（向后兼容） |
| **Controller（改，1 行）** | `@Query('mode') mode?: string` | 透传 |
| **DTO** | 无新 DTO 文件（仓库存量风格为内联类型） | 响应增量字段内联声明 |
| **不改** | Recommendation Engine（shared）、ScoreCenter 写路径、ReviewSchedule、StudyPlan | 引擎零触碰 |

复用声明：频率接线（audit #1）、优先级理由码（#2）、题→节点→真题三连装载器（#3-5）**复用现有能力，不修改**。

---

# 7. Frontend Plan

新增（`apps/web/src/features/practice/exam-aligned/`）：

| 组件 | 职责 | 设计系统对齐 |
|---|---|---|
| `RecommendationReasonCard.tsx` | 每题理由卡（星级/频次/最近年份/掌握度/估算收益/关联真题）；"展开依据"披露源表与公式 | `SurfaceCard tone=subtle`；星级用 `--primary` 系；无 hex |
| `ExamCoverageSummary.tsx` | 训练后覆盖报告（覆盖节点/年份分布/星级分布/掌握变化） | `GlassCard tone=accent` 重点容器 + `ProgressRing`（掌握变化 null 安全） |
| `ExamAlignedBadge.tsx` | 集卡与题头的"真题强化"徽标（★ + 频次摘要） | chip 样式，`--primary-faint` 底 |
| `examAlignment.ts`（vm） | 纯展示映射（星级→视觉、年份列表格式化、估算文案拼装含"估算"强制前缀） | 零请求零业务状态 |

挂载点：
- `PracticePanel.tsx`：模式开关（与预算档并列）+ 集卡顶部摘要。
- `ExamSession` 题头（经现有 props 通道传入对齐数据，不改考试层逻辑）→ **替代方案（推荐，改动更小）**：理由卡放练习面板的题列表侧栏，考试界面零改动——实施时按 PracticePanel 实际结构二选一，M3 决定。
- `TrainingSummary`：追加 `ExamCoverageSummary` 区块。

风格：符合 DESIGN.md（语义 token / 间距阶梯 / 四主题级联 / `prefers-reduced-motion`）；"OpenGamifyLMS 风格"理解为徽标/星级的轻游戏化视觉——按 DESIGN.md 约束用 token 表达，不引入新依赖。

---

# 8. Database Impact

**0 migration。0 新表。0 字段变更。**

- 读：`KnowledgeFrequencySnapshot`（经既有 loader）、`UserKnowledgeMastery`（批量 IN，有界）、`QuestionKnowledgeNodeTag`、`ExamQuestionKnowledgeTag`、`ExamQuestion/ExamPaper`、`PracticeRecord`（近 7 日有界窗口）。
- 写：**零**（对齐投影只读；练习提交仍走既有唯一写方）。
- 读边界：每请求节点数 ≤ 推荐集节点上限（≤4，既有行为）；批量 IN 查询对齐 `student-context-consumer-audit` 有界读取纪律。

---

# 9. API Contract

**复用 + 增量，无破坏**：

`GET /practice-sets/recommended?minutes=15|30|60&mode=exam_aligned`

响应（**既有字段全部不变**，新增 `examAlignment` 可空段；非 exam_aligned 模式在有数据时也可携带——前端渐进展示）：

```jsonc
{
  "...": "既有字段原样（id/title/reason/knowledgePointIds/questionCount/questions...）",
  "examAlignment": {                          // 无任何数据时整体为 null（诚实缺席）
    "summary": {
      "coveredNodeCount": 4,
      "coveredYears": [2022, 2023, 2024, 2025],
      "highFrequencyCount": 2                 // ★≥4 的节点数
    },
    "items": [
      {
        "questionId": "q-...",
        "primaryNode": {
          "knowledgeNodeId": "DS-TREE-BST",
          "name": "二叉排序树",
          "subject": "数据结构"
        },
        "stars": 5,
        "recent5Frequency": 6,
        "lastSeenYear": 2025,
        "mastery": 0.62,                      // null = 尚未练习（≠0）
        "predictedGainEstimate": 8,           // 整分；LOW 置信 → null
        "examHits": [
          { "year": 2025, "subject": "数据结构", "questionNo": 8 },
          { "year": 2024, "subject": "数据结构", "questionNo": 10 }
        ],
        "evidence": {                         // 可追溯性载荷
          "frequencySource": { "table": "KnowledgeFrequencySnapshot", "nodeId": "DS-TREE-BST" },
          "masterySource": { "table": "UserKnowledgeMastery", "nodeId": "DS-TREE-BST" },
          "gainFormula": "primaryScore5y × (1 − mastery) × 0.6，四舍五入"
        }
      }
    ]
  }
}
```

覆盖报告（训练结束页）**不新增端点**：由前端以本次会话的 `examAlignment` + 提交后刷新的掌握度（既有端点）组装；掌握变化为会话前后同节点 mastery 差（两个时间点的既有读数对比，非新计算口径）。

---

# 10. Test Plan

## Unit Test（`test/exam-alignment.test.js`，沙箱 loader 同 daily-brief 先例）
1. `rankByExamAlignment`：频次×缺口排序正确性；近 7 日已练题目降权/换出；候选不足时保持原序（兜底不空集）。
2. `buildQuestionAlignment`：全字段映射；**无快照→stars 0 且频次行 null**；**无 mastery→null（≠0）**；`LOW` 置信→predictedGain null。
3. 星级阈值边界（5/4/3/2/1）；估算公式舍入；payload ≤ 有界长度。
4. 零依赖纪律：require 任何模块即 throw。

## Integration Test（`scripts/integration-exam-aligned.mjs`，真实测试库，对齐 v3.4 先例）
种子（既有 seed-408-v2 + 320 题库 + 造 1 个学生 mastery）后验证全链路：
`Question →(tags)→ Node →(snapshot)→ frequency/recent5 = 真实播种值 →(ExamQuestionKnowledgeTag)→ examHits 年份题号正确 → mode=exam_aligned 响应 items 与库内数据一致 → 提交一组练习 → mastery 更新（既有管线）→ 覆盖报告掌握变化非零`。

## Regression Test
1. **无 mode / mode 无效**：响应除新增可空段外与现网逐字段一致（deepEqual 既有字段）。
2. 无频率数据节点：`examAlignment.items` 对应行降级但不抛错；整体 null 分支。
3. 前端：无对齐数据时 PracticePanel/ExamSession/TrainingSummary 渲染与现状一致（源码契约断言 + 既有 practice UI 测试全绿）。
4. 全量 `npm test` 零新增失败 + `build:api/build:web` PASS（硬门禁）。

---

# 11. Acceptance Criteria

用户完成一次真题强化训练后：

- ✅ 本次练习覆盖 N 个真题知识点（节点名 + 频次），N 与响应 `coveredNodeCount` 一致
- ✅ 每道推荐题有理由卡（星级/频次/最近年份/掌握度）
- ✅ 每个理由可追溯：展开依据显示源表 + 原始值 + 公式（估算行含完整公式）
- ✅ 高频标签准确：抽查 ≥5 题，`recent5Frequency` 与 `KnowledgeFrequencySnapshot` 库内值一致（integration 断言）
- ✅ 掌握度正确：卡片值与 `UserKnowledgeMastery` 一致；无记录显示"尚未练习"而非 0%
- ✅ 所有估算收益带"估算"标记（UI 断言：无标记不渲染）
- ✅ 非 exam_aligned 路径行为与现网一致（回归通过）
- ✅ 全量测试零新增失败

---

# 12. Implementation Milestones

| M | 内容 | 交付物 | 验证 |
|---|---|---|---|
| **M1 数据读取层** | selector 纯函数 + service 组装（复用 score-center 装载器，必要时 export 增量） | `exam-alignment.selector.ts` + `exam-alignment.service.ts` + StudyModule 注册 | Unit 1-4（RED→GREEN） |
| **M2 Recommendation Explanation + 接线** | `getRecommendedPracticeSet` mode/增量字段；evidence 载荷 | StudyService 最小 diff + controller 1 行 | Unit + 回归 1（响应形状） |
| **M3 Frontend 展示** | 理由卡/徽标/模式开关 + 挂载（PracticePanel + 题头或侧栏二选一定案） | `exam-aligned/` 四文件 + DESIGN.md 增量 | build:web + 源码契约 + dev 栈目检 |
| **M4 训练结果总结** | ExamCoverageSummary + 掌握变化组装 | Summary 区块 | 手动 + 组件契约 |
| **M5 测试与验收** | integration 脚本 + 全量回归 + 真实浏览器走查 + Completion Report | `scripts/integration-exam-aligned.mjs` + 报告 | §11 全项勾选 |

依赖：M1→M2→(M3∥M4)→M5。每 M 遵守 TDD（先 RED）与全量零新增失败门禁。

---

# 13. Interview Value

- **Explainable AI / 可解释推荐**：频率→优先级→理由码→用户可读理由卡的全链路追溯设计（evidence payload 携带源表），是"黑盒推荐 vs 白盒推荐"的完整对照案例。
- **Recommendation System**：在不修改生产引擎的前提下叠加排序策略与解释层的插件式架构（Projection/Selector 模式）。
- **Knowledge Graph 应用**：题库题↔知识节点↔真题考点的多跳映射查询（`QuestionKnowledgeNodeTag` + `ExamQuestionKnowledgeTag` 双标签体系 join）。
- **Learning Analytics**：真题覆盖报告（覆盖度/年份分布/掌握变化）——把练习数据回灌为学习分析视图。
- **工程判断力**：0 migration、引擎零触碰、诚实估算原则（预测值强制标注+公式可展开）——展示产品伦理与技术克制的结合。

---

# 当前发现的问题（供 Review 决策）

1. **score-center 装载器可见性**：`resolveKnowledgeNodesForQuestion / loadLatestFrequencyForNodes / loadExamQuestionsForNodes` 若为模块私有，需 export 增量（纯导出，零逻辑变更）——M1 第一步核实。
2. **理由卡挂载位二选一**（§7）：题头内嵌 vs 练习面板侧栏——倾向侧栏（考试层零改动），M3 定案。
3. **legacy 内存模式**：无 DATABASE_URL 演示分支下无快照数据 → `examAlignment` 整体 null + 模式开关隐藏（诚实缺席，mock 红线不破）。

# 风险列表

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 频次覆盖不全（1149/1296 节点；LOW 置信） | 无数据/低置信行诚实隐藏；卡片降级不伪造 |
| R2 | predictedGain 被读成承诺 | "估算"强制前缀 + 公式展开 + 保守系数 0.6 声明 |
| R3 | 与引擎 HIGH_RECENT_FREQUENCY 口径分裂 | 阈值常量从 shared 同源引用；测试断言一致性 |
| R4 | PracticePanel 结构复杂导致挂载侵入 | 侧栏方案兜底；ExamSession 零改动红线 |
| R5 | 集卡摘要与 V8"唯一今日卡"仲裁冲突 | 摘要仅描述本次集内事实，不做全局"最重要"声明（措辞审查入 M3） |
| R6 | 集成测试依赖种子数据质量 | 沿用 seed-408-v2 真实播种；断言值取自库内而非硬编码期望 |

---

**等待 Review。通过后进入 Milestone 1（数据读取层，TDD）。**
