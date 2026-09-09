# V12-0 — Score Improvement Intelligence Audit

> 审计日期：2026-09-10。方式：只读（git 只读 + 定向 grep 实证 + 生产路由外部探测 + 本会话多轮真实数据 E2E）。
> 审计人：长期研发负责人。**零代码修改、零 Schema 触碰、零生产行为变更**（工作树审计后仅新增本报告与账本）。
> 状态：**审计完成 → STOP**。等待所有者确认 V12 正式路线。

---

## 1. Executive Summary

**一句话**：系统的"练习→判题→掌握度→推荐→任务→模考→报告"执行闭环已在生产真实运转且写路径纪律扎实（幂等脊柱完整、唯一写方收敛、2049 测试基线），但**"提分结果"侧存在三处结构性断链**——任务完成与"标记已复习"不产生任何能力证据、推荐曝光无遥测（Seen 层缺失）、能力变化与考试分数之间无验证通路——因此系统今天**能证明"学生练了"、部分证明"学生会了"，完全不能证明"分数因此提高"**。距离真正的 Score Improvement Engine：不缺功能，缺的是把三条断链接上，并让每一环产出可解释的证据。

**补充**：V11 全部代码（M1 数据质量 / M2 学习证据 / M3 推荐诚实化 / M4 影响度量）已交付 origin，**生产部署 DEFERRED（所有者门控）**——即 V11 已建成的"校准/保持/效果"三层度量，尚未在生产产生任何真实样本。

---

## 2. Repository Reality

| 项 | 实测事实 |
|---|---|
| 分支 | `feature/v3-product-refactor` |
| HEAD | `05ec826`（V11 final production release handoff） |
| origin | **与 HEAD 同步（领先 0 / 落后 0）** |
| 工作树 | 干净（仅 `.zcode/` 未跟踪） |
| V11 状态 | M1-M4 全部 code-complete + 已推送 origin |
| 生产 | **`43b715e` 前后构建**（F1 真题对标 + F2 诊断前端 + V11-M1 数据质量已上线；V11-M2/M3/M4 端点 404 未部署——本轮路由探测实证） |
| 测试基线 | 2049/2047/0（LE 全套定向 26+8+15+6+10 项全绿）；build:shared/api/web PASS |
| 已知环境债 | 集成脚本 review-scheduler 断言（所有者定的稍后项） |

**V11 正确状态**：`RELEASE READY (M1-M4) — DEPLOYMENT DEFERRED`。

---

## 3. Score Improvement Capability Map

| 能力层 | 状态 | CONFIRMED | PARTIAL | MISSING / CANNOT PROVE |
|---|---|---|---|---|
| **Student Behavior** 行为采集 | **CONFIRMED** | PracticeRecord（三写路径+Idempotency-Key）、ReviewAttempt、StudyTaskCompletion、LearningSession | — | 行为→能力归因元数据不全（曝光/接受遥测缺，见 §4） |
| **Learning Evidence** 学习证据 | **PARTIAL** | 练习事实、task-evidence（任务±3天练习+掌握度Δ）、outcome-tracking（干预前后对照）、F1 逐题 evidenceRefs | 证据**不回流**任务完成语义（P1-1）；**生产未部署 V11-M2+** | "学生看见了推荐"零遥测（EB-3） |
| **Knowledge Mastery** 掌握度 | **PARTIAL** | EMA+OCC 唯一写方（5 写点收敛）+ 每日快照 + stability/retention 字段 | **两套复习算法并存**（SM-2 vs EMA，互不同步，B3）；retention 公式未与真实遗忘校验 | FSRS 预测器 SHADOW 未接入任何决策 |
| **Diagnosis** 诊断 | **PARTIAL** | 薄弱报告 + F1 考频×缺口排序 + F2 诊断书（分科/节点失分×考频/差距/闭环率） | **假掌握检测缺失**（无真掌握/熟练度区分机制）；错因五分类有、跨题模式聚合无 | — |
| **Score Opportunity** 提分机会 | **PARTIAL** | 考频×缺口×方向（F1）；primaryScore5y 分值权重 | Recoverability（恢复成本）、单位时间收益**未建模**；四因子公式未审计数据支持 | — |
| **Intervention** 干预/训练 | **PARTIAL** | 推荐→任务→练习闭环；断档恢复/时长预算/保温候选(selector) | **大题训练 MISSING**（70/150 分，F4 content-blocked）；交错/自我解释未建 | — |
| **Assessment** 测评 | **CONFIRMED** | 模考会话/报告/考后任务/成绩趋势/150 分诊断估算（F2） | 估算分=正确率×结构折算，**非真实评分**；无逐题 rubric | — |
| **Score Improvement Proof** 提分证明 | **CANNOT PROVE YET** | score-history（真实模考分）、score150Estimate（估算）、影子协议结构 | **估算分与真实分之间零对照**；干预效果生产样本 = 0；无对照实验流量 | 无真实成绩回流验证通路 |

---

## 4. Intervention Evidence Chain Audit

```
1 Recommendation Generated → 2 Student Saw → 3 Accepted/Started
→ 4 Training Executed → 5 Practice Evidence → 6 Ability Changed
→ 7 Assessment Changed → 8 Score Changed
```

| # | 链路层 | 证据存在？ | SoT / 位置 | Projection | 关联上层 | 关联下层 | 产品消费 | 状态 |
|---|---|---|---|---|---|---|---|---|
| 1 | Recommendation Generated | ✅ | RecommendationAction（creationKey 幂等）+ reasonCodes + scoreBreakdown | reasonCodes 随任务下发 | ✅ 诊断（考频×缺口） | ✅ 任务生成 | ✅ 任务行"为什么" | **CONFIRMED** |
| 2 | Student Saw | ❌ | **无曝光遥测**（前端推荐面零 trackEvent；UserEvent 无 recommendation.seen 类型） | — | — | — | ❌ | **MISSING** |
| 3 | Accepted / Started | ✅ | RecommendationAction 状态 + actionId 关联 PracticeRecord | — | — | — | 部分 | **CONFIRMED** |
| 4 | Training Executed | ✅ | PracticeRecord + LearningSession（8s 自动保存/断点恢复/revision 乐观锁） | — | — | — | ✅ | **CONFIRMED** |
| 5 | Practice Evidence → Ability Changed | ⚠️ | UserKnowledgeMastery EMA + 每日快照 | task-evidence / outcome-tracking（V11-M2/M4.3） | ✅ actionId/questionId 归因 | ✅ 快照前后 | 部分（report，**待部署**） | **PARTIAL** |
| 6 | Assessment Changed | ⚠️ | AssessmentHistory + F2 诊断（150 估算/分科/节点失分） | — | ✅ 节点归因 | ✅ 恢复任务 | ✅ 诊断面板 | **PARTIAL** |
| 7 | Score Changed | ❌ | score-history 有真实模考分，但**与干预无对照**；估算分≠真实分 | — | — | — | ❌ | **MISSING** |

**Evidence Break 清单**：

| # | 断点 | 类型 | 位置证据 |
|---|---|---|---|
| EB-1 | 任务完成 → 零能力证据（completeStudyTask 无掌握度/证据写） | Broken Link | study.service.ts completeStudyTask（:3371 起） |
| EB-2 | "标记已复习" → 零掌握度回流（applyReview 仅 isReview=true） | Broken Link | study.service.ts:2324-2329 |
| EB-3 | 推荐曝光零遥测（Seen 层整体缺失） | Missing Measurement | 前端推荐面零 trackEvent（grep 实证） |
| EB-4 | 能力变化 → 真实分数无验证通路（估算分从未与真实成绩对照） | Unverified Outcome | score-history 与 diagnosis 无关联查询 |
| EB-5 | 复习尝试（ReviewAttempt）不回流掌握度（SM-2 与 EMA 双算法并存） | Fake Intelligence 风险 | study.service.ts:2279-2287 |

**CAN PROVE / PARTIAL / CANNOT PROVE**

| 命题 | 判定 |
|---|---|
| 系统知道学生练了什么 | **CAN PROVE** |
| 系统知道学生哪些会/不会 | **CAN PROVE**（粒度到节点；假掌握区分 SHADOW） |
| 系统知道学生为什么错 | **CAN PARTIALLY PROVE**（五分类有；模式聚合无） |
| 系统知道该练什么、为什么 | **CAN PROVE**（考频×缺口+理由码；时间成本维度缺） |
| 干预后能力是否变化 | **CAN PARTIALLY PROVE**（投影已建；生产未部署、真实样本 0） |
| 学生的 408 分数在提升 | **CANNOT PROVE YET**（估算分无真实成绩对照；无对照实验） |

---

## 5. Feature → Score Impact Matrix

| Feature | Student Problem | Data Input | Decision/Action | Evidence | Ability Impact | Score Impact | 状态判定 |
|---|---|---|---|---|---|---|---|
| Practice 练习闭环 | 刷题无反馈 | PracticeRecord+判题五分类 | 掌握度更新+错题入队 | ✅ 事实表+幂等 | ✅ 直接 | ✅（选题质量依赖上层） | **CONFIRMED 核心** |
| Knowledge System 图谱 | 不知道考什么/学什么 | 1296 节点+考频快照+着色 | 薄弱定位+闯关 | ✅ 快照+考频 | ✅ 定位 | 部分（关系稀疏 B6） | **CONFIRMED** |
| Wrong Question Review | 错了就忘 | WrongQuestionReview+SM-2 | 间隔复习队列 | ✅ 复习事实+幂等键 | ✅ 直接 | ✅ 错题=直接失分源 | **CONFIRMED（双算法 B3 待统一）** |
| Recommendation 推荐 | 不知道练什么 | 考频×缺口×9 理由码（V11-M3 全宇宙诚实化） | 任务生成+下发 | ✅ reasonCodes 随任务 | ✅ 方向质量 | ✅ 分值密度投放 | **CONFIRMED** |
| Study Task 今日任务 | 知道了不执行 | todayPlan+预算档 | 任务完成→次日计划 | ⚠️ 完成事实✓、**能力证据无（EB-1）** | ⚠️ | 部分 | **PARTIAL（证据断链 EB-1）** |
| Training Room 训练房 | 大题不会写 | ❌ 无 rubric 数据 | ❌ 无结构化训练 | ❌ | ❌ | ❌ **70/150 分主权缺失** | **MISSING（F4 content-blocked）** |
| F1 真题对标 | 不知道为什么练 | 考频快照+掌握度+对齐理由 | 星级排序+逐题理由 | ✅ evidenceRefs 逐题 | ✅ 方向质量 | ✅ 分值密度 | **CONFIRMED（生产实测）** |
| F2 模考诊断 | 考完不知道为什么错 | 会话+节点标签+目标分+快照 | 诊断书+恢复任务+闭环率 | ✅ 真实会话实测 | ✅ 归因 | ✅ 差距→行动 | **CONFIRMED（本地，待部署）** |
| Learning Evidence（V11-M2） | 任务完成≠能力提升 | 完成前后练习+掌握度Δ | 证据卡 | ✅ 投影 | ✅ 直接度量 | 部分（指标代理） | **CONFIRMED（本地，待部署）** |
| FSRS Predictor（V11-M4.1） | 学了就忘 | 复习历史+稳定性 | 保持率预测+优先级 | ✅ 数学性质测试 | 影子 | ✅（保持率=得分前置） | **SHADOW（未接入决策）** |
| Mastery Calibration（V11-M4.2） | 系统可能高估我 | EMA vs 证据差 | 方向建议（影子） | ✅ 校准条目 | 影子 | ✅（模型可信度） | **SHADOW（生产未部署）** |
| Outcome Tracking（V11-M4.3） | 推荐有效吗 | 干预前后对照 | 判定 improved/no_change | ✅ 前后事实 | 影子 | ✅（效果归因） | **SHADOW（生产未部署）** |
| AI Coach / 星野 | 孤独/不坚持 | 真实学习数据驱动 | 9 态+干预+记忆+LLM 对话 | ✅ 生产实测 | 间接（动机/坚持） | 间接（经行为） | **CONFIRMED（生产实测）** |
| AIInsightCard 静态洞察 | — | ❌ 无数据（纯展示） | — | ❌ | ❌ 零 | ❌ 零 | **DEAD/decorative（建议改造或移除）** |

**五类发现**：

| 类型 | 发现 |
|---|---|
| Dead/Decorative Intelligence | AIInsightCard（零数据零行动的 READY 卡）——装饰性智能实证 |
| Decorative Data | LearningTrend 合成权重柱（非真实量纲，与诚实原则张力最大） |
| Unused Data | ReviewAttempt.nextIntervalDays（F3 影子原料躺着）、UserMasterySnapshot 衰减轨迹（防线 selector 已建未消费）、KnowledgeRelation 33+21 条 |
| Broken Loop | EB-1 任务完成→零能力证据；EB-2 标记已复习→零证据；EB-4 能力→真实分数无验证 |
| Duplicate Capability | mastery EMA vs ReviewSchedule SM-2 双算法；isStaticDemoMode 双实现 |

---

## 6. Top 5 Score Improvement Bottlenecks

### P0-1｜证据断链：任务完成与"标记已复习"不产生任何能力证据
- **Problem**：学生完成系统排的任务、点了"已复习"——系统零记录、零归因、零反馈。
- **Evidence**：completeStudyTask（study.service.ts:3371 起）无掌握度/证据写（grep 实证 0）；applyReview 仅 isReview=true（:2324-2329）。
- **Why blocks**：六指标全部以 Evidence→Ability 为地基；断链不补，推荐无法验证、掌握度无法校准、学生得不到"做完有用"的反馈。
- **Existing Data**：PracticeRecord、UserMasterySnapshot、WrongQuestionReview——原料全在，只差投影与语义统一。
- **Direction**：只读 Learning Evidence Projection（V11-M2 已建）→ 前端消费（证据卡/今日任务徽标）→ 复习语义统一设计（写路径，需批准）。
- **Risk**：复习语义统一触碰 ReviewSchedule 写语义——暂停条件审批。

### P0-2｜"能力提升→分数提升"无验证闭环
- **Problem**：估算分（F2）从未与学生真实成绩对照；score-history 有真实模考分但与干预无关联。
- **Evidence**：估算分生产可用（F2 已验证真实会话）；AssessmentHistory/score-history 表已有。
- **Why blocks**：六指标的最终结算货币是分数；没有对照，一切"提升"只是代理指标。
- **Existing Data**：AssessmentHistory、score-history、F2 估算投影——全部现成。
- **Direction**：真实成绩回流对照投影（纯读）→ 校准曲线 → 估算置信度随对照升级。
- **Risk**：低；需要学生在生产真的做模考（数据自然积累）。

### P1-1｜复习语义统一 + FSRS 影子收口（Q2 知识保持）
- **Problem**：双算法并存（B3），FSRS 预测器已建但未接入影子对照。
- **Evidence**：review-shadow 基线已上线（admin/teacher 端点）；ReviewAttempt.nextIntervalDays 逐次落库持续积累。
- **Why blocks**：保持率无法度量=遗忘防线无法验证。
- **Direction**：FSRS 预测器接入 review-shadow 对照 → 预注册阈值 → 人在环切换。
- **Risk**：影子阶段零风险；切换需批准。

### P1-2｜推荐曝光遥测缺失（EB-3）
- **Problem**：学生"看没看到推荐"系统不知道——干预证据链第二环断裂。
- **Direction**：曝光/点击事件（allowlist 增量，前端 trackEvent）。
- **Risk**：低。

### P2-1｜内容与数据缺口（教研侧）
147 无考频节点考频补录、知识关系稀疏（DS 0 边）、大题 rubric 内容批次——工程侧已全部变成可见队列（`/admin/data-quality`），补录是教研侧动作。

### P2-2｜工程收敛（阻塞迭代速度）
StudyService 5282 行 / App.tsx 1783 行 / StudyModule 双注册 / 孤儿文件 921 行 / isStaticDemoMode 双实现 / 12 个散落 CSS——**建议 V12 大规模迭代前做一次受限收敛**。

---

## 7. V12 Product Constitution Proposal

- **Mission**：把"练习闭环"升级为"**提分证据闭环**"——每个学习决策可解释、每次干预可验证、能力变化可对照到分数口径。
- **Product Principles**：证据先行 / 干预可归因 / 诚实缺席 / 人在环。
- **Score Improvement Model**：`提分机会 = f(考频权重, 缺口严重度, 恢复成本, 证据置信)` → `单位时间收益 = 机会 ÷ 训练成本` → **全部系数先影子后生效**。
- **Evidence Principles**：每层证据有 SoT、有投影、有置信标注；曝光/接受/执行/变化四级遥测补全（EB-3）。
- **Architecture Boundary**：继承 V11 冻结（SoT 唯一写方/投影只读/引擎排序冻结）；V12 新能力一律 Selector/Projection/影子模式。
- **Experimental Boundary**：影子模型显式标注 EXPERIMENTAL/NON-AUTHORITATIVE；正式化需预注册阈值 + 人在环批准。

## 8. V12 Roadmap Proposal

| 里程碑 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| **V12-M1 交付收口** | V11-M2/M3/M4 生产部署 + 生产 E2E（扩 RC-2 清单至新端点） | 无（代码在 origin） | 新端点 401→认证后真实数据；生产 bundle 含全部 V11 标记 |
| **V12-M2a 曝光遥测** | 推荐曝光/点击事件（EB-3 闭合，allowlist 增量） | 无 | 每条推荐可答"学生看没看到" |
| **V12-M2b 任务证据卡前端** | 今日任务/报告消费 task-evidence | 无 | 完成任务行显示掌握度Δ与判定 |
| **V12-M3 复习语义统一（设计先行）** | EB-2/EB-5：ReviewAttempt 回流语义设计文档 → **批准后**实施 | **所有者批准写语义** | 双算法口径统一；影子对照持续 |
| **V12-M4 Score Opportunity 影子** | 恢复成本/时间成本字段建模（纯函数影子） | 无 | 影子端点输出 Top 机会清单（NON-AUTHORITATIVE） |
| **V12-M5 真实成绩校准** | 模考真实分 vs 估算分对照投影 | 无 | 对照曲线 + 校准置信 |
| **F4 大题训练** | rubric 批准门 + 内容批次后启动 | Schema 批准 + 内容 | 采分点训练闭环 |

**依赖关系**：V12-M1 无前置；M2a/M2b/M4 并行可行；M3 需批准；F4 需内容+批准。**最终路线以真实审计结果为准——上表是候选，不是承诺。**

---

## 9. STOP — 等待 V12 正式路线确认

审计完成。本轮零代码修改、零生产行为变更（仅新增本报告 + 账本）。

**等待所有者确认**：
1. V12 正式路线（§8 提案或修订版）
2. P0-2/P0-3 触发暂停条件的方向选择（复习语义统一、推荐候选宇宙语义已按已批准范围落地）
3. V11-M2/M3/M4 生产部署时机（origin 已就绪）
4. V12 正式启动后的第一个实施里程碑

确认前不进入任何实施。
