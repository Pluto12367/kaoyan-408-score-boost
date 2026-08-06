
# UX 问题清单（ux-problem-backlog）

> 审计日期：2026-08-06。所有问题均来自真实浏览器走查（桌面 + 移动 390x844），非静态推断。
> 分类口径：**P0** 无法完成核心学习流程；**P1** 可以完成但操作困难或反馈不明确；**P2** 视觉/一致性/体验细节。
> 状态：open（本轮只审计不修复）。建议修复方向仅作参考，不构成执行。

---

## P0（核心流程断点）

### P0-01 错题「重做」被残留答案结果阻塞，题目与解析错位

- **现象（实测）**：先答任意一题后，进入错题本点「重做」：页面显示错题题干 + 「错题重做模式」徽标，但同屏残留上一次作答的「回答正确 + 解析」（题目 q-001、解析却是 q-002 的 TCP 内容），4 个选项全部 `disabled`，点击无反应。桌面与移动视口均复现。
- **复现路径**：作答任意题（产生结果面板）→ 错题本 → 点「重做」。
- **根因**：`App.tsx` 的 `onRedo`（1386-1392 行）只设置 `redoQuestionId` 并切到 `question` 区，未清 `practiceAnswerResult`；`PracticePanel` 选项 `disabled={submitting || answered}`（`answered = Boolean(answerResult)`）；`handleSubmitAnswer`（502 行）`if (practiceSubmitting || practiceAnswerResult) return`。
- **涉及文件**：`apps/web/src/App.tsx`、`apps/web/src/features/practice/PracticePanel.tsx`。
- **影响**：核心闭环「错题→重做→复测→掌握度」被卡死；用户无法确认错题是否解决，掌握度无法通过重做推动。
- **建议方向**（不执行）：`onRedo`/`onPracticeVariant` 进入前统一 `setPracticeAnswerResult(null)` 并复位 `practiceIndex`/计时；把「重做」改为复用会话式练习（`usePracticeSession`）以彻底消除该状态源。
- **严重度**：P0 / 高
- **状态（2026-08-06）**：已关闭。
  - **修复文件**：`apps/web/src/features/practice/practiceAttemptState.ts`（新增）、`apps/web/src/features/practice/practiceSubmissionGate.ts`（新增）、`apps/web/src/App.tsx`。
  - **同步状态修复**：新增纯函数模块 `practiceAttemptState.ts` 收敛「本次答题尝试状态」（`answerResult / submitting / reasonQueue / redoQuestionId / variantOfQuestionId / index`）；`onRedo`、`onPracticeVariant`、`handleNextQuestion` 三处转换边界统一走 `beginRedo / beginVariantRetest / advanceQuestion` 重置本次尝试状态，不再残留旧结果/错因队列/提交中状态；不改后端、不改 `PracticePanel` 渲染与禁用表达式。
  - **异步旧响应竞态修复（请求门控）**：新增 `practiceSubmissionGate.ts`，`attemptVersion + requestId` 双校验并存于 `useRef` 提供同步占锁；`handleSubmitAnswer` 入口 `tryStartPracticeSubmission` 同步拒绝双击重复提交；`await` 返回后与 `catch` 中所有写回前校验 `isCurrentPracticeSubmission`，过期 token 直接忽略写回；`finally` 仅当 `finishPracticeSubmission` 返回 true 才清除 `practiceSubmitting`（旧 finally 不能清除新请求）；`onRedo / onPracticeVariant / handleNextQuestion / 错因弹层关闭与上报` 共 5 处边界调用 `invalidatePracticeAttempt` 使旧请求失效。
  - **测试覆盖**：`test/practice-redo-reset.test.js`（7 个用例：主流程重做清残留并可再次提交不串状态、答对/答错后重做、重做后直接提交不被阻塞、连续两次重做幂等、错因队列/变式标记清理、App 接线断言、`PracticePanel` 禁用表达式断言）7/7 通过；`test/practice-submission-gate.test.js`（8 个用例：旧响应在重做后失效、旧 finally 不清新请求、双击同步阻止、重做后允许立即新提交、当前请求正常完成、切题/变式连续 invalidate 幂等、App 接线 ≥4 处 invalidate、`PracticePanel` 禁用表达式）8/8 通过。修复前 RED 为模块不存在（ENOENT）；GREEN 后另做 4 项 mutation 验证（`beginRedo` 保留旧结果 / `finishPracticeSubmission` 忽略 token / `invalidatePracticeAttempt` 不清 active / 允许双击），全部被测试捕获并已还原。仓库无 React 集成测试（无 jsdom/RTL），门控以纯模块行为测试覆盖，浏览器级竞态回归仍需真实浏览器验证。
  - **浏览器验收**：同步修复的桌面/移动验收为上一轮已记录结论，本轮未重新执行；异步竞态场景 A-E 在本环境无法执行真实浏览器验收（无浏览器自动化依赖、自动审批拒绝 localhost 访问、后台 API 进程无法在沙箱中存活），未将浏览器结果写成结论，需在正常环境按场景 A-E 回归。
  - **剩余风险**：① 浏览器竞态验收（场景 A-E）未执行，为提交后首要回归项；② `npm run build:web` 在本环境因沙箱阻止 esbuild 扫描上层目录而失败（`tsc --noEmit` 与 `npm run build:api` 通过），需在正常环境重跑完整构建；③ 重做/切题后未重置页面滚动位置——属既有 UX 问题；④ 重做正确后的错因自评仍需用户确认（见 P1-03），不阻塞提交；⑤ 会话式重做重构（方案 A）仍未实施。

---

## P1（可用但体验差 / 反馈不明确）

### P1-01 访问令牌过期后刷新即掉线（长会话/移动端高频打断）

- **现象（实测）**：登录约 15 分钟后（或访问令牌过期后任意时刻）刷新页面 → 回到登录页并提示「登录已过期，请重新登录。」。桌面、移动均复现；走查长会话会被强制中断。
- **复现路径**：登录 → 持续操作超过访问令牌有效期（15 分钟）→ 刷新页面。
- **根因**（代码级）：刷新令牌为**单次轮换**（`apps/api/src/auth/auth.service.ts:46-81`：先撤销旧令牌再签发新令牌）；客户端 `authenticatedFetch`（`apps/web/src/api/client.ts`）在多个并发 401 时**各自独立 refresh**，没有共享刷新互斥（single-flight），后到的刷新拿到已撤销令牌而失败，失败分支直接 `clearStoredAuthSession()`——即使另一个并发刷新已成功写入新会话，也会被连带清掉。`useAuth` 挂载恢复（`apps/web/src/hooks/useAuth.ts`）同样直接 refresh，失败即清会话。
- **涉及文件**：`apps/web/src/api/client.ts`、`apps/web/src/hooks/useAuth.ts`、`apps/api/src/auth/auth.service.ts`。
- **影响**：用户「以为进度丢了」被迫重登；移动端杀进程/切后台再回来即掉线。服务端数据并未丢失，但体验不可接受。
- **建议方向**：客户端增加共享 refresh promise（同一时间只有一个刷新在途，其余请求等待同一结果）；仅在刷新明确失败且无其他请求成功时清会话；挂载恢复失败时先展示可恢复的「会话已过期，请重新登录」而非直接清空。
- **严重度**：P1（接近 P0，移动端核心场景） / 高
- **状态（2026-08-06）**：已关闭。
  - 修复：新增 `apps/web/src/api/refreshGate.ts`（single-flight 共享 Promise，并发 401 只触发一次 refresh，`finally` 释放门控）；`client.ts` 在 401 时若检测到会话已被并发刷新则直接用新令牌重试，失败清会话前校验令牌未被替换；`useAuth` 挂载恢复与自动续期也走同一门控，消除双路径重复消费一次性 refresh token。
  - 测试：`test/refresh-single-flight.test.js` 5 项通过。

### P1-02 「开始/继续今日学习」不进入练习；任务进度与真实练习不联动

- **现象（实测）**：首页点任务「开始」→ 只展开手动表单（完成题数/正确题数/实际分钟/掌握自评）；「继续今日学习」只滚动到计划区。用户做了大量 Cache 练习后，今日任务仍为 0/3、进度 0%。
- **复现路径**：首页 → 「开始」/「继续今日学习」。
- **根因**：`TodayPlan.handleStart` 仅调 `POST /tasks/:taskId/start`（标记进行中）；`App.tsx handleContinueToday`（623-627 行）仅 `setActiveSection('plan')`+滚动；任务完成只认 `POST /study-tasks/:taskId/complete` 手动提交（`study.service.ts:2204-2270`），无任何基于练习记录自动完成/自动进度的逻辑。
- **涉及文件**：`apps/web/src/components/TodayPlan.tsx`、`apps/web/src/App.tsx`、`apps/api/src/study/study.service.ts`。
- **影响**：「今日任务」退化为手动记账，违背「个性化提分」核心价值；用户不知道第一步做什么、不知道练完怎么算完成。
- **建议方向**：「开始」= 带着该任务知识点创建/进入对应练习会话；练习记录按知识点累计到任务进度；达到任务题数/正确率自动完成；手动表单降级为「补录」。
- **严重度**：P1 / 高
- **状态（2026-08-06）**：核心已关闭（自动累计 + 达标自动完成 + 进度展示）。
  - 修复：`packages/shared/src/learning.ts` 新增 `accumulateTaskProgress` 纯函数；`study.service.ts` 在单题提交与会话提交后按知识点累计今日任务进度，达到计划题数自动调用 `completeStudyTask`（复用现有完成/次日调整逻辑）；`getTodayPlan.priorityTasks` 新增 `progress` 字段；`TodayPlan.tsx` 展示「已答 X/Y · 正确 Z」与补录提示；单题/会话提交后刷新今日计划。
  - 遗留：「开始」仍为标记进行中；「继续今日学习」仍定位任务卡而非直达练习会话（会话化跳题见 roadmap 阶段 2）；进度为内存态，与既有 `taskCompletionMetricsByUser` 一致，重启后重新练习即恢复累计，自动完成本身已持久化。
  - 测试：`test/task-progress-auto.test.js` 4 项通过。

### P1-03 种子题 q-001 答案与题干矛盾（数据正确性）

- **现象（实测）**：q-001「直接映射 Cache 中，主存块号 29 应映射到 Cache 的哪一行？」选项 1/3/5/7。题干未说明 Cache 行数；按常规 8 行计算 29 mod 8 = 5（C），但种子答案设为 B（3）。实测选 B 被判「回答正确」，解析仅写「取模」不交代行数。
- **复现路径**：题库训练直接作答该题（或任何引用 q-001 的练习/考试/专项）。
- **根因**：`apps/api/src/questions/questions.service.ts:22-37` 种子数据 `answer: 'B'` 且题干缺少「Cache 共 8 行」等必要条件。
- **涉及文件**：`apps/api/src/questions/questions.service.ts`（以及任何同步该种子的数据库记录）。
- **影响**：判题反馈不可信；掌握度/正确率/薄弱点全部基于错误 ground truth 计算，直接污染提分闭环。
- **建议方向**：修正种子题（补全题干行数条件，答案改 C=5，或换一道题干自洽的题）；对已产生的错误练习记录评估是否需要清理/重算。
- **严重度**：P1（数据正确性，实际影响≈P0） / 高
- **状态（2026-08-06）**：已关闭。
  - 修复：`questions.service.ts` 与 `mockData.ts` 的 q-001 题干补全「共 8 行」，答案改 C（29 mod 8 = 5），解析给出算式；`test/appLogic.test.js` 样例同步；新增 `test/seed-question-consistency.test.js` 防止前后端种子再次不一致。
  - 说明：生产库 326 题来自 `starter-320-questions.csv`，同考点 CSV 题本身自洽，不受影响；历史记录基于旧答案，如需重算另行评估。

### P1-04 考后复习计划推荐与考试内容错位

- **现象（实测）**：模拟考试 2 题全对（100%，考点 Cache+TCP），考试报告后的 3 天复习计划却推荐「树的遍历应用」（考前薄弱点/全局重要性最高知识点），与本次考试完全无关；全对也生成 3 天复习任务。
- **复现路径**：完成一场考试 → 查看报告 → 生成考后复习任务。
- **根因**：`generatePostExamReviewTasksUnlocked`（`study.service.ts:3525-3600`）：`loss = report.knowledgePointLosses[index] ?? report.knowledgePointLosses[0]`，全对时 `knowledgePointLosses` 为空 → 落到 `fallbackPoint`（按重要性排序第一条 = 树的遍历应用）。
- **涉及文件**：`apps/api/src/study/study.service.ts`。
- **影响**：推荐与学习行为脱节，用户对「个性化推荐」失去信任；全对还安排复盘任务，逻辑上自相矛盾。
- **建议方向**：无失分时改为「本场考试覆盖考点的巩固/限时复练」或「不生成复盘任务」；失分时按本场错题知识点生成；推荐理由要写明来源（本场考试 vs 薄弱点）。
- **严重度**：P1 / 中高
- **状态（2026-08-06）**：已关闭。
  - 修复：`generatePostExamReviewTasksUnlocked` 不再回退全局最重要知识点——有失分按失分考点，全对按本场覆盖考点（新增 `collectExamCoveredPoints` 按题序去重）生成限时巩固任务；推荐语与任务 `reason` 明确标注「本场考试失分考点 / 本场考试覆盖考点（全对巩固）」。
  - 测试：`test/post-exam-review-source.test.js` 3 项通过。

### P1-05 重做正确后的复测弹层无默认错因，提交被禁用

- **现象（实测，桌面复现）**：重做答对后弹「你做对了，但答题速度如何？」，无任何原因预选，提交按钮 `disabled`；提示文案却写「如符合可直接提交」，与行为矛盾。专项练习首错流程的弹层（有推断原因）则正常预选。
- **复现路径**：答错 → 提交错因 → 重做答对 → 复测弹层。
- **根因**：`ErrorReasonSelector` 的初始值 `useState(() => normalizedInferred ?? '')`；重做答对记录经 `classifyMistake` 通常返回 `null`（非超时/非蒙题），`App.tsx` 传 `inferredReason={reasonPrompt.mistakeReason ?? null}` → 无默认值 → `disabled={!reason || submitting}`。
- **涉及文件**：`apps/web/src/components/ErrorReasonSelector.tsx`、`apps/web/src/App.tsx`（reasonPrompt 组装处）。
- **影响**：复测被一个多余交互卡住；用户不知道必须手动选一项才能提交。
- **建议方向**：答对场景默认选中「概念混淆/已完成复盘」或提供「无需原因」选项；或答对场景不再强制自评，改为可选。
- **严重度**：P1 / 中
- **状态（2026-08-06）**：已关闭。
  - 修复：`ErrorReasonSelector` 答对场景默认选中「已完成复盘」（自由文本落 `selfReportedReason`，不影响 8 类错因统计），弹层标题改为「重做已答对，确认本次复盘结果」；配合 P1-07 后 `classifyMistake` 对答对题不再返回「时间不足」。
  - 测试：`test/error-reason-default.test.js` 通过。

### P1-06 「待复盘」口径同屏不一致

- **现象（实测）**：错题本同屏显示：头部「1 道待复盘」、统计卡「0 待复盘 / 1 已复盘 / 0 重做解决 / 1 当前错题」、条目徽标「已复盘」；首页 KPI「待复盘 0 题」与错题本头部不一致。
- **复现路径**：产生一条新的错题记录后查看错题本。
- **根因**：`待复盘/已复盘/重做解决/当前错题` 四套语义由不同查询/状态推导（wrong-question summary 与 list 口径不同），且同一题被同时计入「已复盘」与「当前错题」。
- **涉及文件**：错题本前端（`MistakeWorkspace` 及 summary 接口 `wrong-questions/summary`）、`apps/api/src/study/study.service.ts`（`listWrongQuestions` 与 summary 推导）。
- **影响**：用户无法确认自己「还有几道要复盘」，信任受损。
- **建议方向**：统一为一个权威口径（推荐：`待复盘 = 存在未解决/待重做的错题`），头部/统计卡/首页 KPI/条目徽标共用同一计算函数；展示定义或图例。
- **严重度**：P1 / 中
- **状态（2026-08-06）**：已关闭。
  - 修复：错题本头部「N 道待复盘」改为与统计卡、首页 KPI 同源的 `summary.pendingCount`（不再用全量 `wrongQuestions.length` 标注为待复盘）；空态与筛选空态文案已区分。
  - 测试：`test/wrong-review-metrics.test.js` 2 项通过。

### P1-07 答对但超时仍显示「本次错因：时间不足」

- **现象（实测）**：选 B（被判定正确）后，结果面板同时显示「回答正确」与「本次错因：时间不足」，正确/错误反馈矛盾。
- **复现路径**：任何「答对但用时 > 期望时长×1.45」的提交。
- **根因**：`classifyMistake`（`packages/shared/src/learning.ts:66-92`）对 `correct && slow` 返回「时间不足」，前端 `PracticePanel` 无条件渲染 `answerResult.mistakeReason` 为「本次错因」。
- **涉及文件**：`packages/shared/src/learning.ts`、`apps/web/src/features/practice/PracticePanel.tsx`。
- **影响**：用户困惑（答对了哪来的错因）；若继续按错因入复习计划会造成错误复习。
- **建议方向**：答对场景将「时间不足」降级为「用时偏慢」提示而非「错因」；前端按 `correct` 区分文案。
- **严重度**：P1 / 中
- **状态（2026-08-06）**：已关闭。
  - 修复：`classifyMistake` 对答对题一律返回 `null`（保留「蒙题」特例）；共享新增 `isSlowAnswer`；`PracticeAnswerResult` 透传 `timeSpentSec/expectedTimeSec`；`PracticePanel` 答对且超时展示「用时偏慢」提示，「本次错因」仅在答错时渲染。
  - 测试：`test/appLogic.test.js`、`test/practice-slow-feedback.test.js` 覆盖。

### P1-08 题库练完后无「下一步」按钮，只有矛盾的状态文字

- **现象（实测）**：单题模式答完最后一题，结果区显示「当前题库已练完，可开始专项练习或前往错题本。」——纯文本无按钮；同时残留「回答正确，已记录本次练习，可继续下一题。」两条状态并存。
- **复现路径**：题库训练答完所有题。
- **根因**：`PracticePanel` 无 `hasNextQuestion` 时只渲染 `<span>` 提示；`practiceStatus` 未随答题结束更新。
- **涉及文件**：`apps/web/src/features/practice/PracticePanel.tsx`、`apps/web/src/App.tsx`（状态串更新）。
- **影响**：练习结束后的下一步全靠用户猜。
- **建议方向**：结束态提供明确按钮（去专项练习 / 去错题本 / 完成今日任务），状态文案互斥收敛。
- **严重度**：P1（与 P1-02 同源，可合并修复） / 中
- **状态（2026-08-06）**：已关闭。
  - 修复：`PracticePanel` 状态区与答案结果面板互斥（结果面板显示时不再叠加状态文本）；练完后的下一步由下方「开始专项练习（训练模式）/ 学习模式」按钮承接，提示文案指向具体入口。

---

## P2（视觉/一致性/体验细节）

### P2-01 首页与「今日计划」重复渲染整套任务卡
- **现象**：首页（学生工作台）与 plan section 均渲染整套 TodayPlan（含「开始/延后/完成并调整计划」按钮）；首页 hero 与计划区信息重叠。
- **涉及文件**：`apps/web/src/features/student/StudentLaunchpad.tsx`（首页）、`apps/web/src/components/TodayPlan.tsx`、`apps/web/src/App.tsx`。
- **建议**：首页只保留「进度 + 一个主操作」，完整任务卡收敛到计划页。
- **状态（2026-08-06）**：已关闭。移除 `StudentLaunchpad` 对整套 `TodayPlan` 的渲染（含未使用的导入），首页只保留 hero 进度 + 主操作 + KPI，任务卡仅存在于 plan section；`test/p2-info-architecture.test.js` 固定该行为。

### P2-02 移动端底部导航标签语义困惑
- **现象**：底部 5 tab 为 首页/学习/练习/错题/我的；其中「学习」= AI 答疑、「我的」= 提分报告，与桌面导航（AI 答疑/提分报告）不一致，新用户无法预判内容。
- **涉及文件**：`apps/web/src/layouts/RoleNavigation.tsx`（移动端 tab 配置）。
- **建议**：移动端标签与桌面语义对齐（如「答疑」「报告」），或保持「学习/我的」但首屏内说明。
- **状态（2026-08-06）**：已关闭。移动端 5 tab 改为「首页/答疑/练习/错题/报告」，与桌面「AI 答疑/提分报告」语义对齐；`test/mobile-nav-ui.test.js` 与 `test/p2-ux-cleanup.test.js` 同步。

### P2-03 移动端「练习」tab 双重题目区域
- **现象**：移动端「练习」tab 同时渲染仪表盘题库面板（单题模式）与会话工作区（专项练习），页面出现两个题目区域，主操作不唯一。
- **涉及文件**：`apps/web/src/features/student/StudentLaunchpad.tsx`、`apps/web/src/App.tsx`（section 渲染逻辑）。
- **建议**：移动端「练习」tab 收敛为单一工作区（会话模式），仪表盘只保留入口卡片。
- **状态（2026-08-06）**：已关闭。会话工作区为全屏遮罩（`exam-workspace-overlay` position:fixed inset:0，移动端 padding:0 全屏），活动会话期间不会出现双题目区；练习页仅保留单题面板 + 推荐题组入口卡。测试固定遮罩行为。

### P2-04 状态文案多条并存、互相矛盾
- **现象**：同一屏出现「回答正确，已记录本次练习，可继续下一题。」与「当前题库已练完……」；「本次错因」在答对时也出现。用户无法区分当前状态。
- **涉及文件**：`apps/web/src/features/practice/PracticePanel.tsx`、`apps/web/src/App.tsx`。
- **建议**：状态区收敛为单一「当前状态 + 下一步动作」行。
- **状态（2026-08-06）**：已关闭。`PracticePanel` 有答案结果时不再渲染 `practice-status`，两条状态文本不再并存。

### P2-05 空状态与数据矛盾
- **现象**：错题本统计卡有「重做解决 1」，主区却显示「错题本还是空的，答错的题目会自动出现在这里。」；首页「最近错题：暂无近期错题」与错题本数据不一致。
- **涉及文件**：`apps/web/src/features/mistakes/MistakeWorkspace.tsx`、首页最近错题组件、`apps/api/src/study/study.service.ts`（summary）。
- **建议**：空状态按过滤条件区分（「当前筛选下无待复盘错题」vs「从未有过错题」）；首页最近错题与错题本同源。
- **状态（2026-08-06）**：已关闭。有「重做解决 N」历史时空态改为「当前没有待处理错题，历史已通过重做解决 N 道」，与统计卡一致；筛选空态保持「没有符合当前筛选条件的错题」。

### P2-06 KPI 数字口径不一致
- **现象**：首页「预计提分 +12」vs 报告「预计提分空间 14 分」；今日任务「剩余约 135 分钟」vs 冲刺计划「180 分钟/天」；「正确率」与「掌握度」混用。
- **涉及文件**：`apps/web/src/features/student/StudentLaunchpad.tsx`、报告面板、`apps/api/src/study/study.service.ts`（overview/plan 计算）。
- **建议**：统一指标口径（提分空间/掌握度/时长），同源计算并注明定义。
- **状态（2026-08-06）**：已关闭。首页 KPI 改「预计提分空间 X 分」（与报告 metrics grid 同 label/格式/来源），helper 注明「基于薄弱点和目标分估算（与报告口径一致）」；结论卡「本周预计提升」改名「预测分数」与指标卡统一；冲刺计划每日标注「计划 X 分钟」区分「今日剩余约 X 分钟」；科目卡已明确「平均掌握度」。

### P2-07 首页「本周学习节奏」每日雷同
- **现象**：7 天节奏条每天都是「第 3 项任务 · 0/3 已完成 · 135 分钟」，信息无差异；「每天只盯一个重点」标题与展示不符。
- **涉及文件**：`apps/web/src/features/student/StudentLaunchpad.tsx`、`apps/api/src/study/study.service.ts`（weekProgress）。
- **建议**：按天展示当天重点任务标题与进度，而非全部雷同的 0/3。
- **状态（2026-08-06）**：已关闭。`getSevenDayPlanSummary` 每天返回 `focusTitle/focusCompleted`（当日最高优先级任务），首页「本周学习节奏」与今日计划周条按天展示重点任务标题。

### P2-08 移动端练习会话结束后无「重新开始」
- **现象**：专项练习提交完成后，会话工作区不提供「再来一组/重新开始」，停留在结果态；练习 tab 单题模式答完后也无重开入口（同 P1-08）。
- **涉及文件**：`apps/web/src/hooks/usePracticeSession.ts`、`apps/web/src/features/student/StudentLaunchpad.tsx`。
- **建议**：完成后提供「再来一组（同知识点）」入口。
- **状态（2026-08-06）**：已关闭。`practiceAttemptState.ts` 新增 `restartAttempt`；专项练习结果区提供「再来一组（同知识点）」按钮（重开同一题组会话），单题题库末提供「重新练习本组」；`test/practice-restart.test.js` 覆盖。

---

## 汇总统计

| 级别 | 数量 | 编号 |
|---|---|---|
| P0 | 1 | P0-01 |
| P1 | 8 | P1-01 ~ P1-08 |
| P2 | 8 | P2-01 ~ P2-08 |

截至 2026-08-06：P1-01 ~ P1-08 全部关闭（其中 P1-02 为核心已关闭，会话化跳题仍属 roadmap 阶段 2）；P2-01 ~ P2-08 全部关闭（P2-03 为行为验证关闭，无代码改动）。

优先修复顺序建议：P0-01 → P1-01 → P1-02/P1-08 → P1-03 → P1-04 → P1-05/P1-06/P1-07 → P2 批量收敛（详见 `docs/core-loop-improvement-plan.md`）。
