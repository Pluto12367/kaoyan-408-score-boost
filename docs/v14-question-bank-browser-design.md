# V14 学生题库浏览与自由刷题 设计任务书（小 Design Gate）

> **Status**: IMPLEMENTED（Owner 2026-09-26「批准」D-B-1..4 按建议冻结；当日交付）。
> **任务来源**: Owner 2026-09-26 会话确认（"846 题量大到值得给一个带筛选的题库浏览页"）。
> **任务类别**: `CODE-BEHAVIOR`（零迁移、零 Schema 变更）。

## ⚠ 实施期审计修正（2026-09-26，比批准稿更小）

实施侦察发现：`GET /questions`（student 目录投影）与 `reports/overview.practiceRecords`
**已把全量题目安全投影（answer 置空、optionAnalyses 剥离）与本人作答记录下发到客户端**
（`questions.service.ts` refreshFromDatabase 全量装载）。§3 的 `GET /questions/browse`
新端点会重复下发客户端已有的数据——因此实现改为**纯客户端过滤**（原端点方案废弃）：

- 纯模块 `apps/web/src/features/practice/questionBankBrowser.ts`（筛选/排序/分页/组卷上限，node:test 7 例）；
- 组件 `FreePracticeBrowser.tsx` 挂在「题库训练」子标签（D-B-1）；
- 组卷经 App 层 `freePracticeContext` 显式题单进入**既有逐题练习流**（零新会话语义）；
- 唯一服务端改动：`toSharedQuestion` additive 补 `examNo`/`maxScore` 两个元数据字段
  （整卷快照中早已存在；目录排序与分值徽标需要）；
- 防泄/零写入语义不变：列表只渲染 stemPreview+元数据徽标（单测白名单 + 源码契约双断言），
  浏览行为零写入（RULE-07）。

门禁：`npm test` 2699/0/2skipped、build api/web exit 0、真实浏览器目检 PASS
（dev 栈 postgres 数据源，846 题目录、筛选联动、2009 综合题 10/15/8/13/7/8/9 分值徽标、
逐题练/整组练入口，截图留档）。

## 1. 范围（批准稿原文，供追溯）

学生按条件筛选并自由练习题库题目的浏览页。不改变推荐引擎、不改既有练习/整卷/真题链路语义。

## 2. 审计事实（缺口，一手）

- dev 库 current 题 = **846（全部为真题，18 年 × 47）**，节点直标覆盖 541 节点；"题库"即真题库。
- 学生现在**没有**题库全局浏览：题目管理视图仅 teacher/admin；学生侧题目全部按入口组织（推荐组、节点抽屉、套卷、错题本）。
- 节点抽屉「考点题库」列表无截断（`score-center/repository.ts:302` loadRelatedQuestionsForNode 无 take），是学生目前最接近自由刷的入口，但只能按节点导航：
  - 无法按 科目/题型/难度/年份/作答状态 组合筛选；
  - 无法按"年份+题号"直接定位某题；无题干搜索。
- 「题库训练」主面板固定走推荐引擎选题（`study.service.ts:2817`；exam_aligned 只是排序投影不改选题）。
- 会话层已支持显式题单：`startPracticeSession({type:'practice_set', questionIds})`（`sessions.ts:58`）。

## 3. 设计要点（批准稿；实现载体见顶部修正）

| 项 | 设计 |
|---|---|
| 端点 | ~~`GET /questions/browse`~~ → 改为纯客户端过滤（见修正） |
| **列表投影（防泄答案，硬卡）** | 只渲染 `stemPreview(≤60字) / type / difficulty / year / examNo / maxScore / source / attemptStatus`；**不渲染 answer / analysis / optionAnalyses / rubric**——看解析必须走作答流。测试含白名单拒绝断言 |
| attemptStatus 数据源 | 该学生 PracticeRecord 聚合的 **OBSERVED** 状态：`unanswered / wrong / correct`（wrong 优先）；浏览行为本身**不写**任何记录/mastery（RULE-07） |
| 排序 | `year desc（无年份最后）→ examNo asc（无题号最后）→ id` |
| 前端入口（D-B-1） | **「题库训练」区子标签「推荐训练/自由刷题」**（导航 8 项不膨胀） |
| 两种练法（D-B-3） | (i) 结果列表逐题点练；(ii)「整组练习」把筛选结果（**上限 50**，超限显式提示并截断）装进练习流 |
| 筛选维度 v1（D-B-2） | 科目(4) + 题型(2) + 年份(18) + 作答状态(4)。难度筛选、题干搜索 phase 2 |
| 空态诚实 | 筛选无结果显式空态，不回退推荐组（§4 禁静默回退） |
| 兼容性 | 纯 additive：一个组件 + 一个纯模块 + 投影两字段；零改动既有路由/响应语义 |

## 4. 语义与治理边界

- 不新建第二套题库 SoT：浏览页是既有学生目录投影的只读视图；attemptStatus 是 PracticeRecord 的只读投影。
- RULE-05：attemptStatus 为 OBSERVED（有记录才有状态）；RULE-06：无记录 = `unanswered`，绝不伪造正确率。
- 列表页不渲染解析 ⇒ 浏览-作答证据链与现状完全一致。

## 5. 开源参考方向

LeetCode 题目列表（标签/难度/状态筛选 + solved 徽标 + 题单）、Anki 浏览器（多维搜索与状态列）、粉笔/王道自由刷题模式。采纳"状态徽标 + 筛选组合 + 一键题单"模式，零代码复制。

## 6. 测试（已落地）

- 纯模块单测 `test/question-bank-browser.test.js`（7 例：状态归并 wrong 优先 / 组合筛选 / 排序 / 投影白名单 / 上限 50 / 分页）。
- 源码契约 `test/question-bank-ui-contract.test.js`（5 例：子标签接线 / App 启动链路与互斥清理 / 防泄渲染+零写入 / 常量 / 投影 additive）。
- 真实浏览器目检（§16 一手）：见顶部修正记录。

## 7. Owner Decision（2026-09-26「批准」= 按建议冻结）

| # | 决策 | 采纳 |
|---|---|---|
| D-B-1 | 入口 | 题库训练子标签 |
| D-B-2 | v1 筛选维度 | 四维，难度/搜索后置 |
| D-B-3 | 练法 | 逐题 + 整组（上限 50） |
| D-B-4 | 角色 | student-only（section 本身学生专属） |
