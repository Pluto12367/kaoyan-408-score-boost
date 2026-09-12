# S2.10 — E2 Transfer Experiment Runbook

> 目标：为 30 个高频节点 × ≥2 道审定同构新题建立首批真实迁移测量样本，产出
> `practiceAccuracy / transferRate / transferGap`（按 node×kind×bucket 分层，n≥5 才出结论）。
> 本 runbook 是内容与运营执行手册；分析用 `scripts/analyze-transfer-probe-e2.mjs`（只读）。

## 1. 前置条件

1. **内容供给（C4）**：30 个高频节点（建议 `KnowledgeFrequencySnapshot.recent3Frequency ≥ 2`，覆盖 DS/CO/OS/CN）；每节点 ≥2 道审定同构新题（practice-bucket + exam-bucket），满足 formal design §4 的 I1-I5（同节点/同题型/同难度桶/同知识操作/异表面）。审定清单（node → probe question → operation）随内容仓交付。
2. **内容标记**：审定题 `Question.source = 'transfer_probe_pool'`（导入管线透传）+ PRIMARY 节点标签 + 合法 KnowledgePoint 关联（练习 FK 必需，S2.9 已验证）。
3. **功能开关**：生产环境 `TRANSFER_PROBE_ENABLED=true`（默认 off；rollback = 取消设置）。
4. **API 已部署**（含 S2 全部端点）且 `GET /coach/transfer-summary` 对 seed 学生返回 `storeAvailable: true`。

## 2. 执行流程（4-6 周，自然发生，不导演干预）

| 周 | 动作 |
|---|---|
| W0 | 学生知情告知：「系统会不定期给一道从未见过的新题复测，约 5 分钟，结果计入学习记录」 |
| W1-W4 | 学生正常使用系统：完成学习任务（干预）→ 48h 后探针卡出现 → 提交。系统自动完成排程/投递/证据/掌握度回流 |
| 持续 | 每周跑一次 `analyze-transfer-probe-e2.mjs` 观察样本积累；`/admin/data-quality` S2 区块监控 no_probe_available 积压 |
| W5 | 样本量检查：`analyze` 输出中 verified stratum `n≥5` 的节点数 ≥ 20/30 → 进入分析；不足 → 延长 1-2 周 |

## 3. 分析（只读脚本）

```bash
node scripts/analyze-transfer-probe-e2.mjs --min-node=20
```

- 输入：EVIDENCE_RECORDED（detail.kind='transfer_probe'）+ PracticeRecord（练习口径，三重排除）。
- 输出：per (node, kind, bucket, isomorphism) 行：n / transferRate / practiceAccuracy / transferGap / sampleConfidence / gate。
- **主结论只引用 `isomorphism=verified` stratum**；unverified 单列并标注，不得混入。
- E2 完成判定（预注册）：≥20 节点出数 且 verified stratum 的 TransferGap 分布可解释（方向不预设——负值=迁移衰减是发现，不是失败）。

## 4. 退出与失败语义

- 样本不足 → `insufficient_data`（继续积累，不出任何数字）。
- `no_probe_available` 积压高的节点 → 进内容任务队列（不放宽 eligibility、不用旧题顶替）。
- 实验数据与日常训练数据同管线同库（无旁路写入）；探针观测经 detail.kind 与练习口径严格分账。

## 5. 边界（重申）

E2 产出的是**迁移证据**（learning-evidence 层），不是 Verified Score Gain（分数层，需 S1 锚定成绩），不得在任何报告/文案中把 TransferGap 表述为提分。
