# V10-1 Sprite Core — 契约设计（Phase A）

> 状态：所有者已批准进入 V10-1；本文档为 SpriteState Contract 与 Evidence Contract 的冻结设计。
> 上游：`docs/v10-sprite-product-constitution.md`（§5 情绪模型、§7 数据边界、§8 技术约束）。
> 本 Phase 零编码；Phase B RED 测试与 Phase C 实现均以本文档为唯一依据。

---

## 0. 开源参考检查（AGENTS.md 必选项）

| 参考 | 采纳的模式 | 不采纳的部分 |
|---|---|---|
| [statelyai/xstate](https://github.com/statelyai/xstate)（MIT）与 [Stately 状态图文档](https://stately.ai/docs/xstate) | mood 视为有限状态机的**守卫转移**：有序守卫条件、首中即停、转移纯函数化、可穷举测试 | 不引入依赖；不需要 actor/并发语义 |
| [Game Programming Patterns — State](https://gameprogrammingpatterns.com/state.html) | 任一时刻只有一个状态；状态切换显式可枚举，禁止隐式时间残留 | 游戏帧循环（本场景为请求-响应派生，无帧） |
| [TUM《Development of an Emotion Engine for Games》](https://collab.dvb.bayern/download/attachments/77832785/ibrahim_tum_thesis_master_printable.pdf) | "appraisal（评估）→ mood" 的单向数据流：情绪由对外部事实的评估推导 | 模糊逻辑/OCC 情绪代数（与诚实红线冲突：mood 只能由确定性事实守卫产生） |
| 仓库内先例（最强参考） | `daily-brief.ts`/`progress-narrative.ts`/`proactive-coach.ts`：零依赖纯模块 + 有序裁决 + insufficient_data 透传 + 测试沙箱 loader | — |

结论：以纯函数实现"有序守卫优先级（状态图语义）+ 证据 appraisal"，零新依赖，模式与 V9 教练读模型完全同构。

---

## 1. Evidence Contract（证据契约）

精灵的每个对外表达（mood 与每条台词）都必须携带证据引用；证据指向**派生输入快照内部的确定路径**，前端可展开"为什么这么说"。

```ts
export type EvidenceSource =
  | 'student_context'   // input.context（StudentContext 结构化子集）
  | 'today_plan'        // input.plan（getTodayPlan 派生子集）
  | 'proactive'         // input.interventions（V4 主动干预，切片后）
  | 'progress_story'    // input.story（V9 ProgressStory 派生事实）
  | 'recovery'          // input.plan.recoveredFromGap（断档恢复事实）
  | 'session';          // input.activeSession（进行中会话）

export interface SpriteEvidenceRef {
  readonly source: EvidenceSource;
  /** 输入快照（SpriteStateInput）根相对的点分路径，如 'context.momentum.studyStreak'、'plan.recoveredFromGap'、'interventions.0.headline'（数字段为数组下标）、'context'（允许值为 null——缺席即证据）。 */
  readonly field: string;
  /** 该证据支持的事实性陈述（一句话，禁止渲染未在输入中出现的数字）。 */
  readonly detail: string;
}
```

**完整性规则（测试钉死）**：
1. `moodReason.evidenceRefs.length >= 1` 恒成立（含 idle/unknown——其证据是"已检查的来源集合"，如 `momentum`、`practice.recentAccuracy.status`）。
2. 每条 `line.evidenceRefs.length >= 1` 恒成立（`focused` 态 `lines === []`，无台词即无义务）。
3. 每个 ref 的 `field` 必须在输入快照中**路径存在**（允许值为 null——`context_unavailable` 的证据正是缺席本身；但不允许 undefined/拼写错误）。
4. 台词文本中出现的每个数字必须来自该台词 evidenceRefs 指向的输入字段（模板只做插值，禁止计算新数字；审查方式 = 模板审查 + 台词样册断言）。

---

## 2. SpriteState Contract v1

`GET /sprite/state` 的响应体（`buildSpriteState` 的返回值，控制器原样返回）：

```ts
export const SPRITE_STATE_VERSION = 'sprite-state-v1' as const;

export type SpriteMood =
  | 'recovery' | 'concern' | 'celebrate' | 'rest' | 'streak'
  | 'encourage' | 'focused' | 'idle' | 'unknown';

export type MoodReasonKind =
  | 'gap_recovery' | 'carry_over'            // recovery
  | 'high_risk' | 'medium_risk'              // concern
  | 'progress_gain' | 'evidence_milestone'   // celebrate
  | 'plan_complete'                          // rest
  | 'streak_active'                          // streak
  | 'plan_pending'                           // encourage
  | 'session_active'                         // focused
  | 'no_signal'                              // idle
  | 'insufficient_data' | 'context_unavailable'; // unknown

export interface SpriteLine {
  readonly id: string;            // 稳定 id：`${mood}.${kind}`，用于测试与遥测
  readonly text: string;          // ≤60 字（SPRITE_LINE_MAX_LENGTH）
  readonly tone: 'encourage' | 'firm' | 'warm' | 'neutral';
  readonly evidenceRefs: readonly SpriteEvidenceRef[];
  readonly action?: {
    readonly kind: 'deep_link';
    readonly target: string;      // 前端 hash 分区，如 '#/dashboard'
    readonly label: string;
  };
}

export interface SpriteState {
  readonly version: typeof SPRITE_STATE_VERSION;
  readonly userId: string;
  readonly asOf: string;          // 注入时间（控制器 new Date().toISOString()）
  readonly mood: SpriteMood;
  readonly moodReason: {
    readonly kind: MoodReasonKind;
    readonly detail: string;      // 事实性一句话
    readonly evidenceRefs: readonly SpriteEvidenceRef[];
  };
  readonly presence: {
    readonly visible: boolean;    // V10-1 恒 true（诚实在场；隐藏由前端场景裁决）
    readonly mode: 'normal' | 'quiet';  // quiet = 进行中会话：安静缩小、不弹泡
    readonly reason: string;
  };
  readonly lines: readonly SpriteLine[];   // ≤3；focused 态恒 []
  readonly bond: {
    readonly streakDays: number | null;
    readonly recoveredFromGap: boolean;
    readonly milestones: readonly never[];  // V10-1 恒 []（V10-3 按 quest/ProgressStory 证据填充）
  };
  readonly degraded: {
    readonly unavailableSources: readonly string[]; // 拉取失败的来源名（诚实降级，不伪装）
    readonly contextAvailable: boolean;
  };
  readonly source: 'derived';     // V10-1 恒 'derived'（无 LLM 参与）
}
```

---

## 3. 派生输入快照（buildSpriteState 的输入）

纯函数零依赖；控制器负责把真实读模型映射为以下结构化子集（adapter-at-boundary，同 `daily-brief.controller` 先例）：

```ts
export interface SpriteContextLite {
  readonly momentum: { readonly studyStreak: number };
  readonly practice: {
    readonly recentAccuracy: { readonly status: string; readonly value: number | null; readonly sampleSize: number };
    readonly totalCount: number;
  };
  readonly review: { readonly dueCount: number; readonly overdueCount: number };
}

export interface SpritePlanLite {
  readonly completedTasks: number;
  readonly totalTasks: number;
  readonly recoveredFromGap: boolean;
  readonly carryOverCount: number;         // = recoveredFromGap?.carriedCount ?? 0
  readonly firstOpenTaskTitle: string | null;
}

export interface SpriteInterventionLite {
  readonly id: string;
  readonly trigger: string;
  readonly severity: 'high' | 'medium' | 'low';
  readonly headline: string;               // 逐字复用 V4 模板产物（数字不得重算）
  readonly actions: readonly string[];
  readonly actorHint: 'review' | 'plan' | 'practice' | 'coach';
}

export interface SpriteStoryLite {
  readonly weekDelta: number | null;       // buildProgressStory 的产出（≥2 有效值门已在其内）
  readonly gatesPassed: number;
  readonly resolvedCount: number | null;
  readonly streak: number;
}

export interface SpriteStateInput {
  readonly asOf: string;
  readonly userId: string;
  readonly context: SpriteContextLite | null;    // null = StudentContext 不可用（拉取失败）
  readonly plan: SpritePlanLite | null;
  readonly interventions: readonly SpriteInterventionLite[];
  readonly story: SpriteStoryLite | null;
  readonly activeSession: boolean;
  readonly unavailableSources: readonly string[]; // 控制器记录的拉取失败来源；原样进入 degraded（区分"空"与"失败"，CL-5）
}
```

---

## 4. Mood 裁决（有序守卫，首中即停）

| # | 守卫（按序求值） | mood | moodReason.kind | lines |
|---|---|---|---|---|
| 1 | `context == null` | `unknown` | `context_unavailable` | 1 条透明降级台词 |
| 2 | `activeSession == true` | `focused` | `session_active` | **[]（强制安静）** |
| 3 | `plan?.recoveredFromGap == true` 或 `plan?.carryOverCount > 0` | `recovery` | 二者分别 `gap_recovery` / `carry_over`（同时成立取 `gap_recovery`） | 1 条回流承接台词 |
| 4 | `interventions` 存在 `severity: 'high'`；否则存在 `'medium'` | `concern` | `high_risk` / `medium_risk` | 1 条（top1 干预 headline 逐字） |
| 5 | `story.weekDelta >= 1`；否则 `story.gatesPassed > 0`；否则 `story.resolvedCount > 0` | `celebrate` | `progress_gain` / `evidence_milestone` | 1 条庆祝台词 |
| 6 | `plan.totalTasks > 0 && completedTasks >= totalTasks && review.dueCount == 0 && review.overdueCount == 0` | `rest` | `plan_complete` | 1 条收尾台词 |
| 7 | `momentum.studyStreak >= 3` | `streak` | `streak_active` | 1 条节奏台词 |
| 8 | `plan.totalTasks > 0 && completedTasks < totalTasks` | `encourage` | `plan_pending` | 1 条推进台词 |
| 9 | `practice.recentAccuracy.status == 'insufficient_data' && (plan == null \|\| plan.totalTasks == 0) && studyStreak == 0` | `unknown` | `insufficient_data` | 1 条建档邀请台词 |
| 10 | 其余 | `idle` | `no_signal` | 1 条在场台词 |

**宪法澄清（本契约生效，测试钉死）**：
- **CL-1（focused 语义）**：宪法 §5.2 规定 focused 是"呈现修饰"——落点为：`activeSession` 时 mood 强制 `focused` 且 `presence.mode='quiet'` 且 `lines=[]`（安静即不说话）；被让位的 recovery/concern 在会话结束后的下一次拉取自然浮现。会话内高优先级事件被安静吞掉是**设计意图**（低打扰）。
- **CL-2（idle/unknown 的证据语义）**：其证据 = "已检查无信号"的来源本身（如 `momentum` 已检查、`recentAccuracy.status` 即证据），detail 说明检查结论——证据不必是"阳性事实"，但必须是可指认的字段。
- **CL-3（unavailable ≠ insufficient）**：来源拉取失败（`context==null`）进入 `context_unavailable`，台词明说"这次没读到数据"；**绝不**伪装成新用户 `insufficient_data`（V8 教训：错误不能变成另一种正常）。`degraded.unavailableSources` 记录全部失败来源（student_context/today_plan/proactive/progress_story）。
- **CL-4（story 缺席）**：`story == null`（progress_story 拉取失败）仅禁用 celebrate 档，不影响其他档；`unavailableSources` 记录之。
- **CL-5（interventions 空 ≠ 失败）**：空数组 = "无值得打扰的风险"，正常落入后续档（V9 先例：no risks → quiet）。

---

## 5. Persona 层（sprite-persona.ts）

### 5.1 禁词校验（六类，宪法 §3.3 的可执行版）

```ts
export interface PersonaViolation { readonly category: PersonaViolationCategory; readonly pattern: string; }
export type PersonaViolationCategory =
  | 'comparison' | 'guilt' | 'empty_cheer' | 'anxiety' | 'childish' | 'false_promise';
export const SPRITE_LINE_MAX_LENGTH = 60;
export function validatePersonaCopy(text: string): PersonaViolation[]  // 违规模式命中列表；另含超长检查（category='length'？——否：长度违规单独由 length 违例表示）
```

正则清单（V10-1 冻结；修改须走宪法修订）：

| category | 正则 |
|---|---|
| comparison | `落后|别的同学|其他同学|排名|超过.{0,8}的考生` |
| guilt | `你怎么又|你总是|再不.{0,8}就|辜负|白费|活该|都怪你` |
| empty_cheer | `你最棒|你最优秀|相信自己|加油加油|一定可以|你可以的` |
| anxiety | `来不及|考不上|危险|完了|惨了|告急` |
| childish | `人家|呜呜|主人|棒棒哒|么么|哟~|嘛~` |
| false_promise | `我帮你把|已帮你|已经帮你|我已提升|帮你改好|替你完成|替你学习` |

长度规则：`text.length > SPRITE_LINE_MAX_LENGTH` 记为一次 `{ category: 'length', pattern: 'SPRITE_LINE_MAX_LENGTH' }` 违例。

### 5.2 台词模板目录（V10-1 全量；`buildSpriteLines(mood, reason, input)` 由 `buildSpriteState` 内部调用）

| mood/kind | 模板（数字仅插值） | tone | action |
|---|---|---|---|
| recovery/gap_recovery | `欢迎回来。断档不清零，进度都在。今天从一件小事开始。` | warm | deep-link `#/dashboard` 看今日任务 |
| recovery/carry_over | `欢迎回来。我把 ${carryOverCount} 个未完成任务排回了今天，从第一个开始就好。` | warm | 同上 |
| concern/* | top1 干预 `headline` 逐字；action 按 actorHint：review→`#/wrong-book` 清复习、plan→`#/dashboard` 看计划、practice→`#/question` 去练习、coach→`#/ai` 问教练 | firm | 见左 |
| celebrate/progress_gain | `这周平均掌握度 +${weekDelta} 点——不是感觉，是快照算出来的。` | warm | deep-link `#/test` 看进步叙事 |
| celebrate/evidence_milestone（gatesPassed>0） | `${gatesPassed} 个知识节点的提升通过了证据门槛，稳。` | warm | 同上 |
| celebrate/evidence_milestone（resolvedCount>0） | `重做解决了 ${resolvedCount} 道错题，错误债务在变少。` | warm | deep-link `#/wrong-book` |
| rest/plan_complete | `今天的计划全部完成。到这里就好，明天我照常在。` | neutral | 无 |
| streak/streak_active | `连续学习 ${studyStreak} 天，节奏已经长在你身上。` | warm | 无 |
| encourage/plan_pending | `今天还有 ${openCount} 个任务。从「${firstTitle}」开始就好。`（firstTitle>14 字截断加 …） | encourage | deep-link `#/dashboard` 看今日任务 |
| unknown/insufficient_data | `我还不够了解你——先做一组小练习，我才能真正帮上忙。` | neutral | deep-link `#/question` 去练习 |
| unknown/context_unavailable | `这次没读到你的学习数据。不是你的问题，稍后再试试。` | neutral | 无 |
| idle/no_signal | `我在。想学的时候点我，我随时都在。` | neutral | 无 |
| focused/session_active | （无台词） | — | — |

台词 id 规则：`${mood}.${moodReason.kind}`（每 mood 单台词，`lines.length <= 3` 上限为未来扩展保留）。

---

## 6. 控制器与降级（sprite.controller.ts）

- `GET /sprite/state`，`@UseGuards(RoleGuard)` + `@Roles('student','teacher','admin')`，`resolveUserId` 私有方法逐字复用 `DailyBriefController` 模式。
- DI（构造器，全部追加于末位、可空）：`StudyService`、`StudentContextQueryService`、`ScoreCenterService?`、`EffectivenessService?`、`LearningSignalService?`——全部已在 StudyModule 可注入，零新 provider。
- 每来源独立 try/catch → 失败记入 `degraded.unavailableSources` 并以 null/[] 参与派生（**显式降级，不伪装**）：
  - `student_context` ← `studentContext.getContext(userId)`（失败 → context=null）
  - `today_plan` ← `studyService.getTodayPlan(userId)`（取 `summary`、`priorityTasks[0]?.title`、`recoveredFromGap`）
  - `proactive` ← `learningSignals.getLearningSignals` → `detectLearningRisks` → `deriveProactiveInterventions(...).slice(0, 2)`（失败 → []；**空 ≠ 失败**，CL-5）
  - `progress_story` ← `scoreCenterService?.getMasteryTrend(userId, 14)` + `effectiveness?.getInterventions(userId)` → `buildProgressStory({...})`（V9 同参构造；取 `weekDelta` + 传入 gatesPassed/resolvedCount/streak；任一失败 → story=null，CL-4）
  - `activeSession` ← `context.momentum.recentSessions` 存在 `!completed && lastActiveAt 距 now < 2h` 的会话
- 返回 `buildSpriteState({ asOf, userId, context, plan, interventions, story, activeSession })`。
- 注册：`study.module.ts` controllers 数组追加 `SpriteController`（两行 diff）。

---

## 7. 红线自查清单（实现前声明）

1. 陪伴层非事实源：`buildSpriteState` 纯函数、无副作用、可整体删除。
2. 零迁移、零新表、零 RuntimeState 写入（V10-1 全派生）。
3. 零用户向量记忆（本 Phase 无任何存储）。
4. 零 LLM：`source` 恒 `'derived'`；无 AI_API_KEY 依赖。
5. 全部数字来自既有派生输入（StudentContext / today plan / V4 干预 / V9 ProgressStory），模板只插值。
6. 只读端点；`insufficient_data` / `context_unavailable` 显式区分（CL-3）。

---

## 8. Phase B 测试计划（RED 组）

`test/sprite-state.test.js`（loader：transpile `sprite-state.ts`，require 仅解析 `./sprite-persona` 并同样 transpile 加载，其余依赖 throw——保持零依赖约束可执行）：

1. **9 态 mood engine**：按 §4 表逐档构造 fixture，断言 mood/moodReason.kind/优先级遮蔽（如 recovery 压过 concern、celebrate 压过 streak、rest 被复习债阻断落入 concern 前置条件、focused 强制安静、idle 兜底）。
2. **persona 禁词校验**：六类禁词各给反例样本命中对应 category；全部模板产物（§5.2 目录逐条 + 各 mood 实产 lines）`validatePersonaCopy` 零违例且长度 ≤60。
3. **insufficient_data 降级**：新用户（无计划、零练习、零 streak）→ unknown/insufficient_data + 建档邀请台词；context=null → unknown/context_unavailable + 透明台词；`degraded` 字段逐项断言。
4. **evidenceRefs 完整性**：对全部 10 档输出做契约扫描：moodReason ≥1 ref；每条 line ≥1 ref；ref.source ∈ enum；ref.field 在输入快照上路径存在（含 `interventions.0.headline` 数字段、`context` 为 null 的缺席证据）；lines ≤3、id 规则 `${mood}.${kind}`。
5. **接线契约**（照 V9 #P1 风格的源码断言）：controller 含 `Get('sprite/state')` / `resolveUserId` / `ForbiddenException('You can only access your own data')` / `buildSpriteState(`；`study.module.ts` 注册 `SpriteController`；纯模块零 import（除 sprite-persona 外 require 必 throw）。

全部先写先跑（RED），再实现转绿。
