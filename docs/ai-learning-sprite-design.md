# AI Learning Sprite（AI学习精灵）产品设计

> 状态：ARCHITECTURE BASELINE（架构与规划基线；产品决议见 `docs/v10-sprite-product-constitution.md`，本文档未改任何代码）
> 日期：2026-09-07
> 前置阅读：`docs/current-sprint.md`、`docs/v9-baseline-audit.md`、`docs/px-ai-learning-companion-final-report.md`、`docs/v8-student-experience-state.md`

---

## 0. 命名决议（已确认 2026-09-07）

仓库中 **V9 编号已被占用并关闭**：V9 Learning Experience OS（AI 考研教练）Phase 1-6 已全部落地并部署生产（`/coach/daily-brief|proactive|progress-narrative|experiment-assignment|feedback-insight`，见 `docs/current-sprint.md` 2026-09-07 条目，生产复测 PASS，"V9 Mission 关闭"）。`docs/v9-baseline-audit.md` 中"Phase 4-6 仅有预案"的表述已过时，以代码为准。

**所有者已确认：本 Mission 编号 V10**（AI Learning Sprite Experience Layer），产品名 **AI Learning Sprite（AI学习精灵）**，精灵人格定为「星野」。产品宪法（人格规则/情绪模型/MVP 边界/数据边界/Success Metrics）见 `docs/v10-sprite-product-constitution.md`；本文档保留架构分析、复用清单、风险分析与 Milestone 依据。

---

## 1. 产品定位

### 1.1 一句话

在现有 408 提分闭环之上新增一个**人格化产品层**：不是聊天机器人，而是「AI老师（已有）+ 学习伙伴（新建）+ 宠物人格载体（新建）」，用有真实依据的情感化表达提高学习**主动性、持续性和情感连接**。

### 1.2 三个角色的现状差距

| 角色 | 现状 | 差距 |
|---|---|---|
| AI 老师 | 已完备：Tutor Mode 苏格拉底序列、RAG V2、Exam Simulator、Contextual Coach、Supervisor 四意图路由 | 无需新建，只需更好的触达 |
| 学习伙伴 | 半成品：DailyBrief/ProactiveCoach/ProgressStory 有教练内容，但全是**被动内嵌卡**，藏在高滚动首页里；无对话入口聚合、无回流承接的"人"的温度 | 主动性触达形态 + 伙伴口吻 |
| 宠物人格载体 | 空白：无任何全局常驻人格、无状态表情、无成长/羁绊、无陪伴仪式 | 全新层 |

### 1.3 证据（为什么做）

- V8 审计（`docs/v8-student-experience-state.md`）：真实用户使用呈**碎片化爆发式**（一天 48 题、其余日近 0），连续学习 0 天——回流是高频场景，却没有"人"来承接；首页 15+ 模块长滚动，教练内容被淹没。
- V9 交付的教练能力全部是**拉模式内嵌卡**：ProactiveCoachCard 无风险时静默、有风险也只是一张卡，没有常驻入口让学生"感到被看见"。
- V8 确认全产品解释性最佳实践是错题页"推荐依据面板"（透明→信任）。精灵应继承"每个表达都有依据"的既有基因，而不是另起炉灶。
- 业界参考（本次检索）：Duolingo 的 Duo 本质是"戴着吉祥物面孔的留存机制"——表情映射用户状态、推送带人格、调侃而非说教、有 streak freeze 等逃生阀；同时用户研究警告 **streak 罪感化会让练习变得表演化**（为了喂宠物而学），这与本仓库"诚实/insufficient_data"红线直接冲突，必须从设计上排除。

### 1.4 非目标（反目标）

- 不是新聊天机器人：对话能力复用 Supervisor/Tutor，精灵不自建对话栈。
- 不做罪感化/ guilt-tripping 驱动（骂醒式催学、损失恐吓）：与诚实红线冲突。
- 不做无事实依据的空洞鼓励（"你最棒！"）：每句话必须可追溯到真实学习事实。
- 不做推送/通知渠道（backlog #48 明确推送后置，先站内）：精灵是站内常驻，不是消息系统。
- 不新增事实源、不动 StudentState/Mastery/RAG/Agent/Effectiveness 架构、不建新表。

---

## 2. 现状架构分析（Sprite 视角）

### 2.1 分层现状

```
┌─ 产品面（前端）────────────────────────────────────────────┐
│ StudentHome 卡片流：DailyBriefCard / ProactiveCoachCard /   │
│ StudentActionCard / TodayMission ...（全部内嵌、被动、易淹没）│
│ 'ai' 分区：TutorPanel（题目讲解场景）                        │
│ 场景内嵌：ContextualCoach ×4 挂载点（题/错题/节点/测评）      │
├─ 教练读模型（V9 已交付，StudyModule）───────────────────────┤
│ /coach/daily-brief（纯模板 DailyBrief）                     │
│ /coach/proactive（signals→risks→interventions，slice(0,2)） │
│ /coach/progress-narrative（周环比叙事，有基线才说）          │
│ /coach/experiment-assignment（sha256 确定性分流）            │
├─ AI 能力层（PX/V3.4 已交付）───────────────────────────────┤
│ /agent/supervisor/run（tutor|plan|exam|coach 四意图）        │
│ /ai/contextual-coach（Coach Session Memory，RuntimeState）  │
│ /agent/study/run|plan、/agent/daily/plan、/agent/exam/*     │
│ /rag/knowledge/v2/search、Safety Guard、Learning Memory     │
├─ 事实与状态层（冻结，唯一 SoT）────────────────────────────┤
│ StudentContext v1（唯一 canonical 读边界，只读派生）         │
│ PracticeRecord/UserKnowledgeMastery/WrongQuestionReview/    │
│ ReviewSchedule/StudyPlan+StudyTask/UserEvent（幂等脊柱）     │
│ Mastery 唯一写方 = ScoreCenterService.applyAttempts/Review  │
│ Effectiveness 四端点（V6.3，只读派生）                       │
└────────────────────────────────────────────────────────────┘
```

### 2.2 关键事实

1. **教练素材已齐全**：精灵要说的每类话（今天干什么/风险提醒/进步叙事/考试倒计时）都有现成派生读模型，精灵层只需做**人格化组织与常驻呈现**，不需要新的事实计算（考试倒计时 #16 除外，属 V8 backlog 既有项）。
2. **LLM 当前 402 计费 blocked**（`docs/v34-remote-llm-blocker.md`）：所有 AI 面靠确定性模板回退在运行。精灵必须**模板优先**，LLM 只做语言组织锦上添花——这与红线完全一致，且让精灵不依赖外部计费即可上线。
3. **前端无常驻全局层**：App.tsx（1777 行）是唯一常驻壳，无路由库；窗口事件总线（`daily-brief:refresh`、`auth-session-updated`）是既定跨组件通信惯例。精灵悬浮层在 App.tsx 有明确挂载位（workspace 结束后、全屏考试层之前，与 StudentBottomNav 平级）。
4. **无新表先例**：Coach Session Memory 存 RuntimeState KV（`coach-session:{userId}`，可丢弃重建、永不复制学习事实）——精灵羁绊状态若需持久化，照此先例。
5. **测试基线**：1925/1923/0 全绿（2026-09-07）；部署在腾讯云 2C2G 单实例。

### 2.3 版本命名冲突结论

新 Mission 的自然演进位置 = V9（教练）之上的**人格与触达层**。建议版本号 **V10**；V9 编号保持历史含义不变，避免 current-sprint 账本与文档体系混乱。

---

## 3. 复用能力清单

### 3.1 后端（全部只读复用，零改动）

| 能力 | 位置 | 精灵用法 |
|---|---|---|
| StudentContext v1 | `study/student-context.query.service.ts` | 精灵状态推导的唯一学生输入（掌握度/动量/计划/复习/风险） |
| DailyBrief | `study/daily-brief.ts` + `/coach/daily-brief` | "今天"话术的事实底座（headline/priorities/followUpNote） |
| Proactive interventions | `adaptive/proactive-coach.ts` + `/coach/proactive` | 主动提醒内容源（自带 evidence + slice(0,2) 频次上限） |
| 风险检测 | `adaptive/learning-risk.ts`（6 类） | 精灵"担忧表情"的触发器（evidence-based，LLM 不参与） |
| ProgressStory | `study/progress-narrative.ts` + `/coach/progress-narrative` | 进步庆祝话术（有基线才庆祝） |
| Learning Memory brief | `agent/learning-memory.ts`（≤900 字纯派生） | 三水平个性化语气素材（如需要） |
| Coach Session Memory | `study/coach-session.repository.ts`（RuntimeState） | 精灵对话延续既有会话（不新建会话存储） |
| Supervisor | `agent/supervisor.service.ts` | 精灵面板对话的统一路由（tutor/plan/exam/coach） |
| Safety Guard | `agent/agent-guard.ts` | 对话复用既有注入防御与引用契约 |
| Effectiveness | `effectiveness/*` 四端点 | 精灵效果度量的归因底座（correlation ≠ causation） |
| coach-experiments | `study/coach-experiments.ts` | 精灵 A/B 分流（确定性 sticky，只贴标签） |
| UserEvent + trackEvent | `POST /events` + `api/events.ts` | 精灵交互遥测（allowlist 内新增类型需走契约） |
| resolveUserId/assertAccess | `study.controller.ts` 模式 | 新端点权限沿用 |
| AiTutorLog | `AiTutorLog` 表 | LLM 组织语言的调用审计（失败也记录） |

### 3.2 前端（复用 + 少量挂载）

| 能力 | 位置 | 精灵用法 |
|---|---|---|
| App.tsx 常驻壳 | `App.tsx` L1650 附近 | 悬浮精灵唯一挂载点（学生角色 && 非考试会话） |
| UI 原语 | `components/ui/`（GlassCard/SurfaceCard/ProgressRing/EmptyState） | 精灵面板容器，零业务状态只消费语义 token |
| 窗口事件总线 | `daily-brief:refresh` 模式 | 精灵刷新/主动弹泡的跨组件通信 |
| AIVisual 视觉语言 | `features/auth/AIVisual.tsx` + `dashboard-ai-orbit` | 精灵形象的轨道/核心视觉语汇（现有最接近吉祥物的资产） |
| DESIGN.md v2.0 token | 根目录 `DESIGN.md` | AI 强调色只复用 `--primary`，不引入第二品牌色 |
| themePreference | `theme/themePreference.ts` | 四主题下精灵配色自动成立（纯 token 级联） |
| 学生身份/竞态守卫 | `useStudentContextData.ts` 模式 | 账号切换即清精灵状态、请求序号防过期覆盖 |
| 断档恢复/时长预算 | missed-day-recovery、`?minutes=` | 精灵回流话术的事实来源（"回来啦，从这里继续"） |

---

## 4. 新增模块设计

### 4.1 总体原则

- **精灵 = 纯派生读模型 + 人格文案层 + 常驻呈现层**。它不是事实源，不是记忆库，不是推荐器；可随时删除，删除后系统行为不变（仅少一个 UI 层）。
- 每句精灵台词必须携带 `evidenceRefs`（指向 StudentContext 字段/brief/risk id），前端"为什么这么说"可展开（继承推荐依据面板模式）。
- `insufficient_data` 贯穿：证据不足时精灵说"我还不够了解你"而不是编内容——**这在人格层反而是情感资产**（诚实=可信任）。

### 4.2 后端：SpriteModule 内容（注册进 StudyModule，仿 daily-brief 先例）

新增文件（全部只读派生，无迁移、无新表）：

```
apps/api/src/study/
  sprite-state.ts            # 纯函数：SpriteState 派生（核心，确定性，禁 Date.now()/Math.random() 以外副作用，时间注入）
  sprite.controller.ts       # GET /sprite/state（resolveUserId 权限模式）
  sprite-persona.ts          # 文案模板层：mood+facts → 中文台词（纯模板，LLM 可选后缀）
```

**SpriteState 契约草案（v1，只读）：**

```ts
{
  version: 'sprite-state-v1',
  userId, asOf,
  mood: 'idle' | 'encourage' | 'concern' | 'celebrate' | 'recovery' | 'focused' | 'unknown',
  moodReason: { kind, evidenceRefs[], sampleSize? },   // 每个 mood 必须有依据；unknown = 数据不足
  presence: { visible: boolean, reason },              // 考试会话/未登录等由前端裁决，后端只给建议
  lines: [{ id, text, tone, evidenceRefs[], action? }],// ≤3 条：action 可为 deep-link（如 '#/wrong-book'）
  bond: {                                              // 羁绊（纯派生版）：全部来自既有事实，不存储
    streakDays, recoveredFromGap?: boolean,
    milestones: [{ kind, label, evidenceRef }],        // 如"掌握度首次过 60"（仅随证据出现）
  },
  source: 'derived' | 'llm-garnish',                   // llm-garnish 时附 fallbackReason 同款契约
}
```

**mood 裁决规则（确定性优先级，全部 evidence-based）：**

1. `recovery`：检测到断档恢复事实（missed-day-recovery 响应 recoveredFromGap / 结转任务存在）→ 欢迎回来话术（承接 V8 #13）。
2. `concern`：/coach/proactive 存在 high/medium 风险 → 用其 top1 evidence 组织担忧表达（不恐吓，说事实+行动）。
3. `celebrate`：ProgressStory 存在 gain/milestone 行 → 庆祝（只引用数字，不浮夸）。
4. `encourage`：今日有未完成任务且在合理时段 → 平和推进（DailyBrief headline）。
5. `focused`：进行中练习会话存在 → 低打扰（角标不弹泡）。
6. `idle`/`unknown`：默认安静态；数据不足显式 unknown，台词"我还不够了解你，先做一次练习吧"。

频次纪律：主动弹泡每 Natural Day ≤1 次 + 单次展示 ≤3 行 + 用户可全局静音（偏好存 localStorage，不入库）——继承 V9 Phase 5 slice(0,2) 防骚扰思路并更严。

**可选 LLM garnish（独立开关，默认关）**：`SPRITE_LLM_GARNISH=on` 且 AI_API_KEY 可用时，允许 LLM 把模板事实改写得更有人味，输出必须通过既有 Safety Guard 校验、失败/超时回退纯模板并记录 AiTutorLog + fallbackReason。**LLM 永不决定 mood、永不产生事实行**。

**羁绊持久化（后置到独立 MS，可砍）**：若派生版证明不够（例如需要跨日累积的"陪伴时长"），按 coach-session 先例存 RuntimeState（key=`sprite-bond:{userId}`），声明为可丢弃运营状态、绝不回流影响 mastery/推荐；派生能做的绝不持久化。

### 4.3 前端：SpriteWidget

```
apps/web/src/features/sprite/
  SpriteWidget.tsx      # 悬浮球 + 展开面板（自取数据，不进 App 顶层 state 扇出）
  spriteMood.ts         # mood → 视觉状态（表情/颜色/动效等级）纯映射
  useSpriteState.ts     # fetch GET /sprite/state；账号切换清态；监听 daily-brief:refresh
```

挂载：App.tsx `</section>` 之后、`{learningSessionType && ...}` 之前（与 StudentBottomNav 平级兄弟），条件 `(sessionUser?.role ?? 'student') === 'student' && !learningSessionType`。

- 形象：纯 CSS/SVG 沿用 AIVisual 轨道语汇的"小核心"（不用图片资产，不引第三方库；mood 用表情状态 + `--primary` 强调）。
- 悬浮球：桌面右下（避开侧栏），移动端 `bottom: calc(84px + env(safe-area-inset-bottom))` 避开底部导航；z-index 定于 40–999 区间，低于考试层(1000)/错因层(1100)。
- 展开面板：mood 台词（≤3 行，每行可看"依据"）+ "今天要做什么"（链接 StudentActionCard 的 canonical 行动）+ "问精灵"输入框（走既有 `requestAiFollowUp`/Supervisor，题目讲解场景给 deep-link 跳 'ai' 分区，避免与 TutorPanel 职责重叠）。
- 静音开关、关闭动画尊重 `prefers-reduced-motion`；demo/静态模式按既有诚实规则处理（无 API 时显式演示标识，不伪装真数据）。
- 埋点：`trackEvent('sprite.interact', {...})`（类型进 events allowlist，服务端保留清单不扩权）。

### 4.4 数据流（全程只读）

```
StudentContext ─┐
/coach 系读模型 ─┼→ sprite-state.ts（纯派生 mood+lines+bond）→ GET /sprite/state
风险/叙事/恢复 ─┘                                                      │
                                                  SpriteWidget（挂载 App.tsx）
                                                  ├── 台词+依据展开（透明→信任）
                                                  ├── canonical 行动 deep-link（复用仲裁结果，不另造"下一步"）
                                                  └── 对话 → 既有 Supervisor/Tutor（可选后续 MS）
```

### 4.5 红线（写入每个 MS 的验收清单）

1. 不新增事实源/表/迁移；羁绊若持久化仅走 RuntimeState 且声明可丢弃。
2. 不写 mastery/计划/复习/任何事实表；精灵端点全部 GET 只读（未来对话也是转发既有 Agent 端点）。
3. LLM 不参与 mood/风险/事实判定；默认纯模板；garnish 显式开关 + fallbackReason + AiTutorLog。
4. insufficient_data 贯穿：unknown ≠ 0，证据不足明说；不伪造时长/基线/进度。
5. 不做罪感化文案；鼓励必须引用具体证据；断档话术只指向恢复路径（结转/重锚），不指责。
6. 每条台词带 evidenceRefs 且前端可见（继承推荐依据面板模式）。
7. 不打扰：弹泡频次上限 + 静音开关 + 考试会话自动隐藏 + focused mood 降打扰。
8. DESIGN.md 约束：只用语义 token，AI 强调色复用 `--primary`，不新增第二品牌色；页面级变更同步 DESIGN.md。
9. 每个 MS：先设计→RED→最小实现→`npm test` 全量零新增失败→`build:shared/api(/web)`→账本更新→精确 git add。

---

## 5. 风险分析

| # | 风险 | 证据 | 缓解 |
|---|---|---|---|
| R1 | 人格化滑向空洞鼓励/假达成，重蹈 V8 P0 信任事故 | V8 审计：同屏矛盾/假达成直接摧毁信任；Duolingo 研究：表演化学习 | 台词 evidenceRefs 强制 + celebrate 只引用真实数字 + insufficient_data 话术资产化 |
| R2 | 罪感化设计伤害压力人群（考研用户焦虑度高） | 业界 streak guilt 反例；本仓红线"不恐吓" | mood 词表禁用指责性表达；断档只走 recovery 话术；文案评审进 MS0 设计冻结 |
| R3 | 骚扰感（主动弹泡过频） | V9 Phase 5 已被迫加 slice(0,2) 上限 | Natural Day ≤1 次弹泡 + 静音开关 + focused 降打扰 + 埋点验证后再调 |
| R4 | LLM 402 计费 blocked 使"人味"打折 | `docs/v34-remote-llm-blocker.md` | 模板优先架构（MVP 零 LLM 依赖）；garnish 独立开关后置；文案质量在模板层打磨 |
| R5 | App.tsx 巨型组件再膨胀 / 全局重渲染 | App.tsx 1777 行，60 props 扇出已知债（P2-3） | SpriteWidget 自包含（自取数、自管理状态），App.tsx 只加 ≤10 行挂载；不改现有 props |
| R6 | 与既有 AI 入口语义打架（TutorPanel/AIInsightCard/ai 分区） | 前端调研：4 处入口均指 'ai' 分区 | 分工写进设计：精灵=陪伴/提醒/今日行动；TutorPanel=题目讲解；对话走 Supervisor 时 tutor 意图给 deep-link 不内嵌 |
| R7 | 羁绊体系变成第二 SoT 或影响学习引擎 | coach-session Design Gate 先例 | bond 全派生零持久化（MVP）；若后置持久化走 RuntimeState + 可丢弃声明 + 影响分析 |
| R8 | 账号切换/竞态导致串数据（V8 唯一真实产品缺陷组） | V8 P0 竞态守卫教训 | useSpriteState 照抄 useStudentContextData 请求序号 + 账号失效清态模式 |
| R9 | 幼稚化（电子宠物感）降低产品严肃性 | 用户=备考成年人 | 人格基调定为"沉稳的学长/陪跑教练"，宠物性体现在形象与仪式感，文案不卖萌不装幼稚；MS0 出语气样本供所有者拍板 |
| R10 | 主题/视觉回归（4 主题 × 悬浮层） | styles.css 主题纯 token 级联 | 只消费语义 token；四主题逐一目检进 MS2 验收；reduced-motion 支持 |
| R11 | 移动端与底部导航/安全区冲突 | StudentBottomNav fixed z-40 + 84px 预留 | 定位常量避开；375px 目检进验收 |

---

## 6. Milestone 拆分

> 节奏对齐仓库惯例：每个 MS 独立可验证、可回滚、先设计后实现、全量测试零新增失败。MS1-2 为 MVP（纯派生、零 LLM、零持久化），后续 MS 按证据决定做不做。

**命名更新（2026-09-07 所有者决议）**：Milestone 已按所有者命名重构为 **V10-0 Product Freeze → V10-1 Sprite Core → V10-2 Sprite UI → V10-3 Companion Loop →（后置）V10-4 Memory / V10-5 Real AI Companion**；与本表 MS 编号的映射见 `docs/v10-sprite-product-constitution.md` 附录 B。**MVP 范围以宪法 §6 为权威定义：V10-1 + V10-2 + V10-3。**

| MS | 内容 | 交付物 | 验证门禁 |
|---|---|---|---|
| **MS0 设计冻结** | 人格宪法（语气样本、禁词表、mood 词表）、SpriteState 契约冻结、视觉方向确认（所有者拍板） | 本文档 v1.1 + 语气样册 | 所有者确认；开源参考检查完成（本条已做初查，编码前补全清单） |
| **MS1 精灵状态后端** | `sprite-state.ts` 纯派生 + `GET /sprite/state` + 契约测试 | StudyModule 三文件 + `test/sprite-state.test.js` | 定向测试全绿；全量零新增失败；build:api PASS；冒烟：真账号返回 mood 与 evidence 对得上 |
| **MS2 悬浮精灵壳** | SpriteWidget 挂载 App.tsx、mood 视觉、面板台词+依据、静音、考试隐藏、移动端定位 | `features/sprite/` + App.tsx ≤10 行挂载 + styles token 增量 | build:web PASS；四主题+375px+桌面目检；全量测试零新增失败 |
| **MS3 陪伴仪式与回流承接** | 断档 recovery 话术（接 missed-day-recovery 事实）、streak 关怀（事实性）、里程碑庆祝（接 ProgressStory/quest 证据） | sprite-state 扩展 + 测试 | 同上；重点验收：unknown/recovery 话术诚实性断言 |
| **MS4 对话接线** | 面板"问精灵"→ Supervisor 四意图；tutor 意图 deep-link 'ai' 分区；会话延续 coach-session | 前端对话流（零新后端端点） | 对话失败显式报错不静默；与 TutorPanel 分工目检 |
| **MS5 羁绊体系（可砍）** | 若派生不足：RuntimeState `sprite-bond:{userId}`（可丢弃声明）+ 成长可视化 | 影响分析文档先行 | 证明"绝不回流影响学习引擎"的测试；所有者单独批准 |
| **MS6 效果度量与 A/B** | sprite 交互埋点（events allowlist 增量）、/coach/experiment-assignment 精灵臂、周报诚实呈现交互-留存相关（不称因果） | 埋点 + 分流 + admin 指标 | 集成冒烟；报告文案过"correlation ≠ causation"审查 |
| **MS7 生产部署** | 腾讯云部署（显式 refspec 更新法）+ 4 项冒烟（state 正确性/proactive 联动/静音/移动端） | 部署记录 + current-sprint 账本更新 | 生产冒烟全 PASS + 复测 |

**依赖关系**：MS1←MS2←MS3←MS4 线性；MS5/MS6 独立可并行；MS7 收尾。MVP 切线 = MS2 完成（可上线最小精灵）。

---

## 7. 开放决策点（已全部决议 2026-09-07，详见 `docs/v10-sprite-product-constitution.md` §0）

1. **版本号**：✅ V10（V9 已被占用并关闭）。
2. **人格基调**：✅「星野」——沉稳学长/陪跑教练，语气 80% 鼓励 / 60% 严格 / 30% 幽默，禁鸡汤/PUA/焦虑（宪法 §3）。
3. **形象资产**：✅ 纯 CSS/SVG 2D 精灵（零图片资产、零新依赖）；Live2D/3D/语音后置（宪法 §0 D3）。
4. **MVP 边界**：✅ V10-1 + V10-2 + V10-3（状态后端 + 悬浮精灵 + 陪伴循环）；羁绊持久化后置 V10-4（宪法 §6）。
5. **对话入口**：✅ 后置至 V10-5（先人格 → 先主动理解 → 再聊天；走既有 Supervisor，不自建对话栈）（宪法 §0 D5）。
