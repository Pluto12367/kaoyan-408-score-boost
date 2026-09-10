# V12 FINAL RELEASE REPORT — Score Improvement Engine

> 版本：V12（自主长程开发）
> 日期：2026-09-10
> 分支：`feature/v3-product-refactor` · HEAD `85a1bb5` · **与 origin 同步（0/0）**
> 基线：V12-0 审计 `e2aee45`（审计起点 `8abff36`）
> 结论：**V12 CODE COMPLETE（M1–M5 + F4 无 Schema 部分）；PRODUCTION DEPLOYMENT DEFERRED（所有者门控）；M3 Phase C 切换待批准**

---

## 1. Executive Summary

V12 把系统的评价标准从"学生练了"推进到"**这个干预有没有用、能力变没变、和分数对不对得上**"。

审计（V12-0）确认的 5 处断链，本轮**全部处置**：

| 断点 | 问题 | V12 处置 | 状态 |
|---|---|---|---|
| **EB-1** | 任务完成 → 零能力证据 | 一等**证据层**：活动/证据/能力三层语义 + `EVIDENCE_RECORDED` 账本 | ✅ 闭合 |
| **EB-2** | "标记已复习" → 零证据 | 同上（活动证据，并**明说它不是能力证据**） | ✅ 闭合 |
| **EB-3** | 推荐曝光零遥测 | 客户端曝光/查看遥测 + 只读漏斗（`exposed=null≠0`） | ✅ 闭合 |
| **EB-4** | 能力 → 真实分数无验证通路 | 预测↔实测**成对校准**（MAE/偏差/区间命中率） | ✅ 闭合（口径见 §7 局限） |
| **EB-5** | 双算法并存、复习不回流掌握度 | 三系统审计 + **语义矩阵** + 只读影子（切换待批准） | ⚠️ 审计+影子完成，**切换未做** |

**规模**：8 个提交 · 50 文件 · +7151/−9 行 · 新增 6 个纯模块 · 5 个只读端点 · 150 个新测试用例（2049 → **2199**）。
**零 Schema 变更**（迁移目录仍 34 个，`git diff 8abff36..HEAD -- prisma/` 为空）。
**门禁**：`npm test` **2199/2197/0/2 exit 0**；`npm run build:api` / `build:web` 均 exit 0。

**一句话**：系统现在能回答"该练什么、为什么、练完变了吗、和分数对得上吗"，并且**在每个答不上来的地方明确说答不上来**。

---

## 2. Final Product Architecture

```
                        ┌──────────────────────────────────────┐
   Write Path (SoT)     │ PracticeRecord · LearningSession     │
   ── 唯一写方不变 ──   │ ReviewSchedule/Attempt               │
                        │ StudyPlan/Task/Completion            │
                        │ UserKnowledgeMastery (EMA + OCC)     │
                        │ UserMasterySnapshot (每日)           │
                        │ RecommendationAction                 │
                        │ UserEvent (+ EVIDENCE_RECORDED)      │
                        └───────────────┬──────────────────────┘
                                        │ 只读派生
                        ┌───────────────▼──────────────────────┐
   Projection / Shadow  │ 51+ 既有投影                          │
   ── 全部只读 ──       │ + V12: learning-evidence ledger       │
                        │ + V12: recommendation funnel          │
                        │ + V12: review-semantics shadow        │
                        │ + V12: score-opportunity shadow       │
                        │ + V12: score-calibration              │
                        └───────────────┬──────────────────────┘
                                        │
                        ┌───────────────▼──────────────────────┐
   Consumption          │ 学生：报告总览证据账本（三类证据可区分）│
                        │ teacher/admin：4 个影子/校准端点       │
                        └──────────────────────────────────────┘
```

**架构纪律（继承 V11 冻结，V12 未破例）**：
- 掌握度**唯一写方**仍是 `ScoreCenterService.applyAttempts/applyReview`；V12 所有新服务**经测试断言**不含任何写原语
- 所有 V12 新能力一律 **Selector / Projection / Shadow**，**零新表、零新写方**
- 影子输出**全部标注 `authoritative:false`**，且**不进入生产排序**

---

## 3. Score Improvement Loop

```
Student → Behavior → Evidence → Mastery/Ability → Diagnosis
   → Score Opportunity → Recommendation → Exposure → Intervention
   → Training → Outcome → Assessment → Real Score → Calibration
   → Next Decision
```

| 环节 | V12 前 | V12 后 | 证据 |
|---|---|---|---|
| Behavior → Evidence | 仅活动遥测 | ✅ 三层语义 + 证据账本 | `learning-evidence.ts` / `EVIDENCE_RECORDED` |
| Evidence → Ability | 复习证据**零贡献** | ⚠️ 语义已审计+可量化，**切换待批准** | `review-semantics.ts` 影子 |
| Recommendation → Exposure | **完全缺失** | ✅ 曝光/查看遥测 + 漏斗 | `recommendation-exposure.ts` |
| Opportunity | 仅考频×缺口 | ✅ +可恢复性/单位时间收益（**反黑箱**） | `score-opportunity.ts` |
| Outcome → Real Score | **从未对照** | ✅ 预测↔实测成对校准 | `score-calibration.ts` |
| 70 分大题 | **无结构化训练** | ⚠️ 纯模块 + 离线评分器（Schema 待批准） | `large-question-rubric.ts` |

---

## 4. Evidence Chain

**三层严格分离（V12 立，代码即契约）**：

| 层 | 定义 | 载体 | 能否支撑能力判断 |
|---|---|---|---|
| **Activity** | 动作发生 | `UserEvent` 遥测 / `StudyTaskCompletion` / `WrongQuestionReview` | ❌ 永不 |
| **Evidence** | 系统**观测**到可解释表现 | `EVIDENCE_RECORDED`（**服务器专属**） | 仅强证据 |
| **Ability** | 能力推断 | `UserKnowledgeMastery`（唯一写方） | —— |

**强度规则（代码强制 + 测试钉死）**：
- `strong` = 已判分练习作答 / 已观测重做结果 → `canInfluenceMastery=true`
- `weak` = 学生自评数字 → `canInfluenceMastery=**false**`
- `none` = 完成标记 / "标记已复习" → 只是活动

**EB-1 三处接线**：已排程任务完成、**score-center 分支（推荐引擎生成的任务，此前直接 return 完全无证据）**、复习重做。
**观测回查**：`recordTaskCompletionEvidence` 返回两部分——自评（弱）+ 系统在该任务范围 ±3 天**实际观测到的已判分练习**（强）；无观测则 `observed=null`（**缺失即结论，不填零**）。
**防伪**：`EVIDENCE_RECORDED` 在 `RESERVED_CANONICAL_EVENT_TYPES` 而**不在** `TELEMETRY_EVENT_TYPES` → 客户端**不可伪造证据**（测试断言）。
**合成数据防护**：`study.service.ts:3424` 的 `correctCount ?? Math.round(questionCount*0.75)` 伪造默认值被测试锁死**不得进入证据**。

---

## 5. Intervention Chain

八环判定（V12-0 → V12 后）：

| # | 环节 | V12 前 | V12 后 | 依据 |
|---|---|---|---|---|
| 1 | Recommendation Generated | CONFIRMED | CONFIRMED | `RecommendationAction` |
| 2 | **Student Saw** | **MISSING** | ✅ **CONFIRMED** | 客户端 `recommendation.exposed`/`.viewed` + 漏斗 |
| 3 | Accepted / Started | CONFIRMED | CONFIRMED | `status` + `startedAt` |
| 4 | Training Executed | CONFIRMED | CONFIRMED | `PracticeRecord` / `LearningSession` |
| 5 | Practice → Ability | PARTIAL | PARTIAL+ | 证据层（V12-M1）+ 复习语义影子 |
| 6 | Assessment Changed | PARTIAL | PARTIAL | F2 诊断 |
| 7 | Score Changed | **MISSING** | ⚠️ **PARTIAL** | 校准已建，但"实际成绩"= 模考记录分（非考研终分） |

**曝光漏斗的诚实语义**：无遥测时 `exposureTelemetryAvailable=false` 且 `exposed=null`（**绝不把"没有遥测"报成"曝光 0"**）；仪器一旦工作，缺席即有意义（`false`，未看到）——`null`（不可知）与 `false`（未看到）语义严格分开。

---

## 6. Score Opportunity Model

**任务约束**："公式不是事实，必须验证每个变量是否有真实数据支撑" + "禁止黑箱分"。本轮核心工作是**数据核查**：

| 因子 | 来源 | 类型 | 最高置信 |
|---|---|---|---|
| `weakness` | `UserKnowledgeMastery.mastery` | 实测 | high |
| `examImportance` | `KnowledgeFrequencySnapshot.primaryScore5y` | 实测 | high |
| `recoverability` | 代理（`correctCount>0` + 前置就绪度） | **代理** | **low** |
| `evidenceConfidence` | 快照字段 | 实测 | high |
| `urgency` | `User.examDate` + `retention` | 实测 | high |
| `trainingCost` | `estimateMinutes(action, difficulty)` | **估算** | **medium** |

**反黑箱**：权重为**公开常量**（归一化=1），任何评审者可手算复现。
**三条诚实规则**：必需因子缺失 → `score=null` + `blockedBy` 点名 + 拒绝替代值；可选因子缺失 → 进 `exclusions[]` + 重新归一化 + 置信下调；不可测即不可测（考频 0 分 ≠ "重要性 0"，无掌握度行 ≠ 0.5，无前置边 ≠ "已就绪"）。
**TDD 抓出的建模缺陷**：初版对"从未做对过但前置就绪"给 0.55（中高）→ 会推荐没有切入点的知识点 → 修复为封顶 0.45。

---

## 7. Real Score Calibration

**关键勘察发现**：`AssessmentHistoryItem` 已有 `score`/`totalScore`（**真实记录分数已存在** → 零迁移可行）；而 `ExamScoreHistoryExamFact` **只有作答计数、不是分数**，未当作实际成绩。

**三概念严格分离（任务 §11.1）**：prediction（区间 + 逐字免责）/ evidence（样本量与依据）/ actual（记录分）**永不合并**；`error = actual − predicted`；`improvement` 中预测与实测进步为**两条独立序列**。

**四条诚实规则**：`CALIBRATION_MIN_SAMPLE=5`（低于下限 MAE/bias 为 `null`）；无成对记录时明示"没有误差 ≠ 没有数据"；无法重建预测的测评进 `exclusions[]` 而**不按零误差计入**；首次测评基准由评估前正确率折算并**明写"估算"**。
**时序隔离**：测试构造"测评前 2 次全对 + 测评后 2 次全错"，断言 basis 读作"2 次 / 100%"（若泄漏会读成"4 / 50%"）。
**数学性质**：断言 `MAE ≥ |bias|`（初版测试断言 `MAE == |bias|` 在 3 负 2 正下**本身错误**，已修正为真实性质）。

**⚠️ 局限（必须明示）**：系统内**不存在"真实考研分数"表或录入通道**。"实际成绩"当前是**模考/测评记录分**——真实测量，但**不是**考研最终分数。要闭合到真实考研分需新增录入通道（Schema 变更，需批准）。

---

## 8. Large Question Training（F4）

`Question.rubric` 属批准门 → **未触碰 Prisma**。按任务 §12.1 交付：提议 Schema（可空 JSONB，`ADD/DROP COLUMN` 可回滚）· Rubric JSON 形状（版本必填校验）· **确定性离线评分器** · 两种"不给分"严格区分（无 rubric → `null`/`no_rubric`；非法 rubric → `null`/`invalid_rubric`；合法 rubric + 空答案 → 真实 `0`）· 逐点 `basis` + `hitNodeIds`/`missedNodeIds`（供未来接入证据层）。

**AI 边界**：本评分器**完全不含任何模型调用**（测试断言源码无 `fetch(`/`openai`/`deepseek`/`axios`/`http`）；逐条 `authoritative:false` + 明写"关键词匹配**不是语义判定**、最终分数须人工复核"。LLM 若引入，只能作为**与离线基线对照的候选评分器**。

---

## 9. AI Boundary

| 允许 | 禁止 |
|---|---|
| Explanation / Diagnosis Assistance / Question Analysis / Pattern Extraction / Training Generation / Rubric Assistance / Coach / Agent | 把 AI 输出当作事实；让 LLM 成为评分绝对真理 |
| AI 结果必须区分 FACT / INFERENCE / RECOMMENDATION / EXPERIMENT | 自动写入掌握度；自动改生产策略 |

**V12 的兑现**：所有智能输出走既有安全闸；4 个影子端点全部 `authoritative:false`；离线评分器零模型调用；`mastery-calibration` 只产方向建议、**绝不自动写** `UserKnowledgeMastery`。

---

## 10. Data Model

**V12 零 Schema 变更**（`git diff 8abff36..HEAD -- prisma/` 为空；迁移目录 **34 个不变**）。

证据与曝光复用既有表：`UserEvent`（`(userId,eventKey)` 唯一索引提供数据库级幂等）+ `RecommendationAction`（漏斗分母）。
**回滚方式**：删除 `type='EVIDENCE_RECORDED'` / `'recommendation.exposed'` / `'recommendation.viewed'` 的事件行，无 Schema 变更、无数据形态变更。

F4 若获批：唯一提议变更为 `Question.rubric Json?`（纯增量可空）。

---

## 11. API Surface

**V12 新增 5 个端点（全部只读）**：

| 端点 | 角色 | 诚实缺席 | 用途 |
|---|---|---|---|
| `GET /coach/learning-evidence` | student/teacher/admin，**self-only（不接受 userId 覆盖）** | `reason:'store_unavailable'` | 证据账本 |
| `GET /coach/recommendation-funnel` | student/teacher/admin，**self-only** | 同上 + `exposed:null` | 推荐曝光漏斗 |
| `GET /coach/review-semantics-shadow` | **teacher/admin**（走 `resolveUserId` 授权） | `result:null` | 复习语义影子 |
| `GET /coach/score-opportunity` | **teacher/admin** | `result:null` | 机会模型（反黑箱） |
| `GET /coach/score-calibration` | **teacher/admin** | `result:null` | 预测↔实测校准 |

**纪律**：学生可见端点**不接受 `userId` 覆盖**（测试断言，且测试含**正向对照**防空洞通过）；影子/模型质量端点归 teacher/admin。

---

## 12. Frontend Integration

| 变更 | 说明 |
|---|---|
| `LearningEvidenceLedger`（报告总览 tab） | 三类证据**可区分**：观测证据（primary）/ 自评证据（amber，明示"不作为能力依据"）/ 仅活动（muted） |
| 系统"拒绝判断"对学生可见 | `hasAbilityEvidence=false` 时渲染"**系统拒绝据此判断能力变化**"，而非画 0 或画提升 |
| 曝光遥测 | `TodayMission` 渲染后上报 `exposed`；`TodaysScoreCenter` 渲染后上报 `exposed`，**仅打开"为什么推荐"才上报 `viewed`** |
| 防伪造 | 静态演示模式**跳过**上报；按 `日:阶段:面:id` 去重；无身份目标丢弃 |

**过程诚实记录**：首版 CSS 误用不存在 token（`--border`/`--surface-muted`/`--success` 等），提交前逐个核对并替换为真实 token（CSS 缺 token 会**静默失效**，属不可见回归）。

---

## 13. Test Matrix

| 层次 | 覆盖 | 证据 |
|---|---|---|
| **Pure unit** | 6 个 V12 纯模块 | 81 项（17+11+12+14+13+14） |
| **Service** | 5 个 V12 只读服务 | 42 项（10+7+9+9+7） |
| **Boundary / wiring** | 证据边界·曝光接线·前端账本 | 27 项（8+10+9） |
| **Contract / regression** | 既有 344 个测试文件 | 全量通过 |

**V12 新增测试合计 = 150 项，全部通过**；全量 **2199 tests / 2197 pass / 0 fail / 2 skip**。

**边界测试的具体形式**（防假绿）：源码扫描（**剥离注释后**）断言证据/影子/校准服务**不含任何写原语**（`.create(`/`.update(`/`upsert(`/`delete(`/`saveMastery`/`applyReview`/`applyAttempts`）；断言 `EVIDENCE_RECORDED` **服务器专属**、曝光类型**客户端可报**；断言离线评分器无网络调用。

---

## 14. E2E Matrix

> 本节在会话末段 Docker 引擎最终就绪后**实测补齐**（报告首版曾如实标注"未执行"）。

| 场景 | 状态 | 证据 |
|---|---|---|
| 单元/契约/边界层 | ✅ **通过** | 2199 用例 / 2197 pass / 0 fail |
| 类型检查三端 | ✅ **通过** | `tsc --noEmit` shared / api / web 均 exit 0 |
| 构建门禁 | ✅ **通过** | `build:api` / `build:web` 均 exit 0 |
| **API 在真实 PostgreSQL 上启动** | ✅ **通过** | `scripts/integration-postgres.mjs` 内启动 API :3200，`/health` 200、`/auth/login` 201、`/wrong-questions/:id/detail` 200、`/onboarding/status` 200、`/today/plan` 200、`/sessions/practice/*` 200/201、`/exam/report/*` 200、`/dashboard/overview` 200 —— **证明 V12 的 DI 装配在运行时成立**（不只 tsc 通过） |
| **测试库迁移** | ✅ **通过** | `prisma migrate deploy` → **34 migrations applied** |
| **`test:integration:effectiveness`** | ✅ **exit 0** | 真实库；`bySurface: {outcomes:5, interventions:2, summary:3, experiments:1}` |
| **`test:integration:event-key`** | ✅ **exit 0** | "event-key PostgreSQL integration assertions passed" |
| **`test:integration:content-import`** | ✅ **exit 0** | `{"ok":true,"source":"postgresql","scenario":"content-import","questions":320,"knowledgePoints":16}` |
| `test:integration:exam-aligned` | ❌ **未通过（环境数据缺口）** | 失败原因：`seeded database must contain at least one question` —— 该脚本要求 `Question` 题库，而 `seed:408` 只灌真题层（`ExamPaper`/`ExamQuestion`）与考频快照；`questions:generate-starter` 仅生成 CSV 不导入。**非代码缺陷** |
| `test:integration:postgres`（3253 行，最全面） | ❌ **在既有断言处失败** | 失败于 `scripts/integration-postgres.mjs:1254` `review scheduler regression requires three target-date tasks`。**判定为既有失败而非 V12 回归**（见下方三重证据） |

### 14.1 `integration-postgres` 失败归因（任务 §27：区分真实回归 / 既有失败）

| 证据 | 结果 |
|---|---|
| V12 对 `scripts/` 的改动文件数 | **0** |
| V12 对 `prisma/` 的改动文件数 | **0** |
| V12 对 `study.service.ts` review 路径的改动性质 | **纯附加证据记录**，且被 `recordLearningEvidence` 的 try/catch 包裹（失败仅 warn 并继续）——**不可能改变计划生成的任务数** |
| 该失败是否在 V12 之前已被登记 | **是**：`docs/v11-architecture-final.md:110` §7「已知债：集成脚本 review-scheduler 断言（所有者定的稍后项）」+ `docs/v12-0-score-improvement-audit.md` §2「已知环境债」——**两份文档均写于任何 V12 代码之前** |
| 失败点之前的断言 | 全部通过（含 API 启动、并发提交幂等、快照时间保留、报告一致性等） |

**结论**：`FAIL`，类型 = **PRE-EXISTING FAILURE**，根因疑为 V8 #13 结转重锚 / V9 周强度改计划管线后，计划生成不再为该场景产出 3 个目标日任务（与 `docs/v10-1-sprite-core-final-report.md` 的既有归因一致）。**修复它需要改计划生成逻辑（属生产行为变更），未获授权，本轮不修。**

### 14.2 仍未验证（诚实标注）

| 项 | 原因 |
|---|---|
| 5 个 V12 新端点的**真实数据分布** | 需真实学生数据；测试库为空库 |
| 影子/校准端点的**分歧幅度、样本量** | 同上 |
| 生产 E2E / 路由探测 | 无 SSH 凭据 |

---

## 15. Production Status

```
CODE READY        ✅  V12 全部代码已提交并推送 origin（HEAD 85a1bb5，0/0 同步）
PRODUCTION        ❌  DEFERRED（所有者门控）
```

**事实**：生产运行 `43b715e` 前后构建；V11-M2/M3/M4 端点未上线（404，V12-0 路由探测实证）；V12 的 5 个新端点同样未部署。
**已在本机真实 PostgreSQL 上验证的部分**：API 以全部 V12 服务装配启动成功并服务真实请求（§14），3 个集成脚本 exit 0，34 个迁移干净应用——**"代码能在真实数据库上跑起来"已证实；"生产上跑起来"未证实。**
**权限**：本会话**无服务器 SSH 凭据** → 按任务 §5「不得伪造部署」，仅准备部署包与确切命令。

**确切部署命令**（沿用 `docs/v11-final-release-server-steps.md`；服务器 git 默认 pull 会命中代理陈旧 ref，**必须显式 refspec**）：

```bash
cd /srv/kaoyan408   # 以实际路径为准
./deploy/tencent-ip/deploy.sh   # 内含校验/备份/compose 重建/健康检查（见该脚本 183 行）
# 或手工：
git fetch origin feature/v3-product-refactor
git reset --hard FETCH_HEAD      # 显式 refspec 路径，避免陈旧 ref
docker compose --env-file .env.production -f compose.production.yml up -d --build --wait
curl -fsS http://127.0.0.1/health
```

**部署后必须验证**：5 个新端点返回 **401（未认证）而非 404**（证明已注册）；认证后返回真实数据或 `store_unavailable`。

---

## 16. Known Limitations

| # | 局限 | 影响 | 处置 |
|---|---|---|---|
| 1 | **系统无"真实考研分数"表/录入通道** | 校准口径是"预测 vs 模考记录分"，**不是**考研终分 | 需新增录入通道（Schema）→ **需批准** |
| 2 | **V12-M3 Phase C 未切换** | 复习证据仍**不流入**掌握度；`retention` 仍恒为 1 | 设计与阈值已就绪 → **需批准** |
| 3 | **无真实学生数据的端到端验证** | `exam-aligned` 缺题库种子；5 个新端点的真实数据分布/分歧幅度/样本量未观测 | 测试库已就绪（34 迁移 + 1296 节点 + 1149 快照），补题库种子后可复跑 |
| 4 | **F4 Schema 未应用** | 大题仍无结构化训练 | → **需批准** + 教研内容 |
| 5 | `recoverability` 是代理指标 | 机会分该维度可靠性有限（置信 low） | 已在输出中标注 |
| 6 | `trainingCost` 是估算 | 非实测用时（置信 medium） | 已标注 |
| 7 | 曝光遥测是客户端声明 | 恶意客户端可伪造曝光 | 仅用于漏斗诚实性，**不参与决策** |
| 8 | 前端上报器运行时行为未被自动化覆盖 | 依赖 `import.meta.env`，采用源码断言 | 已知缺口 |
| 9 | 合成指标污染既有报告 | `study.service.ts:3424` 的 75% 默认值流入 `computeMasteryReport` | **本轮未改动**（改动会变更计划调整行为），已用测试锁死"不进入证据" |

---

## 17. Remaining Risks

| 风险 | 等级 | 说明 |
|---|---|---|
| 生产与代码持续漂移 | **高** | 代码已推进到 V12，生产仍在 `43b715e`；漂移越久，部署风险越大 |
| 掌握度被复习拉高后改变推荐排序 | **中** | Phase C 切换的已知副作用；影子期须同时观测排序变化幅度 |
| 文档-代码再次漂移 | **中** | 243 份文档历史包袱；本轮已校正 `current-sprint.md` §1 与 CLAUDE.md |
| 内容侧成为天花板 | **中** | 147 无考频节点、知识关系稀疏（DS 0 边）、rubric 内容缺失——**架构无法替代内容投入** |
| 集成测试长期缺位 | **中** | 本轮无法执行；若长期不补，回归信心依赖单元层 |
| 影子永不收敛为决策 | **低** | 4 个影子端点若无人在环消费，会退化为"装饰性智能"（审计已警告过此类问题） |

---

## 18. Interview-facing Technology Stack

> 原则：**只有真正使用并能解释的技术才列入。** 任务清单中列出的 Next.js 与 Redis **本项目未使用**，故不列入。

| 技术 | 真实使用位置 |
|---|---|
| **TypeScript 5.9** | 全仓（三端 `tsc --noEmit` 通过） |
| **NestJS 10** | `apps/api`（11 模块 / 142+ 路由 / DI / Guard / 全局管道） |
| **React 18 + Vite 5** | `apps/web`（189 文件 / 33,946 行；**非 Next.js**） |
| **Prisma 5 + PostgreSQL 16** | 46 model / 19 enum / 34 迁移（**无 Redis**） |
| **npm workspaces** | 三包 monorepo |
| **node:test** | 358 个测试文件 / 2199 用例（无 Jest/Vitest） |

**未使用（明确排除）**：Next.js · Redis · ESLint/Prettier（仓库刻意零 lint 配置）。

---

## 19. Interview-facing Technical Highlights

| 亮点 | 具体证据（可追问） |
|---|---|
| **Source of Truth 纪律** | 掌握度唯一写方 5 写点收敛；V12 全部新服务经**测试断言**零写原语 |
| **活动 / 证据 / 能力三层建模** | `learning-evidence.ts` 分类学；自评**不可**影响掌握度由代码强制 |
| **数据库级幂等** | 复用 `UserEvent(userId,eventKey)` 唯一索引 + P2002 回读，而非应用层去重 |
| **OCC（乐观并发）** | `UserKnowledgeMastery.version` + ≤3 次退避重试 |
| **CQRS / 只读投影** | 51+ 投影全部零写入（源码级扫描证明） |
| **反黑箱模型设计** | 权重公开常量 + 每因子标注 source/confidence + 缺必需因子**拒绝出分** |
| **诚实缺席（null ≠ 0）** | 曝光 `null`（不可知）与 `false`（未看到）严格分开；校准低于样本下限不出 MAE |
| **双算法审计与影子** | 发现 `applyReview` **不改 mastery**、`retention` 恒为 1；影子用**生产同一纯函数**重放以保可比 |
| **时序正确性** | 复习证据**在事务提交后**写入（测试钉死）；校准预测只取**严格早于**测评的事实 |
| **影子模型与校准** | FSRS（未训练权重显式标注）+ 预注册切换阈值 + 人在环 |
| **可解释评分** | 离线 rubric 逐点 `basis` + `hitNodeIds`/`missedNodeIds`，零模型调用 |
| **AI 边界工程化** | 4 端点 `authoritative:false`；LLM 只作对照候选；评分须人工复核 |

---

## 20. Final Git Commit / Tag

```
分支   feature/v3-product-refactor
HEAD   85a1bb5   fix(v12): repair utf-8 damage in daily-brief controller
origin 与 HEAD 同步（0 / 0）
基线   8abff36（V12-0 审计入库）
V12 提交（8 个，时间正序）
  bc30f06  feat(v12): establish learning evidence foundation
  d6c2aa4  feat(v12): add recommendation exposure telemetry
  16ee6e7  feat(v12): consume the learning evidence ledger in the report
  fb95c3d  feat(v12): audit and shadow review semantics unification
  fe878b9  feat(v12): add score opportunity shadow model
  cc30fcd  feat(v12): pair predicted and actual scores for calibration
  9b83897  feat(v12): offline rubric evaluator for large questions
  85a1bb5  fix(v12): repair utf-8 damage in daily-brief controller
规模   50 files changed, 7151 insertions(+), 9 deletions(-)
迁移   34（不变）
tag    未创建（本会话未获打 tag 指令；建议所有者批准后打 v12.0.0-score-improvement-engine）
```

---

## 附：V12 FINAL AUDIT（任务 §31 的八类问题排查）

| 类型 | V12 排查结果 |
|---|---|
| **Dead Feature** | 未新增死功能。**既有**死代码仍在册（`task-progress-consistency-checker.service.ts` 674 行、`useTeacherActions.ts` 324 行、`RuntimeStateRepository` 零消费）——**本轮未清理**（属 P2 工程收敛，未获授权） |
| **Decorative Intelligence** | 审计点名的 `AIInsightCard` 仍未改造（在册）；**V12 未新增**任何装饰性智能——4 个新端点全部产出可解释证据而非展示型卡片 |
| **Broken Link** | EB-1/EB-2/EB-3/EB-4 已闭合；**EB-5 仅完成审计+影子**（切换待批准）——已如实标注，未冒充闭合 |
| **Fake Evidence** | 发现并**锁死**合成数据风险：`correctCount ?? questionCount*0.75` 不得进入证据（测试断言）；活动标记**永不**渲染为能力证据 |
| **Unused Data** | V12 首次消费了 `ReviewAttempt.nextIntervalDays`、`KnowledgeFrequencySnapshot.primaryScore5y`、`AssessmentHistoryItem.score`、`UserMasterySnapshot`；知识关系仍稀疏（内容债） |
| **Duplicate Logic** | **未新增重复**：考频完整公式仍归推荐引擎（V12 只取单一真实字段归一化）；评分器零模型；影子复用生产 `updateMasteryAfterAttempt`/`estimateRetention`/`estimatePredictedScore`。既有重复仍在册（`isStaticDemoMode` 双实现、双复习算法） |
| **Unverified Claim** | 本报告**不声称**任何未执行的验证：生产 E2E 明确标 `❌ 未执行`（无 SSH 凭据）；`exam-aligned` 与 `integration-postgres` 的失败**逐条归因**（前者为环境数据缺口，后者经三重证据判定为**既有失败**，并在 §14.1 列出）；"实际成绩"口径局限已明示 |
| **Hidden Failure** | **抓到并修复 1 个自伤缺陷**：我用未指定编码的 `Set-Content` 往返 `daily-brief.controller.ts`，损坏 19 处 em-dash 并吞掉 18 个空格、合并 1 处换行。**构建与全量测试全程保持绿色**，正因如此更值得记录。已按字节精确修复，修复后与 V12 前版本**零删除行**，并对 V12 全部 50 个改动文件做严格 UTF-8 扫描（0 非法） |

**审计结论**：V12 范围内**无已知未修复缺陷**；所有未完成项均为**明确的批准门或环境阻塞**，且已在 §15/§16/§17 逐条列出。

---

## 最终判定

```
V12-M1 Evidence Foundation        ✅ COMPLETE
V12-M2a Recommendation Exposure   ✅ COMPLETE
V12-M2b Task Evidence (frontend)  ✅ COMPLETE
V12-M3 Review Semantics           ⚠️  Phase A+B COMPLETE / Phase C 待批准
V12-M4 Score Opportunity Shadow   ✅ COMPLETE
V12-M5 Real Score Calibration     ✅ COMPLETE（口径限制已明示）
F4 Large Question Training        ⚠️  设计 + 无 Schema 影子 COMPLETE / Schema 待批准
V12 FINAL AUDIT                   ✅ COMPLETE
V12 FINAL RELEASE REPORT          ✅ COMPLETE（本文件）
生产部署                          ⏸  DEFERRED（所有者门控，无 SSH 凭据）

→ V12 SCORE IMPROVEMENT ENGINE: CODE COMPLETE
   完整闭环的最后两环（复习证据回流掌握度、真实考研分回流校准）
   受"需所有者批准"约束，未实施，亦未以任何形式冒充已完成。
```

**需要所有者决策的三件事**：
1. **M3 Phase C**：是否批准统一复习语义（改变 `applyReview` 生产写语义；零迁移、单函数可回滚、预注册阈值）
2. **F4 Schema**：是否批准 `Question.rubric Json?`（纯增量可空）+ 教研内容批次
3. **生产部署时机**：是否部署 V12（5 个新端点）及是否创建 `v12.0.0-score-improvement-engine` tag
