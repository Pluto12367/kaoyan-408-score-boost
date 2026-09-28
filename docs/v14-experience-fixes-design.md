# V14 生产体验修复与优化 任务书（体验轮 2026-09-28）

> **Status**: DESIGN GATE — 待 Owner 批准，未实施任何代码变更。
> **任务来源**: Owner 2026-09-28 生产真实学生体验（账号 jackchou，12 站巡检报告）发现的缺陷与优化点。
> **证据口径**: 体验缺陷为生产环境 OBSERVED（真实浏览器一手操作）；修复方案基于代码审计。
> **已完成的生产侧即时修复**（不在本任务书范围，已闭环）：app 容器重启 → 846 题进目录；
> `.env.production` 模型名 `deepseek-v4-flash`→`deepseek-flash` + 重复 AI_API_KEY 占位行清理。
> **详细设计（2026-09-28 追加）**：见本文末尾「落地级详细设计」章节——API 契约、纯模块签名、
> UI 线框、测试计划全部落到文件:行号级；二次审计修正三处（见各 § 开头「审计修正」）。

---

## P1-① 导入后自动刷新题目目录（架构修复，免重启）

### 审计事实（一手）

- `QuestionsService.refreshFromDatabase()` 仅两处触发：`onModuleInit`（启动快照）与
  管理端导入确认链 `import-confirmation.service.ts:58`。
- **脚本导入器（import-real-exams / import-memory-cards / import-questions）不经过确认链**
  → 导入后内存目录陈旧，学生 `GET /questions` 看不到新题（生产实测：846 题导入后目录仅
  328 题，重启才恢复）。真题套卷走 DB 直查不受影响——即同一库内两种视图不一致。
- 内存目录 `this.questions` 是 dev 演示模式的遗留架构；DB 模式下它只是启动缓存。

### 设计

| 项 | 设计 |
|---|---|
| 方案 | **导入器完成后自动触发刷新**：`import-real-exams.mjs` / `import-memory-cards.mjs` 收尾（非 dry-run 且 created+updated>0 时）调用 `POST /admin/questions-directory/refresh`（新端点，admin-only），服务端执行 `questionsService.refreshFromDatabase()` |
| 端点 | `POST /admin/questions-directory/refresh`：RoleGuard admin；返回 `{ refreshed: true, questionCount }`；无 DB 时 503 显式拒绝 |
| 兜底 | 导入器对刷新失败只**警告不失败**（导入本身已成功；提示"重启 app 容器使目录生效"）——刷新是优化不是门禁 |
| 为什么不改成去掉内存目录 | 目录内存镜像被 practice/recommendation 等多条链路同步消费，全量去内存化是大手术（Owner Gate 级），本修复用最小变更消除运维陷阱 |
| 测试 | E2E：admin 刷新端点 200 + 学生目录数量变化 + student 403 + 匿名 401；导入器集成：导入后自动调用刷新（HTTP mock 或真 API） |

### Owner Decision

| # | 决策 | 建议 |
|---|---|---|
| D-F-1 | 刷新端点角色 | admin-only（导入本来就是 admin 动作） |
| D-F-2 | 导入器刷新失败时 | 警告不阻断（导入已成功） |

---

## P1-② AI 答疑"无当前题"前置禁用（防 20 秒超时体验）

### 审计事实（一手）

- `TutorPanel.tsx:53`「讲解当前题」按钮：无当前题时仍可点击 → 前端等待 → 后端
  DeepSeek 调用（25s 超时）→ 学生看到"AI 追问超时或不可用"。
- 后端 `POST /study/ai/tutor-reply` 接受 `questionId`（无题校验靠 DB 查询，非快速失败）。
- 生产实测：无题状态点讲解 → ~20s 超时提示（体验缺陷，非崩溃）。

### 设计

| 项 | 设计 |
|---|---|
| 前端 | `TutorPanel` 无 `currentQuestion` 时：主按钮 disabled + 提示"先去做一道题，AI 讲解针对当前题目"；快捷提问 chips（"用更简单的方式解释…"）同样禁用 |
| 后端 | `createTutorReply` 对不存在的 questionId **立即 400**（DB 直查已有，确认无慢路径），不发起 LLM 调用 |
| 测试 | 源码契约（按钮禁用条件 + 提示文案）；E2E：无效 questionId → 400 且 LLM 零调用（mock client 计数） |

### Owner Decision

| # | 决策 | 建议 |
|---|---|---|
| D-F-3 | 无题时 chips 是否保留可见 | 保留可见但禁用（学生知道做题后能解锁什么） |

---

## P2-③ 体验优化点（体验轮收集，按感知排序）

| # | 优化点 | 现状（OBSERVED） | 方案 | 量级 |
|---|---|---|---|---|
| O-1 | **分区切换加载感**：每区 2-5s"正在加载"，切回已访问区也重新拉取 | 学生目录 ~2.8MB 每次进题库区重新下载 | SWR 式客户端缓存（`staleWhileRevalidate` 轻实现：内存 Map + 60s 复用）；目录数据不变时秒开 | 0.5d |
| O-2 | **练习即时反馈缺失**：选择题点选后无任何"已记录"感（模拟考模式设计使然，但练习流也如此） | 点选后仅高亮 | 练习模式（非 paper）点选后 300ms 内显示"已记录 · 交卷后查看解析"微提示；paper 模式不变（考试语义） | 0.5d |
| O-3 | **今天做什么动作单一**：该学生只见"到期复习"，处方步未出现（finding 不足），引导弱 | 空态/单动作时文案泛 | nothingReason/单动作时追加具体引导（"完成今日复习后，系统会从错题生成训练处方"）；动作卡加"记忆卡到期 N 张"第四源 | 1d |
| O-4 | **首屏文案过长**："这套系统的 7 条使用约定"长文占首屏 | 新用户第一屏被占用 | 折叠为"使用约定（7 条）"details/summary，默认收起 | 0.25d |
| O-5 | **移动端未验证**：学生真实场景大概率手机 | 未测 | 专项移动端体验轮（320-414px 断点巡检 + 触控目标 ≥44px 核查），产出缺陷清单后另立修复 | 0.5d（巡检） |

### Owner Decision

| # | 决策 | 建议 |
|---|---|---|
| D-F-4 | P2 批次范围 | O-1/O-2/O-3/O-4 一批做（~2.25d）；O-5 独立巡检轮 |
| D-F-5 | O-3 是否加记忆卡第四源 | 加（复用 today-actions 纯模块，每源 ≤2 上限不变） |

---

## 实施批次与门禁

```
批次 A（P1，~1d）  ：① 刷新端点+导入器接线  ② tutor 前置禁用
批次 B（P2，~2.25d）：O-1 缓存  O-2 微反馈  O-3 第四源+文案  O-4 折叠
批次 C（独立）     ：O-5 移动端巡检（产出清单，修复另立）
```

- 每批 RULE-01 全链：TDD（纯模块/契约先行）→ GREEN → `npm test` 全量（基线 2720/0）→
  build 双端 → dev 栈真实浏览器目检 → 生产部署由 Owner 按 Runbook 增量执行（无迁移，纯代码）。
- ① 需要一个 additive 端点（零 schema、零语义变更）；② ③ 零后端语义变更。

---

# 落地级详细设计（2026-09-28 追加，Owner 指令）

## D1. P1-① 导入后自动刷新目录 — 详细设计

### 审计修正（二次审计，比上表更精确）

- 刷新服务方法已是 public：`QuestionsService.refreshFromDatabase()`（`questions.service.ts:59`）。
- `QuestionsController`（`@Controller('questions')`）已有 admin-only 先例（`POST /questions`），
  新端点挂同一控制器，路由 `POST /questions/directory-refresh`（避免新开 `/admin` 前缀控制器）。
- 导入器收尾点：`import-real-exams.mjs` 与 `import-memory-cards.mjs` 的 main() 末尾
  （非 dry-run 且 `created + updated > 0` 时才调用——skipped 幂等复跑不触发）。
- 记忆卡导入**不影响题目目录**，但为对称性同样接线（其刷新调用对题目目录无害；未来若加卡片目录
  缓存同理）。**修正**：记忆卡导入器**不接**题目目录刷新（不相关即不调用，避免误导性日志）——
  仅 `import-real-exams.mjs` 与 `import-questions.mjs`（通用题导入器）两处接线。

### API 契约

**`POST /questions/directory-refresh`**（QuestionsController，additive）：

```jsonc
// 请求：无 body
// 响应 201：
{ "refreshed": true, "questionCount": 874, "refreshedAt": "2026-09-28T16:00:00.000Z" }
// 503（无 DB / 演示模式）：{ "message": "存储不可用，目录刷新需要连接数据库", "statusCode": 503 }
// 401 匿名 / 403 student+teacher
```

服务端逻辑（~10 行）：无 prisma → 503；否则 `await refreshFromDatabase()` 后
`{ refreshed: true, questionCount: this.listQuestions().length }`。

### 导入器接线（伪代码，两处同款）

```js
// main() 末尾、process.exit 前：
if (!dryRun && created + updated > 0) {
  const refreshed = await tryRefreshDirectory(); // fetch(`${api}/questions/directory-refresh`, POST, admin token)
  // 失败仅警告：console.warn('⚠ 目录刷新失败（题目已入库）：重启 app 容器后生效。原因：', reason)
}
```

`tryRefreshDirectory` 需要 API 地址与 admin token——从 env 读 `DIRECTORY_REFRESH_URL` +
`DIRECTORY_REFRESH_TOKEN`（可选；未配置则跳过并提示一次性手动 curl，保持脚本零依赖可用）。

### 测试

- 契约：控制器路由存在 + `@Roles('admin')`（源码断言）；导入器包含 tryRefreshDirectory 分支。
- E2E（真实 PG + HTTP，扩 `integration-ai-estimate.mjs` 同款 harness 或独立小脚本）：
  admin POST → 201 且 questionCount 变化；student token → 403；匿名 → 401；
  **演示模式（无 DATABASE_URL）→ 503**。

---

## D2. P1-② AI 答疑无当前题前置禁用 — 详细设计

### 审计修正

- 前置数据源：`StudentSections` 的 `props.currentQuestion: Question`（非空类型——由 App 的
  `activePracticeQuestions[practiceIndex]` 派生；**question catalog 为空时 App 以内置题兜底**，
  实际"无当前题"等价于 `visibleSection==='ai'` 时学生尚未进入练习区）。判定改为
  **`props.practiceAnswerResult == null && props.currentQuestion == null`** 不可靠——修正为
  新增显式 prop `hasActiveQuestion: boolean`（App 侧 = `Boolean(currentQuestion?.id)`），
  不猜内部状态。
- 后端 `createTutorReply`（`study.service.ts`）：`questionId` 查不到题时当前行为 = 抛
  BadRequest（已有）；**审计确认无慢路径**——LLM 调用发生在题目解析之后。后端只需补
  契约测试，不改代码。

### UI 设计（TutorPanel.tsx）

```
无当前题时：
  [🔒 讲解当前题]（disabled，title="先去做一道题，AI 讲解针对当前题目"）
  提示行：<p class="task-status">先去「题库训练」做一道题，AI 讲解针对当前题目展开。</p>
  四个快捷 chips：可见、disabled、opacity .5
有当前题：现状不变
```

Props：`TutorPanelProps` 增 `hasActiveQuestion?: boolean`（缺省 true = 旧行为，向后兼容）；
`StudentSections` 透传；App 计算 `hasActiveQuestion={Boolean(currentQuestion?.id)}`。

### 测试

- 源码契约：`hasActiveQuestion` 分支存在、disabled + 提示文案、chips 受同一开关。
- E2E 不需要（纯前端展示层；后端 400 行为已有契约覆盖，补一条断言即可）。

---

## D3. O-1 分区切换 SWR 缓存 — 详细设计

### 审计事实

- `moduleResource.ts` 只是类型（ModuleResource<T>），无缓存语义；
  `useStudentLearningData.loadResource` 每次调用必置 `state:'loading'` 并重新 fetch
  （`useStudentLearningData.ts:44-56`）——切换分区即重新拉取的全部原因。
- 学生侧重复拉取的大头：overview（含 874 题目录）、practiceSet、wrongSummary、dueReviews。

### 设计：loadResource 加 staleWhileRevalidate 参数（零新依赖）

```ts
loadResource(label, loader, mockFactory, setter, options?: { swrMs?: number })
// 语义：
//   setter 当前 data 存在且 lastSyncAt 距今 < swrMs → 直接返回（不置 loading、不 fetch）
//   否则：立即返回现有 data（不置 loading），后台 fetch，完成后静默更新（state 保持 ready）
//   无 data 时：现状（loading → ready/error）
// 传参：overview swrMs=120000（2min）；practiceSet 60000；wrongSummary/dueReviews 30000
// 失败语义不变：后台刷新失败保留旧 data + console.warn（不弹错误——数据仍可用）；
//   显式 onRetry 回调仍走强制刷新（swrMs=0）
```

改动面：`useStudentLearningData.ts` 的 `loadResource`（~20 行）+ 各 refresh 调用传参；
`useDueReviews`（App.tsx:409）同款接入。**零新依赖、零 API 变更**。

### 测试

- 纯逻辑抽 `shouldServeFromCache(lastSyncAt, now, swrMs)` 小函数单测（fresh/stale/expired/null 四态）。
- 源码契约：loadResource 签名含 swrMs、overview 调用带 120000。
- dev 栈目检：切分区二次进入秒开（Network 面板无重复 /reports/overview 请求）。

---

## D4. O-2 练习模式"已记录"微反馈 — 详细设计

### 审计事实

- `ExamSession`：`sessionType==='paper'` 为考试（isPaperMode:87），其余 practice_set /
  stage_assessment 为练习/测评；选项点击 `handleSelectAnswer`（:181）无任何视觉确认。
- `PracticePanel`（练习主面板，StudentSections:478）是另一条答题流——本次只改 ExamSession
  （真题卷/学习会话流），PracticePanel 的即时反馈链已存在（submitPracticeAnswer 返回 record）。

### 设计

```
handleSelectAnswer 成功后（updateAnswer 调用后）：
  if (!isPaperMode) setShowRecordedToast(true); setTimeout(() => setShowRecordedToast(false), 1200)
UI：题干下方一行 <p class="answer-recorded-toast" role="status">已记录 · 交卷后查看解析</p>
    （淡入淡出 CSS，不位移布局——absolute 定位于题干区右上）
paper 模式：不显示（考试语义：不打断、不暗示）
学习模式（learningMode）：已有即时反馈链，不叠加
```

### 测试

- 源码契约：toast 只在 `!isPaperMode` 分支、role="status"、1200ms 定时清除。
- dev 栈目检：练习卷点选出现 1.2s 微提示；真题卷（paper）无。

---

## D5. O-3 今天做什么第四源 + 引导文案 — 详细设计

### 后端

- `getTodayActions`（daily-brief.controller.ts）并取 `memoryCardService.getDueCount(userId)`
  （方法已在 :146，返回 `number | null`——null = 服务未启用，不产动作）。
- `today-actions.ts` 纯模块扩展（TDD 先行，测试 4→7 例）：

```ts
export interface BuildTodayActionsInput {
  ...
  memoryCards: { dueCount: number | null };  // 新增第四源
}
// 排序：prescription(1) > review_due(2) > memory_due(2.5) > wrong_due(3)
//   —— 记忆卡复习与错题复盘同为巩固类，记忆卡插在前（当日到期的时间敏感性强）
// launch: { type: 'memory_cards' } → 前端跳记忆卡分区
// reason: '按记忆曲线今日到期 N 张'（N = dueCount，只引用证据数字）
// null dueCount / 0 → 不产动作
// nothingReason 增强：有复习源但无动作时 → '完成今日复习后，系统会从错题生成训练处方'；
//   全空 → 现文案不变
```

### 前端

- `TodayActionsPanel`：`launch.type==='memory_cards'` → `onNavigate('memory-card')`
  （section id 已存在）；KIND_LABELS 增 `memory_due: '记忆卡复习'`。

### 测试

- 纯模块：第四源排序/上限（每源≤2 不变、总量≤limit 不变）/null 不产动作/新 nothingReason 分支。
- 契约：面板 KIND_LABELS 与 onNavigate 分支。
- dev 目检：dueCount>0 的学生（jackchou 记忆卡刚自评过，次日到期后可见）出现第四卡。

---

## D6. O-4 首屏七条约定折叠 — 详细设计

- `LearningContractCard`（GuidanceCards.tsx:268）：外层换 `<details className="gd-contract" open={首次}>`，
  `<summary>` = 现头部（「开始之前 / 这套系统的 7 条使用约定」+ 展开 chevron）。
- 默认收起；「开始使用」按钮点击后自动收起（onAccept 现有链路 + details.open=false）。
- 零状态管理（原生 details/summary，无 JS 状态）；CSS 仅补 summary 样式与 chevron 旋转。
- 测试：契约（details/summary 结构 + 默认收起 open 属性缺失）；目检首页首屏高度变化。

---

## D7. O-5 移动端专项巡检 — 执行单（产出物 = 缺陷清单）

- 范围：学生侧 8 分区 × 320/375/414px 三断点；工具 = 浏览器设备模拟（真实生产 URL）。
- 核查项：横向溢出（scrollWidth>innerWidth）、触控目标 ≥44×44、底部导航可达性、
  答题卡 47 格触控、textarea 键盘弹起遮挡、字号 <12px 清单。
- 产出：`docs/audit/mobile-experience-2026-XX-XX.md`（每缺陷：截图路径+复现步骤+建议量级），
  修复另立任务书。巡检本身零代码变更。

---

## 实施顺序与门禁（详细版）

```
批次 A（~1d）  D1 刷新端点+接线 → D2 前置禁用
批次 B（~2.5d）D3 SWR 缓存 → D4 微反馈 → D5 第四源 → D6 折叠
批次 C（~0.5d）D7 移动端巡检
```

每批：TDD（纯模块/契约 RED 先行）→ GREEN → `npm test` 全量（基线 2720/0/2）→
build 双端 → dev 栈目检 → Owner 按 Runbook 部署（纯代码，零迁移零 schema）。
D1 涉及一个 additive 端点（规则 §5 兼容性：零既有路由变更）。
