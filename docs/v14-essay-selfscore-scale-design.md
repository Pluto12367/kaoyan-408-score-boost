# V14 综合题自评刻度对齐真实满分 设计任务书（小 Design Gate）

> **Status**: DESIGN GATE — 待 Owner 批准，未实施任何代码变更。
> **任务来源**: 2026-09-26 定价回填（`150368b3`）后确认的产品缺口：91 道大题已逐题定价，
> 但交卷自评仍是 0-10 固定刻度——15 分的算法题与 6 分的题同权，报告与 150 分诊断的单题权重失真。
> **任务类别**: `CODE-BEHAVIOR`（零迁移；触及作答记录分值口径 → RULE-08/14 语义边界，故走 Design Gate）。

## 1. 现状（一手审计）

- 交卷自评输入硬编码 0-10：`ExamSession.tsx` 自评数字输入 `min=0 max=10 / 10`；
  主观题作答 `updateAnswer(..., selfScore, 10)` 把 maxScore 固定传 10。
- 后端按题记录 `selfScore/maxScore`（`study.service.ts` createPracticeRecord，无硬编码）；
  综合题判对口径 = `selfScore/maxScore ≥ 0.6`。
- 报告聚合 `subjectiveEarnedScore = Σ selfScore`、`subjectiveMaxScore = Σ maxScore`
  （`study.service.ts:5045` 附近）——本身通用，**问题全在前端传了常数 10**。
- 150 分诊断：客观 = 正确率 × 80（估算口径已标注）；主观 = Σ selfScore（真实自评分）
  （`exam-diagnosis.ts:138-149`）。
- 数据基础：dev 库 846 题全部已定价（maxScore 非空）；真题套卷快照亦携带 maxScore。

## 2. 设计要点

| 项 | 设计 |
|---|---|
| 自评刻度 | 输入范围 0..question.maxScore，展示「/ maxScore」；`updateAnswer` 传真实 maxScore。**API 零改动**（字段本就逐题透传） |
| 未定价回退（D-S-1） | maxScore 缺失（演示目录/未定价题）→ 回退 10 分制并在自评行显式标注「未定价，按 10 分制」——绝不把缺失伪装成已定价（RULE-06） |
| 判对阈值 | `selfScore/maxScore ≥ 0.6` 比例口径不变——刻度归一后语义自洽 |
| 历史数据（D-S-2） | 已录记录（旧 10 分制 maxScore=10）**不改写**：真题 846 题此前尚无学生作答记录（dev 环境仅目检数据），生产未部署 ⇒ 无迁移负担；报告不做跨刻度混合场景的特殊处理 |
| rubric 采分点自评（D-S-3） | 交卷自评时按 rubric criteria 逐点引导（而非整段解析）——**建议后置**（rubric UI 是独立切片，避免本任务膨胀） |
| 150 分诊断 | 无需改动：Σ 语义随输入自动正确；basis 文案已如实 |
| 兼容性 | 仅前端两处 + 可能的类型注释；零 API/模型/迁移变更 |

## 3. 测试策略

- 源码契约：自评输入 max 绑定 `question.maxScore`、updateAnswer 不再传常数 10、未定价标注存在。
- 单测/契约：maxScore 缺失回退路径显式标注断言。
- 真实浏览器目检：真题套卷交卷自评按题满分制（如 2009 Q41=10、Q42=15 各自可输入 0..满分）。

## 4. Owner Decision

| # | 决策 | 建议 |
|---|---|---|
| D-S-1 | maxScore 缺失时：回退 10 分制+标注 vs 拒绝自评 | 回退+标注（演示模式可用性） |
| D-S-2 | 历史旧刻度记录不迁移 | 不迁移（无真实负担） |
| D-S-3 | rubric 逐采分点自评是否同批 | 后置独立切片 |

## 5. 估时

前端两处 + 测试 ≈ 0.5 天。
