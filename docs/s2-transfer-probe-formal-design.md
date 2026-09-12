# S2 Transfer Probe — Formal Design

> 日期：2026-09-12 ｜ 性质：FORMAL DESIGN ONLY（零代码、零 schema、零迁移、零 commit、零 push）
> 输入：`docs/s2-transfer-probe-interface-audit.md`（Part 1-3，Design Gate = READY WITH CONDITIONS）
> 已批准前提（本设计不再讨论，只执行）：**C1** Probe Identity = α / Evidence detail first；**C2** Probe Queue = StudyTask 承载；**C3** Probe→Mastery = 现有 canonical path；**C4** Probe Content = 独立内容任务，无合格新题则诚实 `no_probe_available`。

---

## 0. 设计目标（一句话）

让系统第一次能回答："学生在某个节点上的练习表现，能否迁移到从未见过的同构新题？"——以 `Intervention → Probe Scheduled → New Isomorphic Question → Transfer Result → Transfer Evidence → Transfer Rate → Transfer Gap` 全链可归因、可回放、可回滚的方式。

**三条 V12 继承红线（全文成立）**：不建立第二套 Student State / Mastery Engine / Evidence Ledger / StudyTask / Recommendation / Canonical Writer；复用 UserKnowledgeMastery、AnswerReceipt、Evidence Receipt、StudyTask、RecommendationAction、Canonical Writer。

---

## 1. 概念模型（任务书 §4）：五概念 → 载体裁决

| 概念 | 载体 | 性质 | 说明 |
|---|---|---|---|
| **TransferProbe**（排程实例=探针身份） | `RecommendationAction(actionType='TRANSFER_PROBE')` + 其 1:1 `StudyTask` | **既有 SoT 复用** | 身份与排程的唯一家；actionType 是 String 列，'TRANSFER_PROBE' 为 additive 新值（无 schema 变更） |
| **ProbeTask** | 同上一致——StudyTask 视图 | 派生视图 | 与 TransferProbe 是同一事实的两面，不是第二个实体 |
| **ProbeAttempt** | `PracticeRecord`（经 `LearningSession(type='transfer_probe')` 提交） | **既有 SoT 复用** | 判题/幂等/掌握度回流全走既有路径；attemptSource 经 session type 派生（零新列） |
| **TransferEvidence** | `EVIDENCE_RECORDED`（经 `recordObservedPerformance(detail.kind='transfer_probe')`） | **既有 SoT 复用**（测量身份 SoT） | detail 透传先例=rubric（detail.kind='rubric_scored_attempt'）；occurrence 键保证逐次身份 |
| **TransferResult / TransferRate / TransferGap** | 只读投影（shared 纯函数 + 只读装配） | **Projection，不落表** | 从 TransferEvidence + PracticeRecord 派生；投影文化（selector）先例 |
| ProbeSchedule | 无独立物：StudyTask.scheduledDate + Action 状态机 | 派生 | 不与 FSRS 共享任何语义（§8 红线） |

**裁决原则的落实**：五个概念中零个新表。新增的持久化元数据只有：`LearningSession.type` 新枚举值 'transfer_probe'（String 列新值，DTO 白名单 +1）、`Action.actionType` 新值、`Question.source` 内容约定值 'transfer_probe_pool'（内容任务写入）——全部是**既有 String 字段上的受控词表扩展**，符合 C1 α（零 schema）。

---

## 2. Probe Identity（任务书 §5，逐字段）

| 字段 | 来源 | 事实/派生 | 生命周期 | 唯一性 | 可回放 |
|---|---|---|---|---|---|
| `probeId` | = 探针 RecommendationAction.id（cuid） | 事实 | 创建→EXPIRED/CANCELLED/COMPLETED 终态，永不删除 | Action id 全局唯一；`(userId, creationKey)` 幂等 | creationKey 确定性重放 |
| `probeQuestionId` | 投递时选题器从探针池选定 | 事实（选定时刻落库于 `LearningSession.questionIds` + 证据 detail） | 投递时确定，随会话存续 | 每 (probeId, 学生) 恰好 1 题 | 会话记录可查 |
| `source` | 常量 'TRANSFER_PROBE'（语义标签） | 派生（类型化） | 恒定 | —— | 由 actionType + detail.kind 双处携带 |
| `interventionActionId` | 触发探针的干预 Action.id | 事实 | 写入探针 Action 的 `evidenceRefs`（创建时刻） | 每探针恰 1 个干预 | evidenceRefs 可查 |
| `studentId` | Action.userId | 事实 | 恒定 | —— | —— |
| `nodeId` | Action.targetId（= 干预节点） | 事实 | 恒定 | —— | —— |

补充事实字段（承载于既有列）：`interventionTaskId`（StudyTask.id，evidenceRefs）、`interventionCompletedAt`（StudyTask.completedAt，调度基准）、`difficultyBucket`（BASIC/MEDIUM/HARD，写入 evidenceRefs 与证据 detail）。

---

## 3. Question Eligibility（任务书 §6——S2 核心规则）

**合格定义（全部满足才是 eligible；任何一条无法证明 → NOT ELIGIBLE，禁止降级）：**

```text
E1 池内：Question.source = 'transfer_probe_pool'（内容任务审定写入）
E2 零作答：EXISTS(PracticeRecord WHERE userId, questionId) = false
        且 EXISTS(ReviewAttempt 经 ReviewSchedule join WHERE userId, questionId) = false
E3 零曝光：questionId ∉ ⋃ LearningSession.questionIds（该学生全部会话，含未提交快照）
E4 零同族：questionId.familyId ∉ {该学生在此节点上作答过/见过的题的 familyId 集合}
          （封堵"同一道题换版本"漏洞——contentFingerprint 只防精确重复，不够）
E5 桶匹配：Question.difficulty = 目标探针桶（§5）；Question.type = 干预题型
E6 未用作探针：该题未在该学生身上充当过探针（由 E2/E3 蕴含 + 探针证据 detail 反查双保险）
```

- E2/E3 的查询面 = **三源反查**（Part 1 §15 已证完备性上限：作答级完备、曝光级以会话为界）。
- **无法证明 never_seen = true 的题 NOT ELIGIBLE**——不存在"大概率没见过"的近似判定。
- 选题在**投递时刻**执行（不是排程时刻）——把"排程到投递之间学生做了这道题"的窗口污染压到零（投递瞬间最后校验）。

---

## 4. Isomorphic Question Definition（任务书 §7）

**同构 formally = 以下全部成立：**

```text
I1 same node          ：探针题与干预题命中同一 KnowledgeNode（PRIMARY tag）
I2 same question type ：SINGLE_CHOICE / COMPREHENSIVE / JUDGEMENT 逐值相同
I3 same difficulty band：BASIC / MEDIUM / HARD 同桶
I4 same knowledge operation：考核同一知识操作（同一公式/同一算法步骤/同一协议行为的运用）
I5 different surface  ：题干、选项、数字情境不同（contentFingerprint 不同 + 非同 family）
```

**I4 是当前仓库没有元数据的维度**——因此引入两级行为：

| 级别 | 判定来源 | 行为 |
|---|---|---|
| `isomorphism = verified` | 内容任务交付的审定清单（内容仓 manifest：probe question → node + operation 编号）；工程侧以 `Question.source='transfer_probe_pool'` 为审定标记 | 计入 **primary stratum**；UI 标注"同构已审定" |
| `isomorphism = unverified` | 仅满足 I1-I3+I5 的同点新题（池外 fallback） | 计入 **unverified stratum**（**永不与 primary 合并**）；UI 标注"同构性未审定"；TransferGap 报告分列 |

**禁止**：普通标签（同节点/同难度）直接被当作"已证明同构"——I4 没有系统内事实，verified 只能来自内容审定标记。TransferGap 主结论只从 verified stratum 计算；unverified stratum 单独报告并标注置信上限。

---

## 5. Difficulty Matching（任务书 §8）

两种探针（**永不混合口径后输出单一 Transfer Rate**）：

| 探针种类 | 目标桶 | 定义 | 阶段 |
|---|---|---|---|
| **practice-difficulty probe** | 干预题自身的 difficulty 桶（从干预窗口内该生在此节点的已判分题聚合众数桶；无作答历史 → 节点题库众数桶） | 与干预表现同口径对照 | **M1 实现** |
| **exam-difficulty probe** | 考试代表桶（该节点有真题 tag 的题的众数桶；无真题 → MEDIUM 常量并声明） | 与考试口径对照 | E2 阶段实现 |

- **matching rule**：探针题 difficulty 必须等于目标桶（枚举只有三桶，精确匹配可行）；`expectedTimeSec` 同步对齐报告。
- **fallback**：目标桶内无合格题 → 该桶 `no_probe_available`；**禁止**换桶顶替。
- **输出纪律**：TransferRate/TransferGap 按 `(node, kind, bucket)` 分列；两桶、两 kind 之间禁止平均或合并（继承 S1 分层纪律）。

---

## 6. Probe Pool Isolation（任务书 §9）

| 维度 | 设计 |
|---|---|
| 内容标签 | `Question.source = 'transfer_probe_pool'`（内容任务经既有导入管线写入；source 透传已在 import-questions.mjs:194 验证）。审定清单（node→probe question→operation）随内容仓交付 |
| API visibility | 练习题选取查询（nodeQuestionIdsByNode 主路径 + knowledgePointIds fallback）统一排除 `source='transfer_probe_pool'`——**单点排除**，所有练习/推荐选题面自动生效 |
| frontend visibility | 知识点详情"相关题"、练习面板、错题变式等学生面均经上述选题查询 → 自动隔离；教师/管理员题库管理面**可见**（池管理需要） |
| recommendation exclusion | 引擎只选节点不选题；选题面排除即覆盖推荐链路 |
| search exclusion | 学生面搜索/列表共用选题查询；管理面检索不过滤（运营需要） |
| release delay | 探针题**永不自动释放**进普通练习面；下池是内容团队显式动作（对某学生的"见过"排除已由三源反查保证，池级释放无必要且引入风险） |
| 测量窗口纪律 | 探针投递到提交期间，该题对全区学生仍锁在池内；解析（analysis）在该生提交前不下发 |

---

## 7. Probe Lifecycle 状态机（任务书 §10）

状态承载：**RecommendationAction.status + StudyTask.status + LearningSession 存在性**（零新存储）；细粒度事件写证据台账。

```text
eligible（计算态，不落库）
   │ 干预完成（Intervention Completion Definition，见 §9）
   ▼
scheduled      = Action.CREATED + StudyTask(pending, scheduledDate=D+2)
   │ 投递：GET /coach/transfer-probes 到期扫描 + 选题成功 + 创建探针会话
   ▼
exposed/started= Action.STARTED + LearningSession(type='transfer_probe', actionId 绑定)
   │ 学生提交（复用 POST /sessions/practice/:id/submit）
   ▼
submitted/scored/evidence_recorded（原子）
   = Action.COMPLETED + StudyTask(completed)
   + PracticeRecord（事务内 canonical mastery，C3）
   + EVIDENCE_RECORDED（事务内，detail.kind='transfer_probe'，M3 复习证据同事务先例）
```

**异常态：**

| 状态 | 触发 | owner | 可重试 | 学习证据 | 计入 TransferRate |
|---|---|---|---|---|---|
| `expired` | scheduledDate+7 天宽限届满未提交 | 系统（投递扫描） | 否（终态；同节点未来新干预可再排） | **否** | **否（不计失败）** |
| `cancelled` | 节点下线/题目召回/所有者干预 | 系统/所有者 | 否 | 否 | 否 |
| `no_probe_available` | 投递时刻选题失败（§6 任一条不满足且池内无替代） | 系统 | **是**——宽限窗内每日重试（≤7 天），之后转 expired(reason=no_probe_available) | 否 | 否；**计入内容积压信号** |
| `invalidated` | 数据质量检查发现污染（§24：题曾被见过/归因缺失等） | 系统 | 否（该次测量作废） | 证据行保留但标记 invalidated，投影排除 | 否（且从已聚合样本中剔除） |

**硬规则**：`probe_expired` 不是失败——不计失败、不降 mastery（本来也没作答）、不进 TransferGap 分母、不产生任何负面学生反馈（UI 静默或"本次复测已过期"中性文案）。

---

## 8. 48h 调度协议（任务书 §11）

```text
intervention_completed（日 D，StudyTask.completedAt 时间戳为准）
   → scheduledDate = D + 2（日粒度，C2 固有限制）
   → 投递守卫：now − interventionCompletedAt ≥ 36h（时间戳硬校验，防 D 深夜完成导致 D+2 凌晨过早投递）
   → 有效投递窗 = [D+2, D+2+7 天]；投递时刻即时选题
```

**对理想 48h±6h 的偏差声明（C2 日粒度固有）**：实际生效窗口 ≈ 36h–96h。这是所有者已批准的 StudyTask 承载的直接代价，写入设计不掩饰；若未来需要严格窗口，演进路径是独立 dueAt 表（Part 2 §19 已留位），不在本设计范围。

| 场景 | 处理 |
|---|---|
| 学生离线 | 探针在窗内每日重试投递（懒投递：GET /coach/transfer-probes 触发扫描）；不推送不催促 |
| 重复干预（同节点再次完成干预） | **跳过新建**——同节点已存在非终态探针 → 不重复排程；同节点上一次探针终态距今 <14 天 → 亦跳过（防过度探测）。跳过事实写 action 幂等读回/日志 |
| 多节点同时到期 | 每自然日至多呈现 3 条到期探针（防倾泻）；超出部分顺延次日（保持 scheduled，不重置窗口、不过期） |
| 考试临近（remainingDays ≤ 14） | 探针在呈现排序中降至任务之后；不自动取消（测量价值仍在）；行为入设计不做隐藏开关 |
| 已存在 probe（同 student+node 非终态） | creationKey 幂等：`TRANSFER_PROBE:{userId}:{nodeId}:{scheduledDate}`——同日重放读回既有 Action |
| 节点已有 pending probe | 同上，跳过 |
| **禁止重复投递** | `LearningSession.actionId @unique`——一个探针 Action 至多一个会话；投递=创建会话，天然一锁 |

**Intervention Completion Definition**（调度触发事实）：干预 StudyTask `completed=true` **且**该节点存在 ≥1 条干预窗口（completedAt ±3 天，task-evidence 先例）内已判分客观作答。无作答的"标记完成"不触发探针（完成标记永不构成证据的 V12 纪律延续）。触发点：completeStudyTask 完成分支（现有 learningEvidence 接线旁）+ 懒补偿（GET /coach/transfer-probes 扫描最近完成未排程的干预，creationKey 幂等兜底）。

---

## 9. Idempotency（任务书 §12）

| 键 | 载体 | 防什么 |
|---|---|---|
| probe creation key | Action.creationKey = `TRANSFER_PROBE:{userId}:{nodeId}:{scheduledDate}`，`(userId, creationKey)` 唯一 | 重复排程/补偿重放 |
| probe delivery key | `LearningSession.actionId @unique`（探针会话绑定） | 重复投递/重复会话 |
| probe submission key | AnswerReceipt `(userId, idempotencyKey)` + 会话提交自身幂等 | 重复提交 |
| evidence key | `learningEvidenceKey(userId, 'practice.answered', sourceId=probeId, occurrence=PracticeRecord.id)` + detail.kind | 重复证据/观测坍缩 |
| mastery | OCC version（既有） | 并发写 |

**不引入第二套通用幂等系统**——五个键全部是既有键族的实例化。

---

## 10. Mastery Boundary（任务书 §13）

- 探针作答 = 一次普通判分练习：`POST /sessions/practice/:id/submit` → 事务内 PracticeRecord + `applyAttempts`（applyMasterySemantics 唯一写方）→ 快照。**TransferProbeService（编排层）永不 import 任何 mastery 写原语**——实现期用源码级边界断言锁死（V12 证据层边界测试模式）。
- **probe source 可区分**：会话 type='transfer_probe'（作答事实层，派生）+ 证据 detail.kind='transfer_probe'（测量身份层，SoT）。
- **两个结果严格分离**：
  - **mastery effect**：canonical EMA 的 Δmastery（新题答对→按难度目标上移；答错→下移）——这是 C3 的既定语义，探针同时是干预；
  - **transfer measurement**：TransferEvidence 里的对/错观测 → TransferRate/Gap 投影。
  - 两者各自记录、互不换算：探针答错**不"直接修改 TransferRate"**（TransferRate 是投影，读证据），也**不绕过** mastery 写方（无任何探针专属 mastery 通道）。
- 快照/趋势/今日简报等下游消费探针作答的方式与普通作答完全一致（它们本来就是普通作答）。

---

## 11. Transfer Measurement（任务书 §14）

**定义（投影纯函数，全部有界、确定性）：**

```text
PracticeAccuracy(node) = correct / attempts
  over: 该节点 PracticeRecord（经题→节点 PRIMARY 解析）
  exclude: ① sessionId → LearningSession.type = 'transfer_probe'（探针不入练习口径）
           ② variantQuestionId ≠ null（变式重测属补救测量）
           ③ gradingMode = 'self_assessed'（自评非客观）
  注：review 天然不在 PracticeRecord 内（独立 ReviewAttempt 链）——"review 不进 practice 口径"由结构保证

TransferRate(node, kind, bucket) = correct / attempts
  over: TransferEvidence（detail.kind='transfer_probe'，同 node+kind+bucket）
  仅统计 isomorphism='verified'（primary stratum）；unverified 单独分列

TransferGap(node, kind, bucket) = PracticeAccuracy(node) − TransferRate(node, kind, bucket)
  （正=迁移保持，负=迁移衰减；单位：百分点）
```

**四条禁止的落实**：①review 不进 practice accuracy（结构保证）；②probe 不进 practice accuracy（排除①）；③难度不混合（(node,kind,bucket) 分列）；④单学生样本不宣称节点聚合结论（§12 门禁）。

---

## 12. Evidence Gate（任务书 §15）

- `n < 5`（每 node×kind×bucket 跨学生探针样本）→ **不给出 TransferRate/Gap 数值**，状态 `insufficient_data`（诚实缺席，不是 0）。
- 样本量置信分级（预注册）：n≥5 = `low`；n≥20 = `medium`；n≥50 = `high`。
- **命名纪律**：字段名 `sampleConfidence`，basis 文案明写"样本量置信，反映样本多少，**不是**预测质量或模型置信"——与 S1 `confidence=样本量函数` 的教训（gap report False Confidence #9）对齐，防误读。
- 学生界面永远只见事件与门禁状态，不见聚合数值（§16）。

---

## 13. Attribution（任务书 §16）

每条 TransferGap 数值必须可回溯到真实探针。归因链（全部既有列/JSON 承载）：

```text
RecommendationAction(干预, id, targetId=nodeId)
  → StudyTask(干预任务, id, completedAt)
  → 干预作答 PracticeRecord(actionId, sessionId)
  → 探针 Action(evidenceRefs[].interventionActionId/interventionTaskId/difficultyBucket)
  → 探针 StudyTask(1:1)
  → 探针 LearningSession(type='transfer_probe', actionId, questionIds)
  → ProbeAttempt PracticeRecord(sessionId)
  → TransferEvidence(EVIDENCE_RECORDED, actionId=探针 Action.id,
                     detail{kind:'transfer_probe', probeId, questionId, bucket, isomorphism, correct})
```

投影输出每行携带：`studentId（仅明细层）/ nodeId / interventionActionId / taskId / probeId / attemptId(PracticeRecord.id) / timestamp / bucket / isomorphism`。聚合行可下钻到 n 条证据事件（n≥5 才有聚合行）。

---

## 14. Pollution Controls（任务书 §17，逐项设计与验证手段）

| 项 | 设计 | 验证手段 |
|---|---|---|
| **A 重做记忆** | E2 零作答硬查询（§3） | 选题器单测（构造有历史题断言排除）+ 集成 |
| **B 提前泄漏** | 探针题 analysis 在该生提交前不下发（会话快照含题干选项，解析字段由既有 question-view 剥离机制保证——学生视图剥答案/解析）；池题不出现在任何练习面 | question-view 单测 + 选题排除测试 |
| **C 同题复现** | 三源反查（全 surfaces，含未提交会话快照）+ 投递时刻二次校验 | 选题器单测 |
| **D 难度偏差** | 桶精确匹配 + 分列输出不混合 | 选题器 + 投影单测 |
| **E 内容泄漏** | 池独立（source 标记）+ 单点排除（§6） | data-quality 检查 PQ-3（§24） |
| **F 训练污染** | 池题被普通推荐/练习选取路径排除；探针会话不进 today mission（source='transfer-probe' 计划被 loadTodayScoreCenterPlan 的 source 过滤天然隔离——repository.ts:537） | data-quality + 集成断言 |

---

## 15. Student Experience（任务书 §18，最小体验）

- **探针任务卡**（今日区域/探针入口卡）："迁移复测 · {节点名}"，副文案："一道**从未见过的新题**（约 5 分钟）——检验上周的学习是否真的迁移到新题。这是复测，不是普通练习，不影响对错评价。"（对错影响 mastery 属系统内部语义，对学生措辞不施压。）
- **进行页**：复用既有练习会话组件（题干/选项/提交/用时），顶部轻量标识"迁移复测"。
- **结果页**："本次复测：答对/答错"+"这道新题的结果已计入你的学习记录"。**禁止展示** TransferRate/TransferGap 任何聚合数值；n<5 门禁下教师端也不显示数值。
- 无到期探针 = 探针入口静默（无卡片）；过期探针 = 中性"本次复测已过期"，无负面措辞。

---

## 16. Teacher/Admin View（任务书 §19）

`GET /coach/transfer-summary`（teacher/admin，resolveUserId 纪律）：

```text
rows[]: { nodeId, nodeName, kind, bucket, probeN, transferRate|null,
          practiceAccuracy|null, transferGap|null,
          sampleConfidence(low|medium|high), gate(insufficient_data|reported),
          poolRemainingByBucket, isomorphismSplit{verified, unverified}, lastProbeAt }
```

- `probeN < 5` → `gate=insufficient_data`，数值字段 null。
- `poolRemainingByBucket` 直接服务内容积压（§18）。
- 明细下钻（每条探针证据）同端点 `?detail=1` 返回，逐条带 §13 归因链字段。

---

## 17. 内容失败处理（任务书 §20）

`no_probe_available`（投递时刻选题失败）：

- 不计失败、不降 mastery（本就无作答）、不降 outcome、不增加 TransferGap 分母；
- 探针保持 scheduled，宽限窗（+7 天）内每日重试；届满转 `expired(reason=no_probe_available)`；
- 每次发生写入内容积压信号：按 `(nodeId, kind, bucket)` 计数进入 `/admin/data-quality` S2 区块 + `poolRemainingByBucket`（§16）——**内容缺口从静默变为可运营队列**（B13 流程先例）。

---

## 18. E2 Experiment Design（任务书 §21）

```text
样本：30 个高频节点（考频快照 recent3Y≥2，覆盖四科）× 每节点 2 道审定同构新题
      （1 道 practice-bucket + 1 道 exam-bucket，I1-I5 全满足，isomorphism=verified）
门禁：每 (node, kind, bucket) 跨学生 n ≥ 5 才输出 node-level aggregate
输出：practice_accuracy / transfer_rate / transfer_gap（分列 + 主结论只引用 verified stratum）
```

- 学生入选：真实生产账号、干预自然发生（不导演干预）；E2 只**观测**探针投递结果，不改变训练。
- 预注册：入选/排除规则（S1 E1 同款）、指标定义（§11）、门禁阈值、报告分层——先注册后看数。
- 判读：30 节点中 ≥70% 节点 verified stratum 出数（n≥5）且 TransferGap 分布可解释 → S2 机制验证通过；数字本身无论正负都如实报告（负 Gap 是发现，不是失败）。

---

## 19. Experiment Contamination（任务书 §22）

**数据边界（单向玻璃）**：

```text
practice → training 面：练习选题、推荐、掌握度回流、正确率叙事
probe   → measurement 面：证据台账（detail.kind）、探针投影
```

- 探针作答**会**进 mastery（C3，探针=干预）——这是链路定义，不是污染；污染指"测量口径互相渗漏"：①PracticeAccuracy 排除探针（§11-①）；②TransferRate 只读探针证据；③探针池题对训练面不可见（§6）；④E2 不做任何旁路写入——全部经生产 API（与 S1 E1 同纪律），实验数据即生产数据，无第二管线。
- 报告层双标签：每个数字标注来源面（training/measurement），杜绝混算。

---

## 20. Cold Start（任务书 §23）

新学生无练习历史：`PracticeAccuracy = unavailable` → `TransferGap = unavailable`（TransferRate 仍可报，若探针已发生）。

- **禁止**把 neutral 0.5 当 practice accuracy（0.5 是掌握度先验，不是观测正确率——S1 冷启动同款纪律）。
- 投影输出 `practiceAccuracy: null + basis:"该节点尚无可计入的客观练习记录"`；UI 显示"练习表现数据不足，暂无法计算迁移差"。
- 入学诊断测是 Cold Start 的终解——**显式不在 S2 范围**（Part 3 §31-D7 已排除）。

---

## 21. Recommendation Boundary（任务书 §24）

S2 只产出 `TransferRate / TransferGap` 只读投影。**禁止** TransferGap → ROI → production ranking 的任何接线；推荐排序货币仍是 priority（S4 未批准）。探针对推荐的唯一影响 = C3 的 mastery 回流（既定语义）。投影端点对 ranking 代码零 import（边界断言覆盖）。

---

## 22. API Design（任务书 §25——复用优先）

| 端点 | 性质 | auth/role | 幂等 | SoT | 读/写 | 错误语义 |
|---|---|---|---|---|---|---|
| `GET /coach/transfer-probes` | **新增**（懒投递+到期列表） | 登录（self-only） | 懒排程/懒投递经 creationKey+actionId 唯一收敛；重复 GET 无副作用 | 写：Action/StudyTask/LearningSession；读：自身 | 读为主（投递时写调度事实） | 无库 → store_unavailable；未登录 401；越权 403 |
| `POST /sessions/practice/start` | **复用**（DTO type 白名单 + 'transfer_probe'） | 登录（self） | actionId @unique（一探针一会话） | LearningSession | 写 | 既有语义；type 非法 400 |
| `POST /sessions/practice/:id/submit` | **复用**（探针会话提交；事务内加探针证据写入） | 登录（self+ownership） | AnswerReceipt + 会话提交幂等 | PracticeRecord/mastery/evidence | 写 | 既有语义 |
| `GET /coach/transfer-observation` | **新增**（学生本人事件+门禁状态） | 登录（self） | 读 | 投影 | 读 | 同上 |
| `GET /coach/transfer-summary` | **新增**（teacher/admin 节点聚合） | teacher/admin（teacher 需授权记录） | 读 | 投影 | 读 | 同上 |

**不新增**：探针作答端点（复用练习提交）、探针判分端点（复用判题）、探针证据端点（复用台账）。新增 3 个读端点 + 1 个 DTO 白名单值 + 1 处提交事务内证据写入——这是"复用优先"原则下的最小 API 面。

---

## 23. UI Design（任务书 §26，最小四件）

1. **探针任务卡**（今日区域，§15 文案）；
2. **探针进行页**（复用练习会话，顶部"迁移复测"标识）；
3. **探针结果**（提交后即时反馈：对/错 + 已计入学习记录；无聚合数字）；
4. **Teacher/Admin Transfer Summary**（§16 表格：节点×kind×bucket×门禁状态；含 poolRemaining 内容积压列）。

不扩展任何视觉功能；纯 token；静态演示模式探针面 return null。

---

## 24. Data Quality（任务书 §27——/admin/data-quality 增 S2 区块）

| 检查 | 级别 | 处置 |
|---|---|---|
| probe question had prior attempt（投递后反查命中） | **Blocking（测量作废）** | 探针 invalidated，投影剔除；计数 |
| probe question exposed before（会话曝光命中） | **Blocking（测量作废）** | 同上 |
| probe question duplicated（contentFingerprint 重复入池） | Warning | 内容队列 |
| difficulty mismatch（探针桶 ≠ 登记桶） | Warning | 计数 + 投影按实际桶归层 |
| missing attribution（探针证据无 actionId/interventionActionId） | **Blocking（投影排除）** | 证据保留但不入聚合；计数 |
| probe result without probe task（证据无对应 Action/StudyTask） | **Blocking（投影排除）** | 同上 |
| probe evidence without attempt（有证据无 PracticeRecord） | Warning | 事务原子性应使其不可能；出现=缺陷信号，告警 |
| practice accuracy contains probe/review | **Blocking（投影缺陷）** | 投影单测+运行时断言双保险；出现即修 |
| no_probe_available 计数（按 node/bucket） | Warning | 内容积压队列 |

Blocking=该观测不进聚合（数据仍保留可审计）；Warning=可见计数。两者都不阻塞既有链路。

---

## 25. Rollback（任务书 §28）

| 层 | 机制 |
|---|---|
| feature flag | `TRANSFER_PROBE_ENABLED`（未设置/未知值=off，沿用 MASTERY_SEMANTICS 单点解析惯例）：off → GET transfer-probes 返回空、不排程不投递；既有端点其余行为不变 |
| scheduler rollback | flag off 即停止新排程/投递（懒投递天然无后台进程可停） |
| projection rollback | 投影端点摘除或 flag off；投影无状态可随时重建 |
| content rollback | 移除 Question.source 池标记（内容团队动作）；已投递探针不受影响 |
| 历史数据 | **Transfer Evidence 永不删除**；回滚只停新增；schema 零变更 → 无迁移回滚面 |

---

## 26. Implementation Milestones（任务书 §29）

| # | Goal | Files（预计） | Dependencies | Acceptance | Tests | Rollback |
|---|---|---|---|---|---|---|
| **S2.1 Probe identity** | Action(type='TRANSFER_PROBE')+StudyTask(source='transfer-probe' 计划) 创建/读回编排（纯函数+service） | `apps/api/src/transfer-probe/transfer-probe.service.ts`、`transfer-probe.ts`(shared 纯函数：creationKey/窗口/状态推导)、study.module 注册 | 无 | creationKey 幂等；evidenceRefs 携带干预归因；源码边界断言（无 mastery 写原语） | 单测（键/窗口/状态推导） | 摘除模块 |
| **S2.2 Question eligibility** | 三源反查+E1-E6 selector（shared 纯函数 + 只读装载） | `transfer-probe/question-eligibility.ts`（shared）、service 装载 | S2.1 | 构造历史题/曝光题/同族题全排除；无合格→no_probe_available | 表驱动单测 | 纯新增 |
| **S2.3 Probe pool isolation** | 练习选题面排除池题；池内容约定文档化 | practice-set 选题查询 +1 排除条件；内容任务说明 | 内容任务启动 | 选题查询不返回池题（集成断言）；学生面不可见 | 集成断言 | 移除过滤条件 |
| **S2.4 Probe scheduler** | 懒投递扫描（GET transfer-probes）：到期+36h 守卫+多节点限流+宽限重试+过期 | transfer-probe.service + controller | S2.1/S2.2 | 状态机全转换覆盖；expired 不计失败；幂等重放 | 服务单测 + 状态机表驱动 | flag off |
| **S2.5 StudyTask integration** | 探针任务面呈现/完成联动；intervention completion 钩子+懒补偿 | completeStudyTask 分支 +1 调用；today 面不混入（source 隔离验证） | S2.4 | 干预完成→探针排程（幂等）；探针不入每日 mission | 行为测试 | 摘除钩子 |
| **S2.6 Probe submission** | 会话 type 白名单+'transfer_probe'；提交事务内证据写入（detail.kind） | learning-session.dto、submit 事务、recordObservedPerformance 调用 | S2.4 | 作答→mastery 回流（C3）+证据原子落库；AnswerReceipt 幂等 | 服务单测+集成 | flag off（作答仍可用普通语义提交？否——探针会话入口随 flag 关闭） |
| **S2.7 Transfer observation projection** | PracticeAccuracy/TransferRate/Gap 纯函数+门禁+两个读端点 | shared projection 纯函数、只读 service/controller | S2.6 | n<5 诚实缺席；分层不混合；归因链下钻 | 投影单测（含门禁边界） | 端点摘除 |
| **S2.8 Frontend** | 探针卡/进行页标识/结果页/Teacher Summary | `features/transfer-probe/` + api/endpoints + ReportWorkspace/今日区挂载 | S2.4/S2.7 | 诚实文案（§15）；静态演示隐藏；纯 token | 行为测试；build:web | 摘除挂载 |
| **S2.9 PostgreSQL E2E** | `integration-transfer-probe.mjs`：干预→排程→投递→未曝光保证→作答→证据→mastery 回流→投影→污染注入失效案例 | scripts/ + package.json script | S2.1-S2.8 | 全链断言 + 四类 Blocking 数据质量案例被正确作废 | exit 0 | 脚本只读可删 |
| **S2.10 E2 experiment** | runbook + 内容任务（30 节点×2 题）+ 分析脚本 | `docs/s2-e2-experiment-runbook.md`、`scripts/analyze-transfer-probe-e2.mjs` | S2.9 + 内容就绪 | 首批 verified stratum TransferGap 数字（或诚实缺席记录） | 分析脚本干跑 | 只读 |

依赖链：S2.1 → S2.2 → {S2.3 内容并行} → S2.4 → S2.5/S2.6 → S2.7 → S2.8 → S2.9 → S2.10。

---

## 27. Non-Goals（任务书 §30，逐条固化）

NO second mastery engine ｜ NO second task system ｜ NO second evidence ledger ｜ NO Verified Score Gain ｜ NO ROI production ranking ｜ NO recommendation currency switch ｜ NO F4 ability mapping ｜ NO deployment ｜ NO unrelated AI features ｜ NO Diagnostic pipeline ｜ NO FSRS/Review 语义触碰。

---

## 28. Design Validation（任务书 §31，一致性自检 Check A–H）

| Check | 问题 | 裁决 | 依据 |
|---|---|---|---|
| **A** 所有数据唯一 SoT？ | **通过** | 作答=PracticeRecord、排程身份=Action+StudyTask、测量=evidence ledger、池标记=Question.source、结论=投影——每个事实恰一个家 |
| **B** Probe 污染 practice？ | **通过（有界例外）** | PracticeAccuracy 三重排除（§11）；探针池对训练面不可见（§6）；探针会话不进 today mission（source 隔离，repository.ts:537 实证）。例外=mastery 回流（C3 批准语义，非污染） |
| **C** Probe 意外改变 recommendation？ | **通过（有界例外）** | 唯一影响=mastery 回流→weakness 分量（C3 链路定义）；探针 Action 不产生今日任务（计划 source 隔离）；无排序代码 import 投影 |
| **D** History 可解释？ | **通过** | 每条探针证据带 §13 全归因链字段；evidenceRefs 记录干预身份；occurrence 键逐次可溯 |
| **E** 同一 probe 提交两次？ | **通过** | 会话提交幂等（AnswerReceipt）+ LearningSession.actionId @unique（一会话）+ Action creationKey（一身份）——三层防线 |
| **F** Student isolation 可证明？ | **通过** | 全端点 self-only/role 纪律；service 层 ownership 校验；集成脚本含越权断言（S1 先例） |
| **G** TransferRate 被旧题重做污染？ | **通过** | TransferRate 只读探针证据（detail.kind='transfer_probe'），旧题重做在 ReviewAttempt 链、普通重做在非探针会话——结构上不可达 |
| **H** S2 偷偷实现 S3？ | **通过** | 投影是终端产物；无 ROI/opportunity/排序消费代码位；Non-Goals §27 + 边界断言双重锁定 |

---

## 29. 判定

```text
S2 FORMAL DESIGN = READY

依据：
  • C1-C4 四项 Owner Decisions 全部落实且未越界（α：零 schema；C2：StudyTask 承载经
    source 隔离验证可行；C3：canonical path 唯一回流；C4：内容任务独立、诚实缺席）
  • 五概念零新表（三复用 + 二投影），无第二 SoT
  • 状态机/幂等/调度/污染/门禁/回滚全部落在既有机制上，仅三处受控词表扩展
    （session type、actionType、Question.source 约定值）+ 两个只读端点 + 一处事务内证据写入
  • Check A–H 全过；两条 BLOCKED 触发线（新题身份/干预归因）均有硬查询与既有链支撑
  • 48h±6h 在日粒度下近似为 36h–96h 窗口——C2 固有代价，已如实声明（§8），不构成 READY 的减项

前置条件（实现前）：
  P1 内容任务启动（30 节点×2 题审定清单，E2 前就绪；M1 可先以 unverified fallback 开发）
  P2 实现期遵守 §16 源码边界断言与 §27 Non-Goals
  P3 部署仍由所有者人工执行（沿用 runbook 惯例；本设计零迁移，部署面=代码+内容标记）
```

Formal Design 到此完成。停止——不编码、不迁移、不 commit、不 push、不开始 S3、不擅改 C1-C4。
