# S2 Transfer Probe — Implementation Report

> 日期：2026-09-12 ｜ 状态：**S2 TRANSFER PROBE = COMPLETE**
> 依据：`docs/s2-transfer-probe-formal-design.md`（APPROVED，C1-C4 已批准决策）
> 一句话边界：**S2 证明的是迁移测量（transfer measurement）。S2 不证明成绩提升（score improvement），不实现 ROI ranking。**

## 1. Architecture

```
Intervention（StudyTask completed + 节点观测证据）
  → 懒调度（GET /coach/transfer-probes 补偿扫描,creationKey 幂等）
  → TransferProbe = RecommendationAction('TRANSFER_PROBE') + 1:1 StudyTask（source='transfer-probe' 独立计划）
  → 投递（36h 下限 + 到期日 + 7 天宽限；三源未曝光选题）
  → ProbeAttempt（PracticeRecord,经 LearningSession(type='transfer_probe')）
  → TransferEvidence（EVIDENCE_RECORDED, detail.kind='transfer_probe',与作答同事务原子落库）
  → TransferRate / TransferGap（只读投影,按 node×kind×bucket×isomorphism 分层,n≥5 门禁）
  → Canonical Mastery（探针作答经 applyAttempts 唯一写方回流,C3——无任何探针专属写通道）
```

## 2. SoT Mapping

| 概念 | 载体 | 新表 |
|---|---|---|
| TransferProbe / ProbeTask | RecommendationAction('TRANSFER_PROBE') + StudyTask(source='transfer-probe' 计划) | 无 |
| ProbeAttempt | PracticeRecord（经 type='transfer_probe' 会话） | 无 |
| TransferEvidence | EVIDENCE_RECORDED（occurrence 键,detail.kind='transfer_probe'） | 无 |
| TransferResult/Rate/Gap | 只读投影（shared 纯函数 buildTransferProjection） | 无（不落表） |

新增持久化元数据仅三处受控词表扩展：`LearningSession.type` + 'transfer_probe'、Action actionType 新值、`Question.source='transfer_probe_pool'`（内容任务）。**零新表、零列变更、零迁移。**

## 3. Eligibility

`evaluateProbeEligibility`（shared 纯函数）：inPool / hasPriorAttempt（PracticeRecord ∪ ReviewAttempt）/ hasPriorExposure（LearningSession.questionIds 含未提交）/ sameFamilySeen（族级联烧）/ previouslyUsedAsProbe / bucketMatch / typeMatch——任一不满足即硬拒绝，七类 RED 反例测试钉死。投递时刻执行选题（排程到投递间污染归零），verified 池优先、unverified fallback 诚实标注且**永不与 verified 合并**。

## 4. Probe Pool

`Question.source='transfer_probe_pool'` 内容约定 + 练习选题单点排除（nodeQuestionIdsByNode 构建过滤）——普通练习/推荐/阶段测评选题面全部隔离；教师管理面可见。池题带 KnowledgePoint 关联（练习 FK 必需，与真实导入一致）。

## 5. Scheduler

懒投递（无 cron）：补偿（30 天内完成且无探针的干预任务）→ 过期（到期日+7 天宽限 → EXPIRED，**不计失败**）→ 投递（到期日 + ≥36h 实测下限；日投递上限 3；同节点 pending 跳过；14 天间距跳过；`no_probe_available` 诚实跳过并计数内容积压）。与理想 48h±6h 的偏差（36h–96h）为 C2 日粒度固有限制，如实声明。

## 6. StudyTask Integration

探针计划 `source='transfer-probe'`：`archiveScoreCenterPlans` 仅归档 `source='score-center'`（repository.ts:487）、`loadTodayScoreCenterPlan` 仅读 `source='score-center'`（:537）——探针任务跨日存活且不混入每日 mission（集成断言覆盖）。

## 7. Canonical Mastery Boundary

探针作答走既有会话提交路径：`commitSubmission` 事务内 `applyAttempts`（C3）。`TransferProbeService` 源码级断言不含任何 mastery 写原语；探针证据写入同样在该事务内（`recordObservedPerformance` 新增可选 tx 参数，additive；M3 复习证据同事务先例）。mastery effect 与 transfer measurement 是两个独立输出。

## 8. Transfer Projection

`buildTransferProjection`（shared 纯函数）：按 (node, kind, bucket, isomorphism) 分层，**永不合并**；`transferRate` 仅在 `probeAttempts ≥ 5` 时给出（`insufficient_data` 否则）；`transferGap = transferRate − practiceAccuracy`（任务书 §14 示例符号：90%→65% ⇒ −25pt，负=迁移衰减）；`sampleConfidence` 低/中/高 = n≥5/20/50，命名明确为样本量置信。PracticeAccuracy 三重排除（探针会话/variantQuestionId/self_assessed），review 由独立表结构天然排除。两个只读端点零写入（§22 Zero-Writing，测试断言）。

## 9. Pollution Controls

重做记忆/提前泄漏/同题复现/难度偏差/内容泄漏/训练污染：选题器硬查询 + 池单点隔离 + 学生卡无答案无解析 + data-quality 区块（probe had prior attempt/exposure、same-family violation、difficulty mismatch、probe reused、missing attribution、evidence-without-attempt、practice 口径污染——全部可检测，Blocking 级作废测量且数据保留可审计）。

## 10. Idempotency

creationKey（排程）/ LearningSession.actionId @unique（投递）/ AnswerReceipt（提交）/ learningEvidenceKey occurrence（证据）——四层防线，E2E 断言：双扫描单 Action、双提交单记录单证据单 mastery。

## 11. Student Isolation

E2E：学生 B 观测为空、探针会话按 userId 归属（越权 404/403 走既有纪律）、B 的存在不影响 A 的 TransferRate。

## 12. PostgreSQL E2E

`npm run test:integration:transfer-probe` → **14 步 ALL PASS**（真实 HTTP + PostgreSQL）：valid probe / duplicate scheduling / isolation / duplicate submission / mastery propagation / projection gate / already-seen+spacing / exposure rejection / same-family rejection / difficulty rejection / no_probe_available / probe_expired / authoritative 检查（assessmentHistory=0、scoreOutcome=0、REVIEW_MASTERY_APPLIED=0——探针写入全部探针本地）。

## 13. E2 Experiment

`docs/s2-e2-experiment-runbook.md` + `npm run analyze:transfer-probe-e2`（只读分析脚本）。30 高频节点 × ≥2 审定同构新题，节点聚合 n≥5 门禁，主结论只引用 verified stratum。生产执行需：内容任务交付池题 + `TRANSFER_PROBE_ENABLED=true`。

## 14. Data-Quality Results

集成内建断言全过：无 prior-attempt 探针、无重复证据、无练习口径污染、无权威表面伪造；`poolRemainingByBucket` 内容积压信号上线。

## 15. Known Limitations

1. 48h±6h 在 C2 日粒度下实际为 36h–96h 窗口（已批准 StudyTask 承载的固有限制，formal design §8 声明）。
2. 探针题池为空（内容任务未执行）——生产投递将诚实 `no_probe_available`；E2 需内容先行。
3. unverified fallback 可用（诚实标注），其 TransferRate 仅诊断用途。
4. 教师端聚合仅 API（`GET /coach/transfer-summary`），专用 UI 表格后置；学生探针卡当前挂报告页总览，今日区域嵌入为后续增量。
5. E2 未执行（需真实学生自然使用 4-6 周）——**生产探针样本数 = 0，S2 完成不等于迁移结论已得出**。

## 16. Exact Commits

- `docs(s2): transfer probe interface audit and formal design`（S2 设计基线）
- `b76bc4e feat(s2): transfer probe identity, eligibility, scheduler and measurement projection`
- `feat(s2): minimal transfer probe student surface ...`（S2.8）
- `test(s2): transfer probe PostgreSQL end-to-end over real HTTP`（S2.9）
- `feat(s2): E2 experiment runbook, analyzer and sprint ledger`（S2.10 + 报告 + 账本）

## 17. Regression Results

`npm test` **2406/2403/1→2404**（最终 2406/2404/0/2，基线 2374/2372/0，+32 新测试）；`build:shared/api/web` exit 0；`test:integration:transfer-probe`（新）ALL PASS；`test:integration:score-anchor / score-loop / effectiveness / event-key` 全 PASS。NEW REGRESSION = 0。

## 18. Interview-facing Technology Stack

NestJS 10 + Prisma 5 + PostgreSQL 16；React 18 + Vite；shared 纯函数域层（node:test TDD）；懒调度（无 cron）幂等编排；append-only 事件台账（canonical writer + occurrence 键）；投影式读模型；沙箱桩服务测试 + 真实 HTTP/PostgreSQL E2E。

## 19. Interview-facing Technical Highlights

1. **零新 SoT 的能力扩展**：四个新概念全部落在既有实体/事件上——用受控词表扩展（session type/actionType/source）+ 只读投影实现新业务，杜绝第二事实源。
2. **三源联查的 never-seen 证明**：作答（PracticeRecord∪ReviewAttempt）+ 曝光（LearningSession.questionIds）硬查询替代"大概率没见过"，投递时刻最后校验。
3. **调度即幂等状态机**：懒投递 + creationKey + actionId@unique + AnswerReceipt 四层防线；probe_expired/no_probe_available 是诚实的终态而非失败。
4. **测量与训练的数据分账**：探针作答经 canonical mastery path（C3）回流能力估计，同时以 detail.kind 在证据层与练习口径三重排除分账——一次作答、两个互不污染的口径。
5. **预注册门禁文化**：n≥5 样本下限、verified/unverified 分层不合并、sampleConfidence 显式命名为样本量置信——把"诚实缺席"做成产品语义。
