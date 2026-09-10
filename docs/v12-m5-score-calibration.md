# V12-M5 — Real Score Calibration

> 里程碑：V12-M5（Real Score Calibration）
> 目标：闭合审计断点 **EB-4**（"能力提升→分数提升"无验证通路：估算分从未与真实成绩对照）
> 状态：**实现 + 测试 + 门禁通过**
> 纪律：**只读 / 零 Schema / 预测·证据·实测三者严格分离**

---

## 1. 问题与关键发现

审计 EB-4：`score-history` 有真实模考分，但与干预无对照；F2 的估算分（`score150Estimate`）从未与任何记录成绩比较。

勘察中的关键发现（决定了本轮可行性）：

| 载体 | 内容 | 结论 |
|---|---|---|
| `AssessmentHistoryItem` | `score` / `totalScore` / `accuracyRate` / `submittedAt` / `sessionId` | **真实记录分数已存在** → 校准可零迁移完成 |
| `ExamScoreHistoryExamFact` | 仅 `totalQuestions` / `correctCount` / `totalActiveMs` | **不是分数**，是作答计数；不能当作"实际成绩" |
| `estimatePredictedScore`（shared） | 返回 `minScore/maxScore/bestEstimate` + `disclaimer:'仅为估算'` + `basis` | **预测**概念已有生产实现，直接复用 |

因此本轮**不新增"真实成绩"表**：`AssessmentHistoryItem` 就是实测成绩的权威来源；预测则由生产估算器从**严格早于该次测评**的事实重建。

---

## 2. 三概念严格分离（任务 §11.1 的硬约束）

任务明确禁止三组等式：`Estimated Score = Real Score`、`Mastery Increase = Score Increase`、`Task Completion = Ability Improvement`。

响应结构据此设计为**永不合并**：

| 概念 | 输出字段 | 说明 |
|---|---|---|
| **prediction** | `rows[].predicted` / `predictedMin` / `predictedMax` + 顶层 `disclaimer`（`PREDICTION_IS_NOT_ACTUAL` 常量，逐字输出） | 带区间的估算 |
| **evidence** | `rows[].evidence.sampleSize` / `evidence.basis` | 预测所依据的事实与样本量 |
| **actual** | `rows[].actual` | 记录的真实分数 |
| 派生 | `rows[].error`（= actual − predicted，**符号有意义**）/ `direction` / `withinRange` | 明确是**差**，不是任何一方的替代 |

`improvement` 单独成块，`predictedDelta` 与 `actualDelta` **两条独立序列**，`gap` 明示二者之差；文案写明"掌握度上升不等同于分数上升，两者分别记录"。

---

## 3. 四条诚实规则（测试钉死）

| 规则 | 行为 |
|---|---|
| **样本不足即不结论** | `CALIBRATION_MIN_SAMPLE = 5`；低于下限时 `meanAbsoluteError=null`、`bias=null`、`confidence='insufficient_data'`，文案明示"样本不足" |
| **没有数据 ≠ 没有误差** | 无成对记录时 `pairedCount=0` 且 MAE `null`，文案"没有误差 ≠ 没有数据" |
| **无法重建预测 → 排除，不按零误差计入** | 缺预测或缺评估前证据 → 进 `exclusions[]`（含中文原因） |
| **首次测评的基准必须声明为估算** | 无上一次实测分时，基准分由评估前正确率折算，并在 `evidence.basis` 明写"首次测评，基准分由评估前正确率折算（…，估算）" |

**时序隔离测试**：构造"测评前 2 次全对 + 测评后 2 次全错"的数据，断言 `evidence.basis` 为"评估前 **2** 次已判分作答（正确率 **100%**）"——若测评后的数据泄漏进预测，会读成"4 次 / 50%"。

**数学性质测试**：断言 `MAE ≥ |bias|`（单边误差时取等号，双向时严格大于），而非假设二者相等。

---

## 4. 实现清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/shared/src/score-center/score-calibration.ts` | 新增（纯） | `buildScoreCalibration`、`CALIBRATION_MIN_SAMPLE`、`PREDICTION_IS_NOT_ACTUAL`、排除/MAE/偏差/区间命中率/进步对比 |
| `apps/api/src/study/score-calibration.service.ts` | 新增（只读） | 对每次测评：取**严格早于**它的事实 → 复用 `estimatePredictedScore` 重建预测 → 与实测配对 |
| `apps/api/src/study/daily-brief.controller.ts` | 修改 | `GET /coach/score-calibration`（teacher/admin，走 `resolveUserId`） |
| `apps/api/src/study/study.module.ts` | 修改 | 注册 provider |
| `test/score-calibration.test.js` | 新增（13 项） | 纯模块契约 |
| `test/score-calibration-service.test.js` | 新增（7 项） | 配对 / 时序隔离 / 排除 / 复用生产估算器 |

---

## 5. 端点

```
GET /coach/score-calibration?userId=<可选>
```
- 角色：**teacher / admin**（模型质量仪器）
- 返回：`{ userId, generatedAt, rows[], exclusions[], summary{pairedCount, excludedCount, meanAbsoluteError|null, bias|null, withinRangeRate|null, confidence, basis}, improvement{predictedDelta|null, actualDelta|null, gap|null, basis}, disclaimer, authoritative:false, basis }`

## 6. 门禁证据

| 项 | 结果 |
|---|---|
| shared 构建 / API 类型检查 | exit 0 / exit 0 |
| 纯模块 | **13/13 pass** |
| 服务 | **7/7 pass** |
| **`npm test`** | **2185 tests / 2183 pass / 0 fail / 2 skip，exit 0** |
| **`npm run build:api` / `build:web`** | exit 0 / exit 0 |

## 7. 明确未做 / 局限（诚实边界）

| 项 | 原因 |
|---|---|
| 与**真实考研成绩**的对照 | 系统内不存在"真实考研分数"表或录入通道。当前"实际成绩"是**模考/测评的记录分**——这是真实测量，但**不是**考研最终分数。要闭合到真实考研分需新增录入通道（Schema 变更或 RuntimeState），属下一阶段且需批准 |
| `remainingDays` 在重建中使用固定回退值 | 该次测评当时的"剩余天数"无历史留痕（`User.examDate` 可能已变更）；已在实现中标注，未伪装为精确值 |
| 无成对样本的实测运行 | 需连数据库；本会话 Docker 引擎未就绪 |
| 用校准结果反调模型 | **刻意不做**——校准是指标，不是自动调参；改权重需批准 |
