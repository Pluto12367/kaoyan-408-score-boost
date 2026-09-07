# Feature 1 — Milestone 1 Completion Report（数据读取层）

> 状态：COMPLETE（待所有者 Review；M2 未启动）。
> 日期：2026-09-07。Track：LE-V10 Feature 1 真题对标练习模式。
> 上游：`docs/feature1-real-exam-practice-plan.md`（Plan Approved）。

---

## 1. 修改文件

| 文件 | 变更 | 内容 |
|---|---|---|
| `apps/api/src/study/exam-alignment.selector.ts` | **新增** | 纯投影选择器：`buildExamAlignment`（题→主节点→频次/掌握度/真题命中→可解释对齐项 + 集合摘要）与 `rankByExamAlignment`（考频×缺口排序 + 近期已练降权，确定性 tiebreak）。导出 `ENGINE_HIGH_RECENT_FREQUENCY_THRESHOLD=4`、`GAIN_CONSERVATIVE_FACTOR=0.6`、`GAIN_FORMULA`。零 import、零 IO、零时钟（沙箱测试强制） |
| `apps/api/src/study/exam-alignment.service.ts` | **新增** | 只读数据装载：经 score-center/repository **既有导出 loader**（`resolveKnowledgeNodesForQuestion` / `loadLatestFrequencyForNodes` / `loadExamQuestionsForNodes` / `loadNodesWithParents`）+ 一次有界 `userKnowledgeMastery.findMany` 组装索引，交纯选择器投影；`@Optional` Prisma + enabled 门，库不可用返回 null（诚实缺席）；题目数上限 30 |
| `apps/api/src/study/study.module.ts` | +2 行 | import + providers 注册 `ExamAlignmentService` |
| `test/exam-alignment.test.js` | **新增** | 15 项测试（§2） |

**未触碰**：Recommendation Engine（shared 零改动）、ScoreCenter、推荐/练习/复习写路径、Controller/DTO（API 零变更——M2 才接线）、前端、Prisma Schema（0 migration）。既有文件改动总量 = study.module.ts 两行。

## 2. 新增测试（15 项，先 RED 后 GREEN）

1. **投影正确性**（4 项）：全字段映射与 evidence 载荷（源表名/公式串）、星级档位边界（6 档）、主节点选择（首个有快照的节点优先）、无节点解析的最小诚实项。
2. **诚实分支**（3 项）：无快照 → 0 星 + 全 null（断言不出现伪造 0）；LOW 置信 → 估算隐藏但频次展示不受影响；无掌握记录 → mastery null（≠0%）且估算随之隐藏。
3. **摘要聚合**（1 项）：跨题去重节点、★≥4 计高频繁点、年份降序；**修正过一个真实缺陷**：摘要年份初版从"展示上限 3 条"的命中聚合导致丢年——改为从索引全量命中聚合（展示截断不得截断覆盖事实）。
4. **排序**（3 项）：星级→频次→缺口（未练习=满缺口）排序 + 确定性 tiebreak；近期已练题在同档降权；空输入安全。
5. **同源阈值锁**（2 项）：**读 shared `priority.ts` 源码断言 `recent3Y.frequency >= N` 字面量与 selector 常量一致**（防止双口径漂移——V8 同屏矛盾红线的测试化）；估算系数导出且 ∈(0,1)。
6. **纯度与接线契约**（2 项）：selector 零 import/零时钟；service 必须从 `score-center/repository` import loader（**禁止复制装载逻辑**）+ `userKnowledgeMastery.findMany`（SoT）+ 只读（禁 create/update/delete）+ StudyModule 注册。

## 3. 测试结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 定向 | `node --test test/exam-alignment.test.js` | **15/15 PASS**（RED 31 失败确认 → GREEN） |
| 全量 | `npm test` | **1980 / 1978 pass / 0 fail / 2 skipped**（基线 1965/1963/0 + 15 项，零新增失败） |
| 构建 | `npm run build:api`（含 build:shared） | PASS |

## 4. 架构影响

- **引擎零触碰**：排序是"已选题目集"之上的投影，推荐什么仍完全由引擎决定——`rankByExamAlignment` 不产生候选、不修改 priority score。
- **复用而非复制**：五个 loader 均为 `repository.ts` 既有模块级导出，**零 export 改动、零逻辑复制**（Plan 待裁决问题 1 的答案：无需任何 score-center 变更）。
- **同源纪律**：引擎 `HIGH_RECENT_FREQUENCY`（recent3≥4）与选择器常量以**源码级测试锁同步**——shared 的阈值是内联字面量，改 shared 必须连带改 selector，测试即报警。
- **数据流**：`Question →(tag)→ Node →(snapshot+mastery+examTag)→ 纯选择器 → examAlignment projection`——与 exam-links 生产链完全同构，F1 = 该链从错题专属泛化到推荐练习（Plan 核心判断的实现确认）。

## 5. Acceptance Checklist（M1 范围）

- [x] score-center loader 复用性核实：**全部已导出，直接 import**（零 export 增量）
- [x] exam-links 映射逻辑可抽取性：**loader 层天然共享**（同一批函数），无需抽取
- [x] RecommendationResult→PracticeSet 数据流核实：legacy 路径题集→题目 id 列表即 selector 输入（M2 接线点明确）
- [x] ExamAlignmentSelector 实现：输入 Question/Tags/Snapshot/Mastery → 输出 examAlignment projection
- [x] recent frequency evidence（recent3/5/全量 + 趋势 + 置信度）
- [x] exam years（lastSeenYear + 关联真题 ≤3 条，年份降序）
- [x] mastery state（null=尚未练习，非 0%）
- [x] confidence（LOW → 估算整行隐藏）
- [x] estimated gain（强制估算语义：公式导出 + 保守系数 0.6 + evidence 载荷）
- [x] 禁 UI 开发 / API 大改 / 迁移 / 推荐算法修改——**全部遵守**（API 零变更，前端零文件）

## 6. 下一阶段建议（M2 预告）

1. `getRecommendedPracticeSet` 增量接线：`mode=exam_aligned` 参数透传 + 响应附加 `examAlignment` 段（Plan §9 契约形状已由 M1 输出对齐，M2 零重塑）+ `rankByExamAlignment` 应用（近期练习读取：近 7 日 PracticeRecord 有界窗口）。
2. 回归测试：无 mode 响应与现网逐字段一致（deepEqual 既有字段）。
3. 风险提示：`resolveKnowledgeNodesForQuestion` 为逐题查询（≤30 题/请求，推荐集典型 ≤10）——量级安全；若未来大集可改批量（登记为优化项，非本里程碑）。

**等待 Review。通过后进入 Milestone 2（Recommendation Explanation + 接线）。**
