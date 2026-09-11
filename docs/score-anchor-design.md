# Score Anchor Design（S1 架构决策）

> 日期：2026-09-12 ｜ 状态：已实现（S1）
> 上游：`docs/score-improvement-gap-report.md` → `docs/score-improvement-reconstruction-design.md` → `docs/s1-score-anchor-implementation-plan.md`
> 本文档记录 S1 的架构决策与不变量。数据契约细节见 `docs/score-ledger.md`，校准规则见 `docs/score-calibration.md`。

## 1. S1 回答的问题

S1 之前的系统无法回答："学生的预测分和真实成绩到底对得上吗？" 更根本地——它没有一个可信的"成绩"概念：in-app 模考把正确率百分比当作 `score/100` 存储、外部导入成绩与系统判分混在同一张表且无来源字段、预测分在前端即时算完即丢、校准直接把 150 制预测与 100 制正确率相减（实测 predicted=26 vs actual=96/100，error=70——一个无意义的数字）。

S1 建立 **Score Anchor Foundation**：三类分数证据（Prediction / Assessment / Outcome）结构隔离、原始量纲永不丢失、每条证据回答"从哪来"（provenance）、证据行永不改写（append-only + correction 链）。

## 2. 核心架构决策

### D1 三类证据用三张独立表，不用 kind 字段

`ScorePrediction` / `ScoreAssessment` / `ScoreOutcome` 是三张表、三个写路径、三套守卫：

1. **写路径授权不同且必须不同**——prediction 只由系统/本人记录，assessment 可由学生导入或教师录入，outcome 需要验证态；表隔离使一个 writer 的 bug 不可能伪造另一类证据。
2. **字段级不变量不同**——单表意味着全部字段可空（仓库内反例教材：ReviewAttempt 四列可空迁移的"历史行 genuinely unknown"负担）。
3. **跨类配对成为类型层面的约束**——校准配对只在 prediction × evidence 之间，"混算"不再是运行时过滤条件的疏忽。
4. **修正语义**——correction 只在同类内追加；"把预测升格为成绩"被 schema 构造性禁止。
5. **保留策略不同**——prediction 便宜可弃，outcome 是永久事实。

### D2 量纲：raw 永不丢失，normalized 统一 150

每条 evidence 同时保存 `rawScore / rawTotalScale` 与 `normalizedScore / normalizedTotalScale(=150)`。`normalizeScore` 纯函数拒绝缺 totalScale（**废除 `|| DEFAULT_TOTAL_SCORE` 回退**）、非正 totalScale、越界与非有限分值——缺失是显式拒绝，不是猜 150。`semantic` 字段区分 `exam_total`（考试分）与 `accuracy_rate`（正确率口径）：in-app 整卷的"分数"被诚实命名为正确率口径，**结构上不得与总分预测配对**。

### D3 Provenance 是显式分类学，UNKNOWN 有三条例外语义

`MOCK | DIAGNOSTIC | TEACHER_GRADED | RUBRIC_GRADED | REAL_EXAM | IMPORTED | UNKNOWN`。来源跟随**角色**而非请求：学生录入强制 IMPORTED（自称 TEACHER_GRADED 是 403，不是静默修正）；outcome 未验证（unverified）不进 primary 校准层。UNKNOWN（含遗留迁移行）只能进 proxy 层、UI 显示"来源未记录"、计入 data-quality 清理队列——**绝不含糊**。

### D4 Append-only + Correction 链

证据行永不 UPDATE。修正追加 `ScoreCorrection`（字段白名单 + 原因 + 操作人），读模型用 `resolveCorrectedEvidence` 折叠链得到有效值；raw 值被修正时自动重算 normalized。审计可回答：谁、何时、为什么、原值（按 targetId 取原始行）、新值（correctedFields）。唯一例外：outcome 的 `verificationStatus` 单向 unverified→verified，只经教师/管理员端点。

### D5 预测落库（此前完全无持久化）

报告页计算的预测分（estimatePredictedScore，公式零改动）现在按 `账户+日` 幂等持久化（predictionKey），携带 modelVersion 与 inputsSnapshot——"当时预测的是什么"从此可考古。失败 best-effort，绝不影响报告页。

### D6 examDate 是事实，remainingDays 是派生量

`User.examDate` 新增（手工录入的考试日事实）；`remainingDays` 降级为遗留派生缓存（本阶段不改其消费方）。**禁止从 remainingDays 回填 examDate**。

## 3. 不变量清单（测试钉死）

| # | 不变量 | 测试 |
|---|---|---|
| I1 | 缺 totalScale 拒绝，无默认回退 | score-anchor.test.js |
| I2 | accuracy_rate ≠ exam_total，混算配对被构造性排除 | score-anchor/calibration 两处 |
| I3 | 学生自称 TEACHER_GRADED → 403 且零写入 | score-anchor-service.test.js |
| I4 | correction 追加，证据行零 UPDATE（源码断言 + 桩断言） | score-anchor-service.test.js |
| I5 | outcome occurredAt 必须过去；学生不能验证 | score-anchor-service.test.js |
| I6 | 校准行必须 scalePair='150/150'（集成断言逐行检查） | integration-score-anchor.mjs |
| I7 | 门禁边界严格：n=5 通过、median=15 不通过、混合来源永不合并 | score-anchor.test.js |
| I8 | 无库时诚实缺席（null / store_unavailable），零伪造 | score-anchor-service.test.js |

## 4. 兼容与迁移

- **零回填**：AssessmentHistoryItem 保留为遗留读路径；遗留行在**读时**按记录在案的事实（id 前缀 + totalScore）解释语义——`assessment-history-*` → accuracy_rate/MOCK；其余 totalScore=150 → exam_total/IMPORTED；其余 → accuracy_rate/MOCK。该规则是读时解释，不是数据改写。
- **paper 双写**：整卷提交 best-effort 同步一条 accuracy_rate ledger 行（MOCK 来源），失败不影响考试路径；AssessmentHistoryItem 仍是该路径的权威存储。
- **迁移**：`20260912120000_score_anchor_foundation`（四新表 + User.examDate），additive、可 DROP 回滚、零既有列改动；`prisma migrate diff` 验证零漂移。

## 5. 已知限制（诚实边界）

1. **ScoreLossItem 延后**：S1 计划文档中的逐题失分行未在本阶段实现（校准只需要总分口径）——S3 机会引擎前补。
2. **真实校准数字 = 0**：E1 未执行（需真实学生与教研判分）。生产上 `gateStatus` 将诚实显示 not_started / 证据不足。**S1 完成不等于"已经校准"，更不等于"提分已证明"。**
3. **预测持久化首值优先**：同账户同日多次计算取首次值（幂等键设计），预测日内漂移不记录。
4. **教师验证授权**：teacher 验证走 `teacherStudentAuthorization` 授权脊柱；跨学生 correction 仅 admin。
5. **paper 双写的 examDate 为 null**（正确率口径行无考试日事实）——它们本来就永远不参与校准配对。

## 6. 验证记录

- `npm test` → 2374/2372/0/2 exit 0（基线 2324/2322/0 +50，零回归）
- `build:api` / `build:web` → exit 0
- `test:integration:score-anchor`（新）→ 10 步 ALL PASS（真实 HTTP + PostgreSQL）
- `test:integration:score-loop` → 16 环 ALL PASS（校准行由混算 26/96/70 变为合法 150/150 的 28/96/68）
- `test:integration:effectiveness` / `event-key` → exit 0
