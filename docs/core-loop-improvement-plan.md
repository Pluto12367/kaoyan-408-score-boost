
# 核心闭环改进方案（core-loop-improvement-plan）

> 审计日期：2026-08-06。本文件只输出方案，**不执行**。实施需另行确认，并遵守仓库规则（先读 `docs/PROJECT_CONTEXT.md` / `docs/ARCHITECTURE.md`、执行开源参考检查、走验证门禁）。
> 依据：`docs/core-user-flow-audit.md`（走查证据）、`docs/ux-problem-backlog.md`（问题清单）。

## 1. 目标与原则

目标：让用户在**单次会话内无卡点**走完「诊断 → 计划 → 练习 → 错因 → 复习 → 复测 → 掌握度」，并且**每一步结束都明确知道下一步做什么**。

原则：
1. 先止血再优化：P0 断点与「刷新掉线」优先，不做视觉重构。
2. 闭环靠数据联动，不靠文案：计划进度、待复盘数、考后推荐都应以真实学习记录为唯一事实来源。
3. 单一主操作：每个页面只保留一个「当前最该做的事」主按钮。
4. 兼容性：所有改动保持现有 API/响应结构/Prisma 迁移向后兼容，先加后改。
5. 不新增与提分闭环无关的功能。

## 2. 分期路线

### 阶段一：止血（建议 1-2 天，改 3 处）
| 项 | 问题 | 改动量级 |
|---|---|---|
| 1 | P0-01 重做被残留结果阻塞 | 前端状态复位 + 重做改为会话模式（小-中） |
| 2 | P1-01 刷新掉线（令牌轮换竞争） | 前端刷新 single-flight + 会话清理保护（小） |
| 3 | P1-03 种子题 q-001 答案/题干错误 | 种子数据修正 + 存量记录影响评估（小） |

### 阶段二：打通「计划 → 练习 → 完成 → 下一步」（建议 1 周，改 4-5 处）
| 项 | 问题 |
|---|---|
| 4 | P1-02/P1-08 「开始任务」进入练习、练完有下一步 CTA |
| 5 | 任务进度与练习记录联动（自动完成/自动累计） |
| 6 | P1-04 考后复习推荐与考试内容对齐 |
| 7 | P1-05 复测弹层默认原因/免填 |
| 8 | P1-07 答对超时的「错因」文案改「用时偏慢」 |

### 阶段三：口径统一与体验收敛（持续，多为 P2）
| 项 | 问题 |
|---|---|
| 9 | P1-06 「待复盘」口径统一（头部/统计卡/首页 KPI/徽标同源） |
| 10 | P2-01/02/03 重复渲染、标签语义、移动端练习区收敛 |
| 11 | P2-04/05 状态文案与空状态收敛 |
| 12 | P2-06/07 KPI 口径与节奏条去雷同 |

## 3. 具体方案

### 3.1 修复「重做」断点（P0-01）

**问题**：`onRedo` 未清 `practiceAnswerResult`，重做页被残留结果禁用选项并错位展示。

**方案**（推荐 A，彻底）：
- 将「重做」从「单题模式 + 复用全局 `practiceAnswerResult`」改为复用 `usePracticeSession` 的会话式练习（`type: 'practice_set'`，单题会话），重做完成 → 调 `reportWrongReason(isReview=true)` → 更新错题本/复习计划/掌握度。
- 这样彻底消除「全局残留答案结果」这一状态源，同时自然获得「标记/自信程度/答题卡/断点续做」能力。

**方案 B（快速止血，可先行）**：
- `onRedo`/`onPracticeVariant` 进入时：`setPracticeAnswerResult(null)`、`setPracticeIndex(0)`、复位 `readPracticeElapsedSec()` 计时。
- 附加防御：`PracticePanel` 在 `redoQuestionId === question.id` 时忽略任何历史 `answerResult`（`answered` 只认当前题会话内提交）。

**改动范围**：`apps/web/src/App.tsx`（`onRedo`、`handleSubmitAnswer`）、`apps/web/src/features/practice/PracticePanel.tsx`；方案 A 另涉及 `apps/web/src/hooks/usePracticeSession.ts` 复用与错因弹层接入。

**验收标准**：答过题后进入错题本点「重做」，选项可点、无错位解析；答对提交复测后错题本状态变为「重做解决」、掌握度上升；桌面与移动端均通过。

**风险**：方案 A 改动面较大，需回归「变式复测」（`variantQuestionId`）路径；建议 A 拆两步：先 B 止血，A 排入阶段二。

**实施状态（2026-08-06）**：已关闭（同步状态残留 + 异步旧响应竞态均已修复并通过自动化验证；浏览器竞态验收因环境限制未执行，见下）。
- **已实施（同步）**：新增 `apps/web/src/features/practice/practiceAttemptState.ts` 纯函数模块（`beginRedo / beginVariantRetest / advanceQuestion`）；`App.tsx` 的 `onRedo / onPracticeVariant / handleNextQuestion` 三处转换边界统一重置本次答题尝试状态（清 `practiceAnswerResult / practiceSubmitting / reasonQueue`，按需设 `redoQuestionId / variantOfQuestionId / index`）。未采用「刷新绕过」「重挂载 App」「隐藏解析区」等绕过方案；不影响首次答题、题目切换、错题记录、掌握度更新；不改后端接口。
- **已实施（异步请求门控）**：新增 `apps/web/src/features/practice/practiceSubmissionGate.ts`（`attemptVersion + requestId` 双校验 + `useRef` 同步占锁）；入口同步拒绝双击重复提交；重做/变式/切题/错因弹层关闭与上报共 5 处边界 `invalidatePracticeAttempt` 使旧请求失效；`await` 返回与 `catch` 写回前校验 token；`finally` 仅当前请求可释放并清除 `practiceSubmitting`。
- **测试**：`test/practice-redo-reset.test.js` 7/7 通过（同步转换）；`test/practice-submission-gate.test.js` 8/8 通过（门控行为 + App 接线）。RED 阶段因模块不存在（ENOENT）失败；GREEN 后 4 项 mutation 验证均被测试捕获。仓库无 React 集成测试（无 jsdom/RTL），浏览器级竞态回归需真实浏览器验证。
- **浏览器验收**：本环境无法执行真实浏览器竞态验收（无浏览器自动化依赖、自动审批拒绝 localhost 访问、后台 API 进程无法在沙箱中存活），未将浏览器结果写成结论；同步修复的桌面/移动验收为上一轮已记录结论。
- **遗留**：方案 A（复用 `usePracticeSession` 会话式重做）仍为阶段二候选；浏览器竞态场景 A-E 回归、`npm run build:web` 完整构建（本环境沙箱阻止 esbuild 扫描上层目录）、重做/切题后滚动位置复位、答对错因自评交互（P1-03）等另行排期。

### 3.2 修复「刷新掉线」（P1-01）

**问题**：刷新令牌单次轮换 + 客户端并发 401 各自 refresh + 任一失败即清会话 → 长会话/刷新后误判过期。

**方案**：
1. `authenticatedFetch` 增加模块级共享刷新 promise（single-flight）：同一时刻只有一个 refresh 在途，并发 401 请求 await 同一 promise 后用新令牌重试。
2. 刷新失败时**不立即** `clearStoredAuthSession()`：仅在「刷新明确失败且没有其他并发刷新成功」时清理；成功刷新后若 storage 已被并发失败清空，恢复写入新会话。
3. `useAuth` 挂载恢复：失败时进入「可恢复」状态（展示提示 + 保留登录表单），而不是把本地会话静默清掉后显示「登录已过期」；与 `authenticatedFetch` 共用同一刷新 single-flight，避免双重刷新。
4. 服务端可选：refresh 接口对「已撤销/过期令牌」返回可区分错误码（如 401 vs 410），便于客户端区分「并发竞争」与「真正过期」。

**改动范围**：`apps/web/src/api/client.ts`、`apps/web/src/hooks/useAuth.ts`；服务端 `apps/api/src/auth/auth.service.ts`（可选，仅错误码）。

**验收标准**：登录后跨过 15 分钟访问令牌有效期：A) 页面保持操作不断线；B) 任意时刻刷新可恢复会话；C) 恢复成功后继续操作不丢数据。

**风险**：低。注意 JWT 过期与刷新并发是常见陷阱，需用并发请求测试覆盖（如 10 个并发 401 同时触发）。

### 3.3 修正种子题数据（P1-03）

**问题**：q-001 题干缺「Cache 行数」且答案 B 与常规计算矛盾，污染判题与掌握度。

**方案**：
1. 修正题干为「…（Cache 共 8 行）…」并核对答案（29 mod 8 = 5 → C），或直接替换为自洽的种子题。
2. 同步数据库中的存量 Question 记录（若已持久化）；对 `audit`/测试账号产生的错误练习记录标记或清理，避免错误 ground truth 继续污染统计。
3. 增加种子数据校验（构建期/启动期断言：题干必要条件与 `answer` 一致性），防止同类问题回归。

**改动范围**：`apps/api/src/questions/questions.service.ts`、`packages/shared`（如需校验纯函数）、种子/迁移脚本（如涉及数据库）。

**验收标准**：该题判题与数学一致；全链路（练习→掌握度→错题本）引用该题的数据一致。

**风险**：中（涉及存量数据）。需先评估错误记录影响面再决定清理范围，遵守「不执行破坏性迁移」规则。

### 3.4 打通「计划 → 练习 → 完成 → 下一步」（P1-02 / P1-08）

**问题**：「开始」不引导做题；任务进度只认手动表单；练完无下一步。

**方案**：
1. 「开始任务」= 调用现有 `sessions/practice/start` 创建以该任务知识点为范围的练习会话并进入练习工作区（复用 `usePracticeSession`）；「继续今日学习」= 跳转到第一个未完成任务并**直接开始对应会话**。
2. 任务进度联动：练习记录按 `knowledgePointId` 累计到当日任务（新增后端只读聚合，不改表：在 `today/plan` 返回每个任务的 `practiceProgress`——已练题数/正确数/正确率，由 records 实时计算）。
3. 自动完成阈值：任务达成「计划题数 + 正确率 ≥ 阈值」时任务自动 completed（新增可选字段，向后兼容）；手动表单保留为「补录/自评」。
4. 结束态 CTA：练习/会话完成后，按上下文给出一个主按钮：未完成任务 → 「继续今日任务」；有错题 → 「复盘错题」；否则 → 「进入专项练习」。状态文案统一为「当前状态 + 下一步」单行。

**改动范围**：`apps/web/src/App.tsx`、`apps/web/src/components/TodayPlan.tsx`、`apps/web/src/features/student/StudentLaunchpad.tsx`、`apps/web/src/hooks/usePracticeSession.ts`；后端 `apps/api/src/study/study.service.ts`（`today/plan` 聚合字段、任务完成判定）。

**验收标准**：新用户从「今日任务」点开始，直接进入对应知识点练习；做完 12 题且正确率达标后任务自动完成、首页进度更新；练完结束态有明确下一步按钮。

**风险**：中。「自动完成」阈值需要产品确认，避免「系统替你完成任务」的突兀感；字段新增须向后兼容。

### 3.5 考后复习推荐对齐考试内容（P1-04）

**问题**：全对时推荐全局最重知识点；失分时也只按失分点，忽略考试覆盖范围与用户当前阶段。

**方案**：
1. 有失分点：按本场考试 `knowledgePointLosses` 生成 3 天复盘任务（现状逻辑保留）。
2. 全对/无失分点：改为「本场考试覆盖考点的巩固计划」（限时复练 + 间隔复习），若覆盖考点已全部 mastered，则不生成复盘任务并提示「本次考试无失分点，无需额外复盘」，把复习容量还给计划内任务。
3. 推荐理由显式标注来源：「来自本场考试失分点」/「来自薄弱点」/「来自考试覆盖考点巩固」，与 `docs/core-user-flow-audit.md` 的「推荐是否解释原因」检查点对齐。

**改动范围**：`apps/api/src/study/study.service.ts`（`generatePostExamReviewTasksUnlocked`）、报告前端展示字段。

**验收标准**：全对考试不再出现无关考点复习；失分考试推荐 = 本场错题知识点；理由文案写明来源。

**风险**：低。注意 `exam-review-tasks` 已有持久化结构，新增分支不得破坏既有计划兼容（保留 fallback 逻辑）。

### 3.6 复测弹层默认原因 / 免填（P1-05）

**问题**：重做答对后的复测弹层无默认原因，提交按钮禁用，提示文案与行为矛盾。

**方案**：
1. 答对场景不再强制原因自评：默认选中「概念混淆」（或「无需原因」），并允许直接提交；文案改为「本次重做已正确，可补充用时感受」。
2. `ErrorReasonSelector` 增加 `allowEmpty` 模式（答对时允许空原因提交，只记录重做结果与用时）。
3. 与 3.4 联动：复测完成后自动给出下一步（去同考点变式 / 返回错题本）。

**改动范围**：`apps/web/src/components/ErrorReasonSelector.tsx`、`apps/web/src/App.tsx`（reasonPrompt 组装）。

**验收标准**：重做答对后 1 次点击可完成复测提交；不再出现「提示可直接提交但按钮禁用」。

**风险**：低。

### 3.7 答对超时文案（P1-07）

**问题**：`classifyMistake` 对「答对但超时」返回「时间不足」，前端渲染为「本次错因」。

**方案**：答对场景将 `时间不足` 语义改为「用时偏慢」（不改存储字段，仅展示层区分：`correct && mistakeReason === '时间不足'` → 显示「用时偏慢，建议提升速度」）；不把「答对+超时」记入错题本/复习计划（现状已不会入错题本，需保持）。

**改动范围**：`apps/web/src/features/practice/PracticePanel.tsx`、可选 `packages/shared/src/learning.ts`（拆分「错因」与「用时提示」）。

**验收标准**：答对不再出现「错因」字样；答错且慢仍显示「时间不足」。

**风险**：低。

### 3.8 「待复盘」口径统一（P1-06，连带 P2-05）

**问题**：头部/统计卡/首页 KPI/条目徽标四套口径不一致。

**方案**：
1. 定义唯一口径（建议）：`待复盘` = 存在未解决错题（最近一次为答错且未重做正确）；`已复盘` = 已完成一次错因复盘；`重做解决` = 重做正确已出簿。
2. 前端四处在渲染前统一调用同一 summary 计算（后端 `wrong-questions/summary` 收敛字段语义，前端不加自算逻辑）。
3. 空状态按筛选条件区分文案；首页「最近错题」与错题本同源。

**改动范围**：`apps/api/src/study/study.service.ts`（summary 口径）、`apps/web/src/features/mistakes/MistakeWorkspace.tsx`、首页最近错题组件。

**验收标准**：任意数据状态下，头部数字 = 统计卡 = 首页 KPI = 徽标数量总和，且有口径说明。

**风险**：中（涉及既有字段语义，需确认不破坏依赖 summary 的现有前端）。

### 3.9 移动端收敛与体验细节（P2-01/02/03/04/06/07/08）

- 「练习」tab 收敛为单一会话工作区，仪表盘仅保留入口卡（P2-03）。
- 移动端 tab 标签与桌面语义对齐（「答疑」「报告」）或在首屏说明（P2-02）。
- 首页只保留「今日进度 + 一个主操作」，任务卡收敛到计划页（P2-01）。
- 状态文案单行化、互斥（P2-04）；KPI 口径同源（P2-06）；节奏条按天展示真实重点（P2-07）；会话结束提供「再来一组」（P2-08）。

**改动范围**：`apps/web/src/layouts/RoleNavigation.tsx`、`apps/web/src/features/student/StudentLaunchpad.tsx`、`apps/web/src/components/TodayPlan.tsx` 等。

**验收标准**：移动端任一页只有一个主操作；同一指标在首页/错题本/报告数字一致。

**风险**：低（纯展示层，但涉及多处组件，建议随阶段二/三分批复用同一批改动窗口）。

## 4. 明确不做（本轮及建议期）

- 不做视觉重构/设计系统改版。
- 不新增题库内容、不扩展科目。
- 不改数据库表结构（除种子数据修正外，本方案无需新表；任务进度联动用只读聚合实现）。
- 不引入路由库/状态管理库（仓库约定「无路由库、无状态管理库」）。
- 不在生产/预发启用任何 Mock 回退（现有 `apps/web/src/api/env.ts` 的静态演示模式保持原样）。

## 5. 度量方式（上线后验证）

| 指标 | 目标 |
|---|---|
| 「开始任务」→ 首次作答转化 | ≥ 90%（当前为手动表单，几乎为 0 直接做题） |
| 重做流程完成率 | ≥ 95%（当前 P0 阻塞） |
| 刷新/长会话掉线率 | ≈ 0 |
| 今日任务自动完成占比 | ≥ 50% 的完成来自真实练习联动 |
| 「待复盘」口径一致性 | 任一随机数据态下四处数字一致 |

## 6. 落地顺序建议

1. 阶段一（止血 3 项：P0-01 / P1-01 / P1-03）——建议优先，1-2 天内完成。
2. 阶段二（P1-02/08 + 任务联动 + P1-04/05/07）——下一个迭代。
3. 阶段三（P1-06 + P2 批量）——与 UI 改版窗口合并，避免反复改同一组件。

每项改动遵守仓库验证门禁：`npm run check:local`、`npm run build:api`、`npm run build:web`、`npm test`、受影响模块集成测试；改动前按 `docs/development/open-source-reference-check.md` 做参考检查。
