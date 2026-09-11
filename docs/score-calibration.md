# Score Calibration（S1 校准契约）

> 预测分与真实成绩的对照规则。修复的缺陷：V12-M5 曾把 150 分制预测与 100 分制正确率直接相减（实测 predicted=26 vs actual=96/100，error=70——量纲混算的数字毫无意义）。

## 1. 三概念严格分离

```text
PREDICTION  系统预测（区间 + 免责声明，PREDICTION_IS_NOT_ACTUAL）
EVIDENCE    预测所依赖的事实（样本量 + basis）
ACTUAL      记录的成绩（ScoreAssessment / ScoreOutcome）
```

任何输出字段不合并三者；"没有误差" ≠ "没有数据"（无配对时 MAE/bias 为 null 而非 0）。

## 2. 配对兼容性（isCalibrationCompatible——全部满足才成对）

| 条件 | 拒绝码 |
|---|---|
| evidence.normalizedTotalScale === 150 | scale_mismatch |
| semantic 同为 exam_total（accuracy_rate 永不配总分预测） | semantic_mismatch |
| provenance ≠ UNKNOWN（且可归层） | provenance_unknown |
| evidence.occurredAt 已知 | evidence_time_unknown |
| evidence.occurredAt ≥ prediction.generatedAt | prediction_after_outcome |

不兼容的配对进入 `exclusions`（带原因），**永不平均、永不静默丢弃**。

## 3. 双路径

1. **Ledger 路径（主）**：ScorePrediction（持久化、modelVersion、generatedAt）× ScoreAssessment/ScoreOutcome（normalized 150、semantic、source）。每个 evidence 配对**最近一条先于它生成**的预测。
2. **Legacy 回退**：AssessmentHistoryItem 重建预测（estimatePredictedScore，评估前事实），行语义按 id 前缀 + totalScore 解释（见 score-ledger.md §6）；previousScore 链改用 **normalized 值**。

未验证 outcome（unverified）→ 一律排除（`outcome_unverified`），计入 `pendingVerification`。

## 4. 指标与分层

- `MAE`、`bias`（actual−predicted，正=实际高于预测）、`medianAbsoluteError`、`withinRangeRate`。
- **分层**：按 provenance 组独立计算（strata），**永不混合来源产生单一 MAE**。
- 样本下限 `CALIBRATION_MIN_SAMPLE=5`：低于下限 MAE/bias=null + `confidence='insufficient_data'`（MAE≥|bias| 数学性质测试保留）。

## 5. E1 门禁（预注册，evaluateCalibrationGate）

```text
per provenance group: n >= 5 且 median absolute error < 15 分（150 制）
边界：n=5 通过；median=15 不通过；混合来源不得合并计算
状态机：not_started → insufficient_evidence → preliminary（n 达标但 median 未达标）→ gate_passed
```

- 门禁通过前，预测分对学生永远显示"仅为估算"；校准原始 MAE 只对 teacher/admin 可见（`GET /coach/score-calibration`）。
- 学生端只见**状态**与各组 n（`GET /coach/score-evidence` 的 calibrationEvidence）。
- E1 实验设计见 `docs/s1-score-anchor-implementation-plan.md` §10；**S1 交付时生产校准数字为 0，这不丢人——诚实缺席是本模块的产品价值**。

## 6. 实现位置

- 纯函数：`packages/shared/src/score-anchor/score-anchor.ts`（兼容性/误差/门禁/状态机/修正折叠）+ `packages/shared/src/score-center/score-calibration.ts`（严格化后的 buildScoreCalibration，输出向后兼容 + 新增 strata/gateStatus）。
- 装配：`apps/api/src/study/score-calibration.service.ts`（ledger 主路径 + legacy 回退）、`apps/api/src/score-anchor/score-anchor.service.ts`（观测配对）。
- 测试：`test/score-anchor.test.js`（26）、`test/score-anchor-service.test.js`（21）、`test/score-calibration*.test.js`（23，含混合量纲排除、未验证排除、150/150 归一配对三个 S1 新测试）。
