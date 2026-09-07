# Feature 1 — Milestone 2 Completion Report（Recommendation Explanation + 接线）

> 状态：COMPLETE（待所有者 Review；M3 前端展示未启动）。
> 日期：2026-09-07。Track：LE-V10 Feature 1。
> 上游：M1（Review Approved）+ `docs/feature1-real-exam-practice-plan.md` §6/§9。

---

## 1. 修改文件

| 文件 | 变更 | 内容 |
|---|---|---|
| `apps/api/src/study/exam-alignment.selector.ts` | 增量 | 新增纯函数 `withExamAlignmentSection`：普通模式返回 base **原样（连键都不加，字节级一致）**；`exam_aligned` 且 store 不可用/无数据 → 显式 `examAlignment: null`；有数据 → 附加段并应用 `rankByExamAlignment`（含近期已练降权） |
| `apps/api/src/study/exam-alignment.service.ts` | 增量 | 新增 `attachToPracticeSet(userId, base, mode, recentPractice)`：仅 `mode==='exam_aligned'` 且 enabled 时做 IO（题目 id → M1 装载链），其余路径零 IO 直通 |
| `apps/api/src/study/study.service.ts` | 最小 diff | ①`getRecommendedPracticeSet` 增第三参 `mode?: string`，三分支结果统一经 `examAlignment.attachToPracticeSet` 收口（`!examAlignment` 时原样返回——构造器未注入则行为与现网完全一致）；②新增私有 `recentPracticeRefs(userId)`：内存 records 近 7 日有界过滤（rank 降权输入）；③构造器**末位**追加 `@Optional() examAlignment?: ExamAlignmentService`（地雷清单规则） |
| `apps/api/src/study/study.controller.ts` | +2 行 | `@Query('mode') mode?: string` 透传 |
| `test/exam-alignment.test.js` | +5 测试 | §2 |

## 2. API 变化（增量，无破坏）

`GET /practice-sets/recommended?minutes=&mode=exam_aligned`

- **普通模式（无 mode / 未知 mode）**：响应与现网**逐字段一致**（`withExamAlignmentSection` 对非 exam_aligned 直接返回原对象——测试断言键数量不变）。
- **exam_aligned**：响应附加 `examAlignment` 段（形状 = Plan §9：`summary{coveredNodeCount,coveredYears,highFrequencyCount}` + `items[{questionId, primaryNode, stars, recent3/5Frequency, lastSeenYear, mastery, attempts, predictedGainEstimate, examHits≤3, evidence{源表+公式}}]`，items 已按考频×缺口排序且近期已练降权）。
- **legacy/库不可用**：`examAlignment: null`（显式诚实缺席，不伪造数据）。
- 未知 mode 值：宽容忽略（按普通模式处理）。
- **零新端点；既有字段零改动；shared 引擎零改动**（源码断言：shared `recommendation.ts` 不含 `exam_aligned` 字样）。

## 3. 前端影响

**零**（M3 范围）。响应为纯增量字段，既有前端 `practiceSet` 消费路径不受影响；M3 的 `RecommendationReasonCard / ExamCoverageSummary / 模式开关` 将消费本字段。

## 4. 实施前三项确认（按指令）

1. **调用链**：Controller(:291) → `getRecommendedPracticeSet(userId, minutesBudget, mode?)` → 三分支（无库→legacy / 无 recommendation→legacy / →FromState）→ 统一经 `attachToPracticeSet` 收口。
2. **ViewModel 转换位置**：前端 ModuleResource 直传响应（无再加工层）——examAlignment 增量字段直通至 M3 消费，无需中间转换。
3. **DTO**：仓库存量风格为内联响应类型、无独立 DTO 文件——`examAlignment` 作为可选响应字段内联（不改任何既有类型）。

## 5. 测试结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 定向 | `node --test test/exam-alignment.test.js` | **20/20 PASS**（+5 先 RED 后 GREEN） |
| 回归（专项） | `node --test test/wrong-question-query-parity.test.js test/wrong-question-summary-parity.test.js` | 4/4 PASS（曾因 TS 错误连带失败，修复后恢复） |
| 全量 | `npm test` | **1985 / 1983 pass / 0 fail / 2 skipped**（1980 基线 + 5，零新增失败） |
| 构建 | `npm run build:api` | PASS（抓到并修复 1 个真实类型错误：内存版 `PracticeRecord` 无 `createdAt`，正确字段为 `submittedAt`——`recentPracticeRefs` 已改用之） |

## 6. Acceptance Checklist（M2 范围）

- [x] 普通模式行为与现网逐字段一致（键数量断言 + 全量回归）
- [x] exam_aligned 附加 examAlignment 且 items 应用排序与近期降权（行为断言）
- [x] legacy/无库 → `examAlignment: null` 显式缺席（不伪造）
- [x] engine 零触碰（shared recommendation.ts 源码断言不含 exam_aligned）
- [x] 无 UI 开发 / 无迁移 / 无推荐算法修改
- [x] 全量测试零新增失败 + build:api PASS

## 7. 下一阶段建议（M3 预告）

前端展示层：`exam-aligned/` 四文件（ReasonCard/ExamCoverageSummary/徽标/vm）+ PracticePanel 模式开关与侧栏挂载（Plan §7 批准的侧栏方案）+ DESIGN.md 增量 + dev 栈四主题目检。M2 的响应契约即 M3 的唯一数据源，无待定项。

**等待 Review。通过后进入 Milestone 3（Frontend 展示）。**
