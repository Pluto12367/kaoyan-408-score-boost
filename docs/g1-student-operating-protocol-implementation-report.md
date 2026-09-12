# G1 Guidance Foundation — Implementation Report

> 日期：2026-09-12 ｜ 性质：**IMPLEMENTATION（G1.1–G1.10）**
> 基线：分支 `feature/v3-product-refactor`，起点 HEAD `7832a5b`
> 事实来源：当前仓库真实代码、Prisma Schema、测试与命令输出（AGENTS.md §1）。
> 设计依据：`docs/student-operating-protocol-design.md`（A–Z 设计 + §38 判定 `PARTIAL`）。

---

## 1. 原问题（G1 要解决什么）

设计审计（§38）判定：一个完全不了解系统的 408 学生**不能**零人工教学自举，因为四个结构性缺陷：

| # | 缺陷 | 证据（修复前） |
|---|---|---|
| 1 | **HOW 完全缺失**：全仓零功能级使用方法 | `Tooltip\|info-icon` grep = 0；错题本「标记复盘」、复习节奏、模考用法均无说明 |
| 2 | **WHY 可能被伪造**：理由码凑数后原样当事实下发 | `priority.ts:111-121` 补齐至 ≥2 → `nodePlan.ts:123` `join` → `TodayMission.tsx:69`「为什么：」 |
| 3 | **VERIFY 错位**：验证语言只在报告页，行为在首页/题库 | `TaskEvidencePanel.tsx:44`（报告 → 总览）vs 完成任务在 `TodayMission` |
| 4 | **系统不会纠偏**：唯一通道是无 `onClick` 的死列表项 | `ProactiveCoachCard.tsx:71-81` 渲染 `<li>`，`actorHint` 前端零消费 |

另有三处产品级缺口：`examDate` 有列无写入方（UI 却宣称"可在个人信息中录入"）、迁移复测默认关闭且只挂报告页、引导行为不可测。

**G1 的目标**：在不新增任何学习状态的前提下，把已有引擎状态翻译成学生可执行的 WHAT / WHY / HOW / VERIFY / NEXT，并让每一步都可验证、可纠正、可度量。

---

## 2. Reason Integrity 修复（G1.1，Owner Decision A1 = APPROVED）

### 2.1 原缺陷

`packages/shared/src/score-center/priority.ts` 的 `buildReasons` 在真实理由不足 2 条时，从通用池按 `breakdown` 分值补齐：

```ts
if (reasons.length < 2) {
  const genericPool = [HIGH_RECENT_FREQUENCY, LOW_MASTERY, REVIEW_DUE]; // 按分值排序
  for (const c of pool) { if (reasons.length >= 2) break; reasons.push(c.code); }
}
```

补齐后的码与真实触发**在结构上不可区分**，于是被 `recommendation.service.ts:245` 直接 `join('、')` 成 `StudyTask.reason`，最终由 `TodayMission.tsx:69` 冠以「为什么：」显示给学生。**系统正在向学生陈述未发生过的原因。**

### 2.2 修复：三档理由分类法

新增 `packages/shared/src/score-center/reason-integrity.ts`：

```text
EVIDENCED_REASON  LOW_MASTERY / LOW_ACCURACY / REPEATED_WRONG / REVIEW_DUE   ← 学生自身观测
INFERRED_REASON   HIGH_RECENT_FREQUENCY / RISING_TREND / PREREQUISITE_GAP     ← 真实内容/考试统计
CONTEXTUAL_FACT   EXAM_NEAR / LOW_EVIDENCE                                    ← 情境，不是原因
fallbackReasons   旧通用池，仅诊断用，永不面向学生
```

- `PriorityResult` 增量返回 `reasonDetails: {code, tier, basis, statement}[]` 与 `fallbackReasons`。
  `basis` 是可机检的依据（`recent3Y.frequency=5 >= 4`），`statement` 是 FACT 式人话。
- **`reasons` 只含阈值真实触发者**，不再补齐 → 允许 0 条或 1 条。
- `resolveShownReasons()` 是**唯一**允许决定"哪些码可以当理由读"的地方：
  `EVIDENCED + INFERRED` → 「为什么推荐」；`CONTEXTUAL_FACT` → 「当前情况」；0 条 → `INSUFFICIENT_REASON_NOTE`。

**§3 示例核对**（任务书给出的正例必须成立）：

```text
为什么推荐：
- 你在该考点上的近期正确率偏低（50%）。        ← EVIDENCED（LOW_ACCURACY）
- 近 3 年真题里这个考点出现了 5 次（高频考点）。 ← INFERRED（HIGH_RECENT_FREQUENCY）
```

**一处需 Owner 确认的解释**：任务书 §2.1 写「第一版推荐 UI 只允许 `EVIDENCED_REASON` 进入"为什么推荐"」，但 §3 的正例第二条（近 3 年考频）本身是内容统计即 `INFERRED_REASON`。两者直接冲突。本实现按**操作性条文**（"禁止 generic filler 伪装成真实原因"）执行：`EVIDENCED + INFERRED` 均可进入理由列表（两者都引用真实事实），`CONTEXTUAL_FACT` 一律移出，凑数码结构性不可达。若 Owner 要求字面执行，只需把 `resolveShownReasons` 的 `tier` 过滤收窄为 `EVIDENCED_REASON`——单点改动。

### 2.3 排序零变化证明

`reasons` 是**输出字段**，不参与排序：`priority.score` 的计算不含理由，`composeDailyPlan` 只用 `candidate.score`。测试断言覆盖：

- `G1.1: removing the filler does not change a single priority score`（同输入重算 bit-identical）
- 既有 `score-center-priority.test.mjs` 的 5 条排序不变式（含 `low-frequency hard point cannot outrank high-frequency weak point in sprint`）全部保持通过
- `recommendation-daily-plan-parity.test.js` 的 **18 字段逐字段 parity** 仍严格通过

### 2.4 学生文案不再泄漏英文码与机器串

`recommendation.service.ts` 新增 `studentReasonText()`：经共享 `REASON_LABELS` 翻译、去重、`；` 连接；空列表时输出诚实句而**不是** `recommendation:${action}`。两处写入点（StudyTask + RecommendationAction）统一走它。

### 2.5 有理由的既有断言更新（2 处，非"改断言凑绿"）

| 文件 | 原断言 | 更新后 | 理由 |
|---|---|---|---|
| `test/score-center-priority.test.mjs:100` | `every result carries at least two reasons` | `reasons are never fabricated to pad the list` | 该断言**正是缺陷的编码**（强制 ≥2 条）。A1 批准后其语义被推翻；新断言更严（逐条 basis 非空 + fallback 不得进入 reasons） |
| `test/recommendation-daily-plan-parity.test.js:214` | `reason: draft.reasonCodes.join('、')` | 镜像修复后的 `studentReasonText` | 这是**测试内 fixture** 转录旧实现；18 字段 parity 断言本身未放宽 |

两处均为**语义随缺陷修复更新**（先例：S1 的"有理由的既有断言更新"）。其余 2400+ 测试零改动。

---

## 3. Today Mission（G1.2，Owner Decision A4 = APPROVED）

### 3.1 首页信息层级收敛

`StudentHome.tsx` 重构为三层，**每个既有组件仍挂载**（既有契约断言全部保留）：

```text
PRIMARY    PrimaryLearningActionCard          ← 唯一填充式主按钮 + 唯一"今天的主行动"标题
SECONDARY  DailyBriefCard / TodayMission / TransferProbeCard(mount="today")
CONTEXT    <details> 折叠：DashboardHero · ProactiveCoachCard · StudentStateCard ·
           StudentActionCard(首页核心行动) · TodaysScoreCenter · TodayPlan · AIInsightCard ·
           QuickActions · LearningTrend · 连击条
```

修复前同屏 ≥7 个并列"下一步"来源且无仲裁者；现在**只有一个**主行动卡携带学习启动按钮。

### 3.2 Today Mission 契约（任务书 §5）

`buildTodayMissionContract()`（纯函数）输出 `TODAY / WHAT / WHY / TIME / VERIFY / NEXT`：

| 输出 | 内容 | 数据来源 |
|---|---|---|
| WHAT | 首个未完成任务（标题/科目/章节） | `todayPlan.priorityTasks` |
| WHY | `resolveShownReasons` 后的 EVIDENCED+INFERRED | 任务 `reasonCodes`（G1.1 修复后可信） |
| 当前情况 | CONTEXTUAL_FACT 单列 | 同上 |
| TIME | `约 N 分钟 · M 题` | 任务 `minutes` / `questionCount` |
| VERIFY | `完成后系统会看：该考点上是否出现新的判分作答，以及掌握度是否变化…包含「证据不足」这一种可能` | `task-evidence` 契约 |
| NEXT | `resolveNextAction()` 结果 + 理由 | 见 §6 |
| 边界 | `COMPLETION_BOUNDARY_NOTE` | 常驻 |

无真实理由时显示：`当前证据不足：这个任务没有触发可解释的推荐原因，系统不会替你编一个。`

---

## 4. HOW Guidance（G1.3）

`packages/shared/src/guidance/guidance-copy.ts` 的 `HOW_GUIDANCE` 覆盖任务书 §6 的 6 个首次场景，每个含 `why / how[] / after` 三段，`how` 每行都**可自检**：

| featureKey | 触发场景 | how 首条（节选） |
|---|---|---|
| `first_diagnostic` | 首次诊断 | 「当前估分」填你最近一次整卷的真实分数；不确定就填保守值 |
| `first_practice` | 首次普通练习 | 每题先选答案并提交，再打开解析 |
| `first_wrong_question` | 首次错题 | 在错因弹窗里选最接近的一项（可跳过，但标了更准） |
| `first_review` | 首次 Review | 不看笔记，先自己回想一遍 |
| `first_transfer_probe` | 首次迁移复测 | 不看解析、一次提交 |
| `first_mock_exam` | 首次模考 | 整卷一次做完，中途不查资料 |

**"首次"不引入第二套状态**（任务书 §17）：前置条件从既有事实派生（`gradedPracticeCount === 0`、`wrongQuestionCount > 0`、`reviewAttemptCount === 0`、`paperSessionCount === 0`…），`resolveFirstUseGuidance()` 每次返回**至多一条**；已读/忽略只是 localStorage UI 偏好（`kaoyan408:guidance.dismissed`，沿用既有 sprite 偏好键约定）。

---

## 5. Verification Guidance（G1.4）

`describeVerification()` 是唯一把"动作结果"翻译成语言的入口，覆盖任务书 §10 的 6 类动作：

| 场景 | 输出 |
|---|---|
| Task completed（无观测） | FACT `任务完成` + INSUFFICIENT_DATA `能力验证：尚未完成——还需要一次能观测到作答的练习。` |
| Practice improved | FACT `练习证据已增加。` + INFERENCE `还需要一道陌生新题来验证迁移——同源题做得好不代表新题会做。` |
| Transfer passed | UNVERIFIED `迁移证据成立：你在一道没见过的新题上做对了。` |
| Transfer failed | FACT `基础练习表现不错，但陌生题迁移仍不足——这是发现，不是失败。` |
| Probe expired | FACT `本次复测窗口已过期。这不是失败，下次学习后还会有新的复测。` |
| No probe available | INSUFFICIENT_DATA `暂时没有合格的新题，系统不会拿旧题冒充迁移测试。` |
| Mock | INFERENCE `这次模考产生了失分清单…它不是你的考试成绩。` |

上屏位置：`PracticePanel` 的「学习影响与推荐依据」区（作答后立刻）、`TransferProbeCard` 结果页、`TodayMission` 完成行 verdict chip（`掌握度 ↑ / 已练习 / 已练·未见提升 / 完成·无作答证据`）与边界句常驻。

---

## 6. NEXT（G1.5）

`resolveNextAction()` 确定性优先级：`mock_just_finished → probe_failed → probe_passed → probe_due → pending_task → review_due → verdict_weak → wrong_questions → no_measurement → none_available`。

- 每个分支指向**真实存在的学生区**（`dashboard / question / wrong-book / test / knowledge-catalog / ai`），由测试枚举断言。
- **不出现"暂无操作"**：`none_available` 携带明确原因 `当前没有足够证据推荐具体动作；系统不会给一个凑数的建议。`
- 上屏：主行动卡（always）、VerificationBanner（每次结果）、TodayMission 列表下方（与主卡同源，不会互相矛盾）。

---

## 7. Behavior Guardrails（G1.6，任务书 §8 的 A–G）

`packages/shared/src/guidance/behavior-signals.ts` 实现 7 个检测器，每个输出 **Detection → FACT → INFERENCE → Correction Action → Verification** 五段（测试逐条断言），阈值全部是预注册常量 `BEHAVIOR_THRESHOLDS`。

| 模式 | 判据（常量） | 纠偏动作（既有入口） |
|---|---|---|
| A 重复旧题 | 样本 ≥8，重复题占比 ≥0.5，新题 ≤5 | 做迁移复测（新题） |
| B 只做简单题 | 样本 ≥10，HARD = 0 且 MEDIUM 占比 <0.3 | 继续训练（中等/困难） |
| C 只看解析 | 会话题量 ≥4 且未提交率 ≥0.5 | 继续训练（补提交作答） |
| D 刷题无验证 | 判分作答 ≥60 且探针 = 0 且测评 = 0 | 做一次阶段测评 |
| E 跳过探针 | `EXPIRED` 探针 ≥3 | 做迁移复测（**不计失败**） |
| F 推荐连续失败 | 同 `(node, actionType)` `NEGATIVE_FEEDBACK` ≥2 | 去错题复盘（换手段） |
| G 掌握度↑无验证 | 节点 attempts ≥5 且该节点无迁移证据 | 做迁移复测 |

**数据来源**：唯一新增后端只读 `PracticePatternService`（`apps/api/src/study/practice-pattern.service.ts`）+ `GET /coach/practice-patterns`（self-only）。

- **只读**：无 `.create/.update/.delete/.upsert`（源码级断言）
- **有界**：每次列表读取都带 `take`（400 attempts / 20 sessions / 50 feedback / 2000 snapshots）
- **委托**：检测与阈值全在共享纯函数，API 不重复实现
- **诚实缺席**：无 `DATABASE_URL` → `storeAvailable: false`，不编造信号
- 节点归因复用 V12.1 的 `resolvePrimaryNodeByQuestion`（直标 → 桥接 → legacy map），避免重犯"直查 tag 表在生产全盲"的缺陷

**E 的边界（需注意）**：S2 形式化设计 §7 规定 `probe_expired` 不是失败、不得产生负面反馈。Owner 在 G1 §8 要求"告诉学生为什么需要完成"。实现取**中性解释**：`有 N 次迁移复测在窗口内没有被提交。` + `这不计入失败，也不影响你的任何记录…`，`priority = P2`，`evidence.countsAsFailure = false`，无任何施压或责备措辞。这是在中性语义内满足 Owner 要求，未推翻 S2 硬规则。

**前置缺陷修复（原审计 R3）**：`ProactiveCoachCard` 由"死的 `<li>`"改为可点击按钮，消费 `actorHint` → 目标区（`review→错题`、`practice→知识/题库`、`plan→首页`、`coach→AI`），无回退时用 hash 路由，并上报 `guidance.accepted`。

---

## 8. Transfer Probe 产品化（G1.7，Owner Decision A5 = APPROVED）

| 项 | 变化 |
|---|---|
| 开关 | `compose.production.yml` 显式 `TRANSFER_PROBE_ENABLED: ${TRANSFER_PROBE_ENABLED:-true}`；`.env.production.example` / `.env.example` 补文档说明（此前三个语义开关在任何模板中均不可发现）。单点解析语义不变：**未设置/未知值仍视为 OFF** |
| `MASTERY_SEMANTICS` | **保持缺席**（不加入 compose 白名单）→ C1 结构性 OFF。测试断言 `process.env.MASTERY_SEMANTICS === undefined` |
| 学生路径 | `TransferProbeCard` 新增 `mount="today"`，挂载在 `StudentHome` 的 SECONDARY 层；报告页保留历史面 |
| 首次教育（§13） | 卡片内一次性说明，取自共享 `HOW_GUIDANCE.first_transfer_probe`：**「这道题是你之前没有见过的同类型题。它不是为了增加刷题数量，而是检查你能不能把刚才学的方法应用到新题。」** |
| 结果页 | 附必显句 **「这次结果会进入你的迁移证据，但不会直接等同于考试分数。」** + NEXT 按钮（答错 → 错题复盘；答对 → 阶段测评） |
| 诚实缺席 | 无 `transfer_probe_pool` 内容时，E2E 证明 `featureEnabled: true` 但 `cards` 中 0 张带会话 → 不降级用旧题；聚合 TransferRate/Gap 学生端仍不下发 |

---

## 9. examDate（G1.8，Owner Decision A6 = APPROVED）

修复前：`User.examDate` 列存在但**全仓无写入方**，而 `remainingDays` 是手填整数并静默成为引擎的 `daysToExam`；UI 却写「可在个人信息中录入」——一个做不到的操作。

| 层 | 实现 |
|---|---|
| 共享纯函数 | `deriveExamDateState({examDate, todayIso})` → `{examDate, remainingDays, daysLabel, source, error, meaningNote, statement}`。严格 `YYYY-MM-DD`、日历合法性（拒 `2026-13-45`）、未来校验、UTC 日粒度差值 |
| API | `POST /coach/exam-date`（`ScoreAnchorController`，`@Roles('student','teacher','admin')`，**self-only**：handler 从不读 body 里的 userId），`ScoreAnchorService.setExamDate()` 用同一共享派生校验并把 `examDate` 与 `remainingDays` **一次写入**，二者不可能漂移；`null` 清除两者 |
| UI | `ExamDateCard`（报告 → 总览，紧跟 `ScoreAnchorPanel`）：先声明日期含义、输入即预览派生结果、区分"未设置/格式错/过去日期"，显示 **`距离考试 X 天`（事实来源 = examDate）** |

**未做（明确边界）**：没有把 `priority` 的 `daysToExam` 输入改成从 `examDate` 实时推导——那会改变排序输入。当前做法是**写入时同步两个字段**，使它们一致且可追溯到 `examDate`，排序公式零改动。若要彻底单一来源，需 Owner 单独批准（属排序输入变更）。

---

## 10. Telemetry（G1.9，Owner Decision A3 = APPROVED）

`TELEMETRY_EVENT_TYPES` 扩展 6 个阶段（受控词表 +6，零 schema）：

```text
guidance.shown · guidance.accepted · guidance.action_started ·
guidance.action_completed · guidance.dismissed · guidance.correction_success
```

- 复用既有 `POST /events` → `UserEvent`；`userId` 来自认证态，payload 仅 `{guidanceId, trigger, action, surface, outcome?, priority?}`。
- 测试断言 payload **不允许出现** `stem / analysis / selectedAnswer / questionText` 等学习内容；未知事件名被拒（E2E 验证 400）。
- `useGuidanceDelivery` 是唯一上报点；`selectForSurface` 经共享 `selectDeliverableGuidance` 实施冷却 / 每面上限 1 / 每日上限 3 / 优先级排序（任务书 §16）。

---

## 11. E2E（G1.10）

`scripts/integration-guidance-protocol.mjs`（新增 `npm run test:integration:guidance-protocol`），真实 HTTP + 真实 PostgreSQL，**13 步全过**：

```text
✓ route-guard         GET /coach/practice-patterns 与 POST /coach/exam-date 未认证 401（注册+守卫）
✓ new-student         无历史 → 0 条行为信号（默认安静）；basis.attempts = 0
✓ reason-integrity    3 个任务的 reason 串不含任何裸引擎码、不含 recommendation: 机器串
✓ exam-date           2026-12-21 → remainingDays 100 派生并落库（DB 两列一致）
✓ exam-date-guards    过去日期 400；非法日期 2026-13-45 → 400
✓ returning-student   A/B/D 三类 guardrail 触发，每条含 detection→explanation→action→verification
✓ probe-expired       3 次过期 → E 信号，countsAsFailure=false，priority=P2
✓ recommendation-failed 2 次 NEGATIVE_FEEDBACK → F 信号，措辞不归咎学生
✓ isolation           B 看不到 A 的信号；跨读 403；跨写不触碰 A 的行
✓ telemetry           6 个阶段全部被 allowlist 接受并落库带 userId；未知事件名 400
✓ state-discipline    无任何 guidance* Prisma delegate；C1 未启用
✓ transfer-probe      featureEnabled=true，0 张卡带会话（诚实缺席，不降级用旧题）
```

任务书 §23 要求的场景覆盖：**new student ✓、returning student ✓、insufficient evidence ✓（D/G 的"无测量"与"证据不足"分支）、probe expired ✓、recommendation failed ✓**。

---

## 12. Regression（回归）

| 门禁 | 结果 |
|---|---|
| `npm run build:shared` / `build:api` / `build:web` | 三端 **exit 0** |
| `npm test` | **2453 tests / 2451 pass / 0 fail / 2 skipped，exit 0**（基线 2406/2404/0/2 → **+47 项零回归**） |
| `npm run test:integration:guidance-protocol`（新） | **13 步 PASSED** |
| `npm run test:integration:score-anchor` | **ALL PASS** |
| `npm run test:integration:score-improvement-loop` | **assertions passed** |
| `npm run test:integration:effectiveness` | **ALL PASS** |
| `npm run test:integration:event-key` | **assertions passed** |
| `npm run test:integration:transfer-probe` | ❌ **PRE-EXISTING（非 G1 回归）** — 见 §12.1 |
| NEW REGRESSION | **0** |

### 12.1 `test:integration:transfer-probe` 的失败归因（PRE-EXISTING，已证）

**现象**：`student A must receive a delivered probe card`（`cards: []`，`featureEnabled: true`，`deliveredCount: 0`）。

**根因**：该脚本的夹具是**时刻相关**的。`scripts/integration-transfer-probe.mjs:104-115` 以 `completedAt = now − 40h` 建干预任务，而探针投递日 = `completedAt 的上海日 + 2`。40 小时在**本地 16:00 之前**跨 2 个日历日、**16:00 之后**只跨 1 个日历日：

```text
本地 15:29 → completedAt 日 2026-09-10 → 投递日 2026-09-12 = 今天 → DUE      ✅
本地 16:29 → completedAt 日 2026-09-11 → 投递日 2026-09-13 = 明天 → NOT DUE  ❌
```

**决定性证据（非推断）**：把所有 G1 改动 `git stash push -u` 后，在**干净 HEAD `7832a5b`** 上重跑该套件 → **完全相同的失败**（`student A must receive a delivered probe card`），随后 `git stash pop` 完整还原（26 modified + 16 untracked 计数一致）。

**处置**：**不修改**。理由：①归因证明为 PRE-EXISTING，非 G1 引入；②Owner 明确要求"不允许为了'全绿'而篡改既有失败"；③该夹具属 S2 交付物，修它超出 G1 范围。**建议**：独立小任务把夹具改为日对齐（例如 `completedAt = 今天 00:30 − 2 天`），或在脚本内固定 `asOf` 时钟。

---

## 13. Known Limitations（已知限制）

1. **`INFERRED_REASON` 仍进入"为什么推荐"**：与任务书 §2.1 的字面要求不完全一致，但与 §3 的正例一致；单点可切换（§2.2）。
2. **理由文案是"无值版"**：`TodayMission` 只拿到 `reasonCodes`（`reasonDetails` 未持久化到 `StudyTask`），因此走的 `buildReasonDetailFromCode` 报阈值而不报学生的具体数值。要报数值需把 `reasonDetails` 落库（增量，未做）。
3. **`first_transfer_probe` 不由 GuidanceLayer 触发**：`FirstUseFacts.probeDeliverable / hasProbeHistory` 在 `StudentHome` 未接入真实来源，故该 featureKey 只由 `TransferProbeCard` 自身的首次说明承担（避免重复）。`first_mock_exam` 的 `paperSessionCount` 同样默认 0，可能在首次模考前就出现（语义上仍是"模考前的正确预期校准"）。
4. **服务端投递状态未持久化**：A2（专属 guidance API）暂缓，故冷却/已读只在 localStorage。清缓存最多导致同一天重复一次提示，**不影响任何学习事实**。跨设备不共享。
5. **`practice.explain_viewed` 未新增**：模式 C 目前用"会话未提交率"代理（零遥测依赖）。精确版（真正区分"打开了解析"）需新增 1 个前端事件。
6. **模式 9（掌握度↑但新题不↑）在个人层不可判定**：样本门 n≥5 与同节点探针间隔 ≥14 天在数学上互斥；学生端只呈现"是否做过迁移复测"，聚合结论保持 teacher/admin。
7. **`TRANSFER_PROBE_ENABLED=true` 尚无可用内容**：生产 `transfer_probe_pool` 为 0 题，故卡片静默、调度记 `no_probe_available`。E2E 已证明这是**诚实缺席**而非错误。要真正投递需内容任务（30 节点 × 2 题）。
8. **`examDate` 未成为排序的唯一来源**：写入时同步 `remainingDays`，公式输入未改（§9）。
9. **未做 G2**：首页 PRIMARY 卡已就位，但次级层仍保留 `TodaysScoreCenter` 的可点击推荐卡（折叠在 CONTEXT 内）；进一步的视觉/交互收敛属 G2。

---

## 14. Exact commits

**本报告生成时：未提交（working tree 待 Owner 批准）。** AGENTS.md §9 规定 Git 写操作仅在明确要求时执行；本任务 §26 的 `commit` 步骤与 Owner 逐次审批的既有惯例冲突，故留给 Owner 决策。

起点：`7832a5b5153148d588ffe8c249fdfde7f07a4f74`（`feature/v3-product-refactor`）

**新增 22 个文件**

```text
packages/shared/src/score-center/reason-integrity.ts
packages/shared/src/guidance/guidance-copy.ts
packages/shared/src/guidance/behavior-signals.ts
packages/shared/src/guidance/today-mission.ts
packages/shared/src/guidance/first-use.ts
packages/shared/src/guidance/exam-date.ts
packages/shared/src/guidance/index.ts
apps/api/src/study/practice-pattern.service.ts
apps/web/src/api/endpoints/guidance.ts
apps/web/src/features/guidance/useGuidanceDelivery.ts
apps/web/src/features/guidance/GuidanceCards.tsx
apps/web/src/features/guidance/GuidanceLayer.tsx
apps/web/src/features/guidance/guidance.css
apps/web/src/features/report/ExamDateCard.tsx
apps/web/src/features/report/exam-date.css
scripts/integration-guidance-protocol.mjs
test/g1-reason-integrity.test.js
test/g1-guidance-protocol.test.js
test/g1-practice-patterns.test.js
test/g1-exam-date.test.js
test/g1-surface-wiring.test.js
```

**修改 26 个文件**

```text
packages/shared/src/index.ts                              （导出 guidance）
packages/shared/src/score-center/index.ts                 （导出 reason-integrity）
packages/shared/src/score-center/types.ts                 （PriorityResult +reasonDetails/fallbackReasons）
packages/shared/src/score-center/priority.ts              （G1.1：停止凑数）
apps/api/src/study/recommendation.service.ts              （studentReasonText：不泄漏裸码/机器串）
apps/api/src/study/canonical-event-writer.service.ts      （+6 guidance 遥测事件）
apps/api/src/study/daily-brief.controller.ts              （+GET /coach/practice-patterns）
apps/api/src/study/study.module.ts                        （注册 PracticePatternService）
apps/api/src/score-anchor/score-anchor.service.ts         （+setExamDate）
apps/api/src/score-anchor/score-anchor.controller.ts      （+POST /coach/exam-date）
apps/api/src/score-anchor/dto/score-evidence.dto.ts       （+SetExamDateDto）
apps/web/src/features/student/home/StudentHome.tsx        （A4 三层层级）
apps/web/src/features/student/home/components/TodayMission.tsx        （诚实 WHY + verdict + NEXT + 边界句）
apps/web/src/features/student/home/components/ProactiveCoachCard.tsx  （actorHint → 可点击）
apps/web/src/features/student/home/components/dashboard-home.css      （层级/下一步样式）
apps/web/src/features/student/StudentSections.tsx         （传 onboardingOutstanding）
apps/web/src/features/transfer-probe/TransferProbeCard.tsx（首次教育 + NEXT + mount）
apps/web/src/features/transfer-probe/transfer-probe.css    （说明区样式）
apps/web/src/features/practice/PracticePanel.tsx          （VerificationBanner）
apps/web/src/features/report/ReportWorkspace.tsx          （挂载 ExamDateCard）
compose.production.yml                                    （TRANSFER_PROBE_ENABLED 显式开启）
.env.production.example                                   （三个语义开关文档化）
.env.example                                              （开关文档化）
package.json                                              （新增 integration script）
test/score-center-priority.test.mjs                       （有理由的断言更新，§2.5）
test/recommendation-daily-plan-parity.test.js             （fixture 镜像修复，§2.5）
```

**建议提交信息**（单一 G1 提交，不 push）：

```text
feat(g1): student operating protocol foundation — reason integrity, single primary
action, contextual HOW, verification, NEXT, behaviour guardrails, probe productization,
examDate entry, guidance telemetry
```

---

## 15. G1 产品验收（任务书 §24）

| 验收项 | 结果 | 证据 |
|---|---|---|
| Reason Integrity | **PASS** | §2；`test/g1-reason-integrity.test.js` 9/9 |
| No fabricated WHY | **PASS** | `resolveShownReasons` 单点过滤 + E2E `reason-integrity` 步骤 |
| Single primary Today action | **PASS** | §3；`test/g1-surface-wiring.test.js` 断言唯一主行动卡 |
| First-use HOW | **PASS** | §4；6 个 featureKey，`test/g1-guidance-protocol.test.js` |
| Practice guidance | **PASS** | §5 VerificationBanner + HOW `first_practice` |
| Review guidance | **PASS** | HOW `first_review`；复习线语义未改 |
| Transfer guidance | **PASS** | §8 首次说明 + `probe-not-score` 必显句 + NEXT |
| Verification guidance | **PASS** | §5；E2E 覆盖"无观测 → 不下能力结论" |
| NEXT guidance | **PASS** | §6；无 `暂无操作`，`none_available` 带原因 |
| Behavior guardrails | **PASS** | §7；E2E 触发 A/B/D/E/F 五类 |
| Transfer Probe visible | **PASS** | §8 `mount="today"` + 开关显式开启 |
| examDate entry | **PASS** | §9；E2E 派生一致性 + 双 400 |
| Guidance telemetry | **PASS** | §10；E2E 6 阶段落库 + 未知事件 400 |
| Cooldown | **PASS** | `selectDeliverableGuidance`；`test/g1-guidance-protocol.test.js` 冷却/上限/优先级 |
| Student isolation | **PASS** | E2E 跨读 403 + 跨写不越界 |
| No second state system | **PASS** | E2E `state-discipline`（无 guidance* delegate）+ 源码边界断言 |
| NEW REGRESSION | **0** | §12（2453/2451/0/2 exit 0；5 个兄弟集成套件全过；1 个 PRE-EXISTING 已证） |

---

## 16. 用户视角最终验收（任务书 §25）

以一个**完全不了解系统的 408 学生**走完整流程，七问回答：

| # | 问题 | 判定 | 学生能在哪里、看到什么 |
|---|---|---|---|
| 1 | 我知道今天做什么吗？ | **YES** | 首页 PRIMARY 卡：`今天的主行动 · 标题 · 科目·章节 · 约 N 分钟 · M 题` + `开始这一步` |
| 2 | 我知道为什么吗？ | **YES** | 同卡「为什么推荐」逐条列出**真实触发**的理由；无真实理由时明说"证据不足，系统不会替你编一个" |
| 3 | 我知道怎么做吗？ | **YES** | 首次使用该功能时内联 `ContextualHowCard`：为什么 / 怎么做才算做对（≥2 条可自检步骤）/ 做完系统得到什么 |
| 4 | 我知道完成意味着什么吗？ | **YES** | 完成态同屏 `完成 ≠ 学会：系统只承认它观测到的判分作答，完成标记本身不构成能力证据。` + 逐任务 verdict chip + `VerificationBanner` |
| 5 | 我知道什么时候算真正学会吗？ | **YES** | 主行动卡「做完之后系统会怎么验证」明写验证条件（含"证据不足"这一种可能）；迁移复测页明写"熟题做对 ≠ 新题会做" |
| 6 | 我知道失败后怎么办吗？ | **YES** | 探针答错 → NEXT「去错题复盘」+ `这是发现，不是失败`；探针过期 → `这不是失败` + 为何需要完成；连续失败 → 「换一种手段」，不重复同一任务 |
| 7 | 我知道下一步吗？ | **YES** | 主行动卡、结果横幅、今日任务列表、探针结果页均带 NEXT 按钮 + 理由；确实无可靠建议时给出**显式原因** |

**结论：七个问题全部 `YES`（在 G1 触及的面上）。** 未达标处已在 §13 逐条列为已知限制，并明确其不阻断这七问。

---

## 17. 最终声明

```text
G1 = COMPLETE

G1 changes user behavior guidance.
G1 does NOT prove score improvement.
G1 does NOT implement ROI ranking.
```

- **未做**：G2 未开始；S3 未开始；ROI/排序公式零改动；mastery 公式零改动；`applyReview` 零语义改动；`MASTERY_SEMANTICS` 未设置（C1 结构性 OFF）；未部署生产；未实现 SP-1；未扩展 AI Agent。
- **未新增**：第二套 Task / Mastery / Evidence 状态；无任何 guidance 专属数据表；无大型 Guidance 后端（A2 暂缓，仅 1 个只读端点 + 1 个写端点）。
- **验证方法学**：所有"未通过"均按 `NEW REGRESSION / PRE-EXISTING / ENVIRONMENT BLOCKER / FIXTURE-DATA GAP` 分类；唯一的失败项已用**干净 HEAD 复现**证明为 PRE-EXISTING，未篡改。

**STOP.**
