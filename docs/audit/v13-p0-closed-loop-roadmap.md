# V13 P0 提分闭环路线图

> 创建：2026-09-14。依据：`docs/audit/v13-baseline-report.md`（基线评分，同日生成）+ `docs/audit/v13-rubric.json`（评分口径）+ Owner V13 审计框架。
> 性质：**路线提案，不是实施授权**。所有触写语义/生产行为/锁定项的工作项均标注 Owner 门；Agent 不得擅自解锁（AGENTS.md RULE-13/14）。
> 唯一北极星：把提分闭环判定从 **FAIL** 推向 **PASS**——不是堆功能。V13 之后不再以 V14/V15 加功能的方式演进，而是沿本路线收敛。

---

## 0. 基线与验收线（本路线要改变什么）

**基线（2026-09-14，HEAD 56e3fe11）**：V13 总分 0.5579/1.00；五层字母档全 B；**提分闭环 = FAIL**（层门禁 PASS，P0 门禁 FAIL：闭环层 10 个 P0 项 < B）。

**PASS 线（本路线的验收定义，与 rubric 一致）**：

```text
1. 层门禁：Diagnosis / Decision / Training / Validation 每层等级 ≥ B（层分为层内等权均值）
2. P0 门禁：上述四层内所有 P0 审计项等级 ≥ B
3. 且每个升到 B 的项都有新的代码级证据支撑（改 v13-evidence.json 重跑 npm run audit:v13 验证）
```

**闭环 P0 短板（FAIL 的直接原因，本路线的靶子）**：

| 审计项 | 等级 | 一句话根因 |
|---|:---:|---|
| G4 题型能力诊断 | D | 题型维度不存在（数据层 D4 = C 是前置） |
| G9 跨题模式诊断 | C | 无『时间窗 × 错误类型 → 技能缺口』聚合器 |
| R5 难度调节 | C | 主推荐路径无表现驱动的难度升降 |
| R8 大题策略 | C | rubric 丢分维度不进推荐 |
| R10 策略自适应 | D | 推荐失败不改变策略，无写回链路 |
| T2 刻意训练 | C | 无微技能训练模块，只有文案建议 |
| V3 题型增益 | D | 无题型维度增益度量（前置同 D4） |
| V8 学习效率 | D | 无 gain/hour 指标（practiceEfficiency 恒 null） |
| V9 推荐效果 | C | 有分流器无实验：没有 feature 按 arm 分叉 |
| V10 策略效果 | C | 离线比较器未接线、无真实比较数据 |

（另有数据层 D4 题型数据 = C，虽不在闭环四层内，但它是 G4/V3 的前置，一并纳入。）

**结构性结论**（来自五路取证）：系统不缺测量仪器（验证层结构近乎全有但生产样本 = 0），缺的是两样东西——**处方层**（诊断信号 → 训练参数的映射，目前只有文案没有代码）与**证据回流**（outcome/探针/校准结果不回写决策）。本路线据此分四个 Phase。

---

## 1. 三条轨道与全局约束

每个工作项属于以下轨道之一：

- **ENG（工程轨）**：Selector / Projection / 纯函数优先，零 SoT 污染（继承 V11 冻结与 V12 宪法）。
- **CONTENT（内容轨）**：教研侧动作（题目标注、rubric 撰写、探针池题、考频补录）。工程侧只负责把它变成可见队列（`/admin/data-quality` 模式）。
- **GATE（Owner 门）**：需要 Owner 明确批准才能动的事项（写语义、schema、生产行为、锁定项解锁）。

全局约束（全程有效）：

1. **RULE-11 红线**：任何阶段产出不得声称 Verified Score Gain；学生可见的增益表述必须带 insufficient_data / 估算标记，直到 Phase D 的 E1 校准实验产出配对样本并过预注册门禁。
2. **影子 → 人在环 → 生效** 三段式：新排序/调度/策略语义一律先影子（NON-AUTHORITATIVE），预注册阈值达标后由 Owner 决定切换（复用 M3 Phase C 的迁移纪律）。
3. 每阶段走 RULE-01 三段门禁 + RULE-03 真实 E2E（含拒绝路径）。
4. **内容不就绪不阻塞工程**：每个 ENG 项在内容 = 0 时必须诚实降级（coverage=0 / insufficient_data），禁止为凑数生成内容或降低验证标准（B8 教训）。

---

## 2. Phase 0 —— Release & Reliability（前置，Owner 已定，不新增范围）

当前 Phase 就是它（current-sprint 09-13 权威块），本路线**不重排、不扩项**，只声明依赖：

| # | 事项 | 本路线视角的意义 |
|---|---|---|
| R0.1 | S1 push + 生产部署 + 迁移 38 验证 | ScoreLossItem / maxScore 列到达生产，Phase A/D 的读路径才有生产数据 |
| R0.2 | **Question.maxScore 内容标注**（当前 = 0，CONTENT） | D8/V5/R8/B2 的硬前置：未定价则 score-loss 只能 coverage=0 |
| R0.3 | 并发 Mastery 提交缺陷修复（P1.5，独立任务） | 提交链可靠性是所有"训练→状态更新"度量的地基；**⑤ 不先于 ⑥ 完成** |

**完成判据**：与 Owner 09-13 决策一致（DEPLOYED AND VERIFIED + maxScore 标注 > 0 + 并发缺陷关单）。之后才进入 Phase A。

---

## 3. Phase A —— 失分原因模型 + Error Pattern Engine（P0-1 / P0-2）

**靶子**：G9（C→B）、G3/D5（补强）、T1（错因→训练的输入侧）、G10（错因置信）。
**原则**：诊断语义变更触 RULE-14 → A1 需 Owner 批准；A2/A3 是只读投影，Design Gate 后可自主实施。

### A1 错因可达性与自报闭环（ENG + GATE）

现状：8 类枚举里『公式记错』『计算错误』规则永不可达；自报错因与作答时刻分离且覆盖不全；无『粗心』『迁移失败』类。

- A1.1（ENG，先做）：**错因可达性显式化**——classifyMistake 输出附 `inferred: true` + 可达性标注（哪些类别规则可产出），复习自报入口的错因回填到错题视图（现有 selfReportedReason → ReviewSchedule/ReviewAttempt 链路打通到学生可见）。零语义变更，纯诚实化。
- A1.2（GATE）：taxonomy 扩展决策——是否新增『粗心失误』『迁移失败』类、是否把自报错因并入作答事件。属诊断语义变更，STOP 上报，附本路线的建议方案再定。
- 验收：错因标注覆盖率的可见指标（自报率、规则可达类分布）；集成测试钉死『不可达类不得被规则产出』。

### A2 Error Pattern Engine（ENG，核心交付）

从『错题 1、2、3』到『14 天内同型错误 N 次 → Skill Gap』：

- 纯函数 selector（`packages/shared/src/score-center/error-pattern.ts` 风格）：输入 = PracticeRecord（时间窗 14 天）× 错因标签 × 节点/题型 × 难度；输出 = 聚合模式列表（`{nodeId, patternKind, occurrences, window, confidence, sampleSize}`），n < 阈值 → insufficient_data，缺错因标签的记录按『未标注』分桶不冒充任何类。
- 只读端点 `GET /coach/error-patterns`（self 消费 + teacher/admin 聚合），零写入、零 SoT。
- 题型维度依赖 D4 扩展前的降级：先按 节点×错因 聚合，题型列诚实缺席。
- 验收：G9 升 B 的证据 = 该引擎 + 集成测试（真实 PG 数据回放）+ 与人工查看路径的一致性断言。

### A3 诊断消费（ENG）

报告页/今日任务展示 Top 失分模式（『连续 6 次：知道公式但不会把条件转成公式 → 建模能力缺口』形态），接入 WhyRecommendedDrawer 同款诚实分区（evidenced/inferred）。

---

## 4. Phase B —— Skill → Training Ladder + Adaptive Policy（P0-3 / P0-4）

**靶子**：T2（C→B）、R5（C→B）、R10（D→B）、R8（C→B）；顺带补 T3/T5/T6/T10/R4/R12 的形态维度。
**原则**：处方层全部以 Selector 落地（诊断信号 → 任务参数），不建第二套任务系统；策略写回是唯一触写语义处 → B3 需 Owner。

### B1 训练阶梯处方 selector（ENG，核心交付）

- 定义 ladder 契约（纯数据，不改 StudyTask schema）：`{skillGap, rungs: [recall → micro-drill → basic → variant → comprehensive → real-exam → novel]}`，每 rung 附目标与过关判据。
- 处方映射纯函数：输入 = error-pattern（A2 输出）+ mastery + 难度表现 + 预算；输出 = 下一组题的**训练参数**（难度序列 / 变式族要求 / 时限 / 形态）。
- **接线已建未用的资产**（取证发现）：`adaptive-exam.ts` 四模式分层考卷生成器（全仓无调用）接入处方输出；`clampDifficulty` 死代码清理或在主路径启用。
- 微技能 drill 的最小实现：以『结构化练习会话 + 过关判据』承载（如『递归状态手推：给 3 个状态变化，判对 2 个才算过』），不新建独立模块体系。
- 验收：T2 升 B 证据 = 至少一条 skillGap → ladder → 过关判据 → 状态更新的端到端集成测试；R5 升 B = 表现驱动的难度升降在主路径生效且有 difficulty transition 记录。

### B2 大题 rubric 维度 → 训练映射（ENG + CONTENT + GATE）

- 前置：R0.2 maxScore 标注 + rubric 内容批次（CONTENT，走既有 B4/B8 验证链：verified 需结构半+人工半）。
- 映射：丢分采分点维度（算法设计/计算/规范）→ 对应训练 rung（复用 B1 ladder）。rubric 维度进推荐输入是排序语义扩展 → **GATE**。
- 验收：R8 升 B 证据 = 一条『采分点丢分 → 对应训练任务生成』的 E2E（真实 PG + HTTP + 拒绝路径）。

### B3 outcome → 策略写回（ENG + GATE，本路线最高风险项）

现状：outcome-tracking/action 信号/探针结果全部 terminal，不回流任何决策；R10 = D。

- 影子期（ENG 可做）：策略参数候选生成器——读 outcome verdict（连续 FAILED / no_change）+ error-pattern 变化，产出『策略调整建议』（降难度 / 换 rung / 收缩范围），只展示不生效。
- 生效期（**GATE，触 RULE-14**）：把建议写回推荐参数。必须预注册（什么条件、改什么参数、预期指标、回滚方式），人在环批准，复用 M3 Phase C 的 shadow → switch 迁移纪律与回滚机制。
- 验收：R10 升 B 证据 = 一条完整的『推荐连续无效 → 策略参数变化 → 效果复测』链路（生产样本积累后）。

---

## 5. Phase C —— Transfer Test 闭环（P0-5，= 解锁 S2）

**靶子**：T11（B→A 路径）、V4（B→A 路径）、V1（pre 侧）。
**现状**：S2 Transfer Probe 代码完备（14 步集成验证）但 `TRANSFER_PROBE_ENABLED=false`、探针池 0 题——**整个 P0-5 已经建好，卡在内容与 Owner 解锁**。

| # | 事项 | 轨道 |
|---|---|---|
| C1.1 | 探针池内容：30 节点 × 2+ 道 verified 同构新题（Owner 已批内容任务，audit:probe-content 工具就绪） | CONTENT |
| C1.2 | 生产开启 TRANSFER_PROBE_ENABLED（池题就绪后） | GATE（Owner，runbook 已有） |
| C2 | pre-probe 基线设计：干预**前**也投一枚等价探针，使 V4 从『迁移水平』升级为『迁移增益』；属探针语义扩展 | GATE（触 S2 锁定项） |

**顺序约束**：C1 先于 C2（没有 post 样本谈不上 pre 对照）。**任何训练（B1 ladder）的最终过关判据必须是陌生题**——这是 V13 框架 P0-5 的原则：训练成功可能只是记住了训练题。B1 的 ladder 顶层 rung（novel）在 C1 就绪前以『未曝光真题变式』降级替代并显式标注局限。

---

## 6. Phase D —— Learning Gain 结算 + 提分仪表盘（P0-6 / P0-7）

**靶子**：V8（D→B）、V9/V10（C→B）、V3/G4/D4（题型线，D→B）、G11/V7/V12（校准样本从 0 起步）。

| # | 事项 | 轨道 | 验收（对应审计项） |
|---|---|---|---|
| D1 | **E1 校准实验执行**：教师判分模考 + 成绩导入 → ScorePrediction×ScoreOutcome 配对从 0 起步；按预注册门禁（n≥5 且 median<15）滚动判定 | CONTENT+ENG（实验手册已有，score-calibration 机器已建） | G11/V7/V12 的生产样本；估算置信随配对升级 |
| D2 | **题型子类型扩展**：QuestionType 细分（单选/多选/算法设计/计算/综合应用…，schema additive + 全量内容重标 + 导入白名单） | GATE（schema）+ CONTENT | D4 C→B；解锁 G4（题型维度诊断）与 V3（题型增益聚合） |
| D3 | **gain/hour 指标**：观测时间（totalActiveMs/minutesSpent）÷ masteryGain，样本与增益口径分开列、insufficient_data 不出数；填充 practiceEfficiency 占位 | ENG（effectiveness 模块增量） | V8 D→B |
| D4 | **推荐对照实验**：coach-experiments 分流已有，缺 feature 按 arm 分叉 + 实验定义（推荐组 vs 基线策略，预注册指标=minSampleSize 门禁下的 masteryGain/迁移表现） | **GATE（生产行为变更）** | V9/V10 C→B |
| D5 | **Score Improvement Dashboard**：首页收敛为『预计能力/四科/近 14 天能力变化/学习效率/最大失分源/未来 7 天配比』——**纯前端消费既有诚实指标**（score-loss、error-patterns、effectiveness、review-shadow、探针），无新 SoT、无锁定依赖，**可提前至任意 Phase 并行做** | ENG | P0-7 落地 |

**D5 的诚实边界**：在 E1 校准样本过门禁前，『预计能力』必须带估算徽标与区间（estimatePredictedScore 已有 disclaimer），不得呈现为已验证分数。

---

## 7. 依赖图与建议顺序

```text
Phase 0 (R0.1-R0.3, Owner 已定)
   │
   ▼
Phase A (A1→A2→A3)  ──────────────► error-patterns ──┐
   │                                                 │
   ▼                                                 ▼
Phase B (B1 → B2 ──B3)                        处方层消费诊断输出
          │        │
          │        └─ GATE: 写回语义（预注册+人在环）
          ▼
Phase C (C1 内容 → 开启探针 → C2 pre-probe GATE)
          │
          ▼
Phase D (D1 实验执行 ∥ D2 题型扩展 GATE ∥ D3 ∥ D4 GATE；D5 可随时并行)
```

- **A→B 强依赖**（处方层吃 error-pattern 输入）；**C/D 与 B 可部分并行**（C 卡内容、D1 卡实验执行、D2 卡 Owner+内容）。
- 建议节奏：Phase 0 收口 → A（约 2 个 Design Gate）→ B1 → C1 内容批次与 D5 并行 → B2/B3 → D。
- **每完成一个工作项**：更新 `v13-evidence.json` 对应项的评级与引用 → 重跑 `npm run audit:v13` → 闭环短板清单缩短即进度。

---

## 8. STOP 条件（本路线全程）

触发即停，上报 Owner（格式见 AGENTS.md RULE-14）：

1. A1.2 / B2 / B3 / C2 / D2 / D4 任一 GATE 项未获批而工作已顶到其边界；
2. 任何工作项需要修改 Score / Mastery / Evidence 语义（score-mastery-evidence-semantics.md 契约）而未单独获批；
3. 内容轨交付物无法满足既有验证链（B4/B8）而有人提议降标凑数；
4. 出现与本路线冲突的新 Owner 决策（以 current-sprint.md 权威块为准，本路线让位）。

**明确不做**（V13 框架裁决）：AI 对话能力增强、新页面/新 Agent、RAG 扩展、任何不能回答六问的功能（见附录）。

---

## 9. 附录：六问生死线（每个新功能/工作项的准入门）

任何进入本路线的新增工作项，必须在 Design Gate 阶段书面回答：

```text
1. 它解决了哪个失分问题？
2. 它改变了学生的哪个行为？
3. 它改变了哪个能力指标？
4. 为什么这个能力指标与 408 得分有关？
5. 如何通过实验验证它真的有效？
6. 如果学生用了以后没有提升，系统下一步怎么办？
```

答不出 → 不做。建议 Owner 批准后将此六问并入 `docs/development/development-protocol.md` 的 Design Gate 清单（本路线不擅自修改 protocol）。

---

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-14 | 初版：基于 V13 基线评分（0.5579 / 闭环 FAIL / 10 项闭环 P0 短板）制定四 Phase 路线。 |
