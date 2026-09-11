# Score Ledger（S1 数据契约）

> S1 Score Anchor 的存储契约。架构决策见 `docs/score-anchor-design.md`，校准规则见 `docs/score-calibration.md`。
> 迁移：`prisma/migrations/20260912120000_score_anchor_foundation`（additive，四新表 + `User.examDate` 一列；回滚 = DROP，零既有表接触）。

## 1. 三类证据，三张表

| 表 | 语义 | 写方 | 关键字段 |
|---|---|---|---|
| `ScorePrediction` | 系统预测（估算，可弃可重算） | 服务内部 / 本人 API | `predictionKey`（幂等）、`modelVersion`、`predictedScore(+Min/Max)`、`inputsSnapshot`、`generatedFor` |
| `ScoreAssessment` | 一次被测量的表现 | 学生（IMPORTED）/ 教师（TEACHER_GRADED）/ 系统 paper 双写（MOCK） | `originType+originId`（幂等）、`rawScore/rawTotalScale`、`semantic`、`gradingMethod`、`examDate?`、`source` |
| `ScoreOutcome` | 已发生的最终成绩（最高 provenance） | 学生提交（unverified）→ 教师/管理员验证（verified） | `examType`、`dedupKey`（如 `real_exam:2026`）、`verificationStatus`（单向）、`occurredAt`（必须过去）、`verifiedBy/At` |
| `ScoreCorrection` | 修正链（追加式） | 本人 / admin | `targetKind+targetId`、`correctedFields`（白名单）、`reason`、`correctedBy/At` |

公共字段：`rawScore/rawTotalScale`（原始量纲，永不丢失）+ `normalizedScore/normalizedTotalScale(=150)` + `semantic`（`exam_total` | `accuracy_rate`）+ `source`（provenance 枚举）。

## 2. Provenance 枚举

```text
MOCK          系统客观判分（in-app 整卷）        校准层 proxy
DIAGNOSTIC    入学诊断测                        proxy
TEACHER_GRADED 教师录入/判定                    primary
RUBRIC_GRADED rubric 采分点评分                  primary
REAL_EXAM     真实考研成绩                       primary
IMPORTED      外部成绩（学生录入/机构）           proxy
UNKNOWN       显式未知（遗留迁移等）              仅 proxy（永不 primary）
MODEL_OUTPUT  预测行专用（prediction.source 固定值）
```

规则：来源跟随**角色**。学生 → 强制 IMPORTED；教师/管理员 → TEACHER_GRADED（默认）。学生请求 `source: TEACHER_GRADED` → 403。

## 3. 量纲规则（normalizeScore，shared 纯函数）

```text
normalizedScore = round1(rawScore / rawTotalScale × 150)
拒绝：missing_total_score | invalid_total_score(≤0) | missing_score_value |
      invalid_score_value(NaN/∞) | invalid_score_range(越界)
```

- 缺 totalScale **拒绝**，无任何默认回退（废除 `|| 150` 惯例）。
- `rawScore=null` 合法（只有元数据的证据行），但不能产生 normalized 值、不能参与配对。
- 100 分制正确率行 → `semantic='accuracy_rate'`（paper 管线的诚实命名），永远不与总分预测配对。

## 4. Correction 语义

- 证据行**永不 UPDATE**；修正追加 ScoreCorrection。
- 可修正字段白名单：`rawScore / rawTotalScale / normalizedScore / semantic / gradingMethod / examDate / occurredAt / title`。`source` 与 `verificationStatus` 不可修正（来源防洗白；验证走单向端点）。
- raw 修正时 normalized 自动重算（拒绝则整个修正拒绝）。
- 读模型 `resolveCorrectedEvidence` 按 `correctedAt` 升序折叠，晚者胜；原始行与每条修正都可审计（谁/何时/为什么/原值/新值）。

## 5. API 面（/coach/score-evidence）

| 方法 | 路径 | 角色 | 幂等 |
|---|---|---|---|
| POST | /coach/score-evidence/predictions | 任意登录（self） | predictionKey 唯一，冲突读回 `duplicate:true` |
| POST | /coach/score-evidence/assessments | student/teacher/admin（self；来源随角色） | clientKey → (userId,originType,originId) 唯一 |
| POST | /coach/score-evidence/outcomes | student/teacher/admin（self；`verified` 仅教师/管理员） | dedupKey（real_exam:年份 / clientKey 指纹） |
| POST | /coach/score-evidence/outcomes/:id/verify | teacher/admin（teacher 需授权记录） | 幂等（已 verified 直接返回） |
| POST | /coach/score-evidence/corrections | 本人 / admin | 追加式 |
| GET | /coach/score-evidence | self；admin 任意；teacher 需授权记录 | 时间线 + anchors + calibrationEvidence 状态 |

全部端点无认证 → 401（集成断言）；无库 → `store_unavailable` 诚实缺席。

## 6. 零回填与遗留兼容

- 历史 AssessmentHistoryItem 不迁移（零回填）；ledger 只接新写入。
- 遗留行在**读时**解释（校准回退路径）：`assessment-history-*` → accuracy_rate/MOCK；其余 totalScore=150 → exam_total/IMPORTED；其余 → accuracy_rate/MOCK。这是读时解释，不是改写历史。
- paper 提交双写 accuracy_rate ledger 行（MOCK），best-effort，不影响考试路径。

## 7. User.examDate

考试日**事实**（用户录入）。`remainingDays` 降级为遗留派生缓存（S1 不改其消费方）。禁止从 remainingDays 回填 examDate。`GET /coach/score-evidence` 透出 examDate 供 UI 展示。
