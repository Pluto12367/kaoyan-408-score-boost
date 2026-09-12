# Transfer Probe Content Readiness Report

> 日期：2026-09-12 ｜ 性质：**READ-ONLY 内容就绪度审计**（本报告由只读工具生成，未写入任何题库数据）
> 目标（B0）：`30 个高频/高价值节点 × 每节点 ≥2 道经过验证的同构新题`，作为 S2 E2 的生产前内容基础。
> 工具：`scripts/audit-transfer-probe-content.mjs`（只读；`--candidates` 选点，`--validate` 校验）
> 纯校验契约：`packages/shared/src/transfer-probe/probe-content.ts` + `test/transfer-probe-content.test.js`（12/12）

---

## 0. 判定

```text
PROBE CONTENT NOT READY
```

| 指标 | 值 | 目标 | 缺口 |
|---|---|---|---|
| 候选节点（合格池） | **331** | ≥30 | ✅ 充足 |
| 已选节点 | **30** | 30 | ✅ 达成 |
| 池内题目（`source='transfer_probe_pool'`） | **0** | ≥60 | ❌ **−60** |
| **verified** | **0** | ≥60 | ❌ **−60** |
| unverified | 0 | — | — |
| 无法归因（missing） | 0 | — | — |
| 达到目标的节点（≥2 verified） | **0 / 30** | 30 | ❌ **−30** |
| rubric 覆盖 | 0 / 0 需要 | — | （池内无主观题） |
| 难度覆盖 | `{}` | — | （池内无题） |
| 内容隔离 | **clean** | clean | ✅ |
| 同构 manifest | **不存在** | 必需 | ❌ |

**结论**：选点已就绪（B1 完成），**题目内容为 0**。因此 `PROBE CONTENT NOT READY`，且**不得**据任何其他理由把生产 `TRANSFER_PROBE_ENABLED` 置为 `true`（B11 条件未满足）。

---

## A. Candidate Nodes（B1）

### A.1 选点规则（完全透明、非产品排序）

**合格条件**（全部满足）：

```text
KnowledgeNode.isActive = true
AND KnowledgeNode.nodeType = 'atomicPoint'
AND 最新 KnowledgeFrequencySnapshot.evidenceConfidence ∈ {HIGH, MEDIUM}
AND 最新 KnowledgeFrequencySnapshot.recent3Frequency >= 2
```

**排序**（字典序，确定性；**不是**任何产品排序公式）：

```text
primaryScore5y DESC  →  recent3Frequency DESC  →  importance DESC  →  nodeId ASC
```

**为什么用字典序而不是加权分**：加权分会看起来像一个新的排序模型，容易被误当成 Score Opportunity / ROI。字典序只做内容排期，且**未接入任何生产路径**（`packages/shared` 与 `apps/api` 均不引用它）。

**明确声明**：本选点**未修改** Score Opportunity、priority、Recommendation 排序；它是一次离线只读分析。

### A.2 合格池规模（真实数据）

```text
eligible nodes        = 331
其中 primaryScore5y>0 = 144
```

数据来源：生产同一套 `data/408/` 经 `scripts/seed-408-v2.mjs` 落库（本次落库 **1154** 条最新考频快照；`KnowledgeNode` 活跃原子点 **1149**）。四科分布与置信度分布见 §A.4。

### A.3 已选 30 个候选节点

| # | nodeId | subject | examImportance | reason |
|---|---|---|---|---|
| 1 | `CO-C05-S03-P07` | CO | 5 | 近 5 年真题分值 39；近 3 年出现 5 次；节点重要度 5；考频证据置信 HIGH |
| 2 | `OS-C02-S04-P20` | OS | 5 | 近 5 年真题分值 25；近 3 年出现 5 次；节点重要度 5；考频证据置信 HIGH |
| 3 | `CO-C03-S05-P05` | CO | 5 | 近 5 年真题分值 18；近 3 年出现 5 次；节点重要度 5；考频证据置信 HIGH |
| 4 | `OS-C04-S01-P17` | OS | 4 | 近 5 年真题分值 15；近 3 年出现 2 次；节点重要度 4；考频证据置信 HIGH |
| 5 | `DS-C05-S06-P02` | DS | 5 | 近 5 年真题分值 13；近 3 年出现 5 次；节点重要度 5；趋势上升；置信 MEDIUM |
| 6 | `DS-C06-S04-P02` | DS | 5 | 近 5 年真题分值 13；近 3 年出现 5 次；节点重要度 5；趋势上升；置信 MEDIUM |
| 7 | `CO-C03-S05-P16` | CO | 5 | 近 5 年真题分值 13；近 3 年出现 3 次；节点重要度 5；置信 MEDIUM |
| 8 | `DS-C05-S02-P01` | DS | 5 | 近 5 年真题分值 13；近 3 年出现 2 次；节点重要度 5；置信 MEDIUM |
| 9 | `DS-C06-S04-P07` | DS | 5 | 近 5 年真题分值 13；近 3 年出现 2 次；节点重要度 5；置信 MEDIUM |
| 10 | `DS-C02-S04-P05` | DS | 4 | 近 5 年真题分值 13；近 3 年出现 2 次；节点重要度 4；置信 MEDIUM |
| 11 | `OS-C05-S01-P07` | OS | 5 | 近 5 年真题分值 12；近 3 年出现 5 次；节点重要度 5；置信 HIGH |
| 12 | `DS-C05-S06-P05` | DS | 5 | 近 5 年真题分值 12；近 3 年出现 2 次；节点重要度 5；置信 HIGH |
| 13 | `DS-C03-S01-P02` | DS | 4 | 近 5 年真题分值 12；近 3 年出现 2 次；节点重要度 4；置信 HIGH |
| 14 | `CO-C02-S04-P01` | CO | 5 | 近 5 年真题分值 10；近 3 年出现 5 次；节点重要度 5；置信 HIGH |
| 15 | `DS-C06-S08-P07` | DS | 5 | 近 5 年真题分值 10；近 3 年出现 5 次；节点重要度 5；趋势上升；置信 MEDIUM |
| 16 | `CO-C04-S01-P02` | CO | 4 | 近 5 年真题分值 10；近 3 年出现 5 次；节点重要度 4；趋势上升；置信 HIGH |
| 17 | `OS-C01-S03-P12` | OS | 3 | 近 5 年真题分值 10；近 3 年出现 5 次；节点重要度 3；置信 HIGH |
| 18 | `CO-C04-S06-P01` | CO | 5 | 近 5 年真题分值 10；近 3 年出现 2 次；节点重要度 5；置信 MEDIUM |
| 19 | `CN-C04-S05-P09` | CN | 5 | 近 5 年真题分值 9；近 3 年出现 5 次；节点重要度 5；趋势上升；置信 MEDIUM |
| 20 | `CN-C05-S03-P07` | CN | 5 | 近 5 年真题分值 9；近 3 年出现 5 次；节点重要度 5；趋势上升；置信 HIGH |
| 21 | `CN-C03-S03-P09` | CN | 5 | 近 5 年真题分值 9；近 3 年出现 2 次；节点重要度 5；置信 MEDIUM |
| 22 | `CN-C03-S04-P12` | CN | 5 | 近 5 年真题分值 9；近 3 年出现 2 次；节点重要度 5；置信 HIGH |
| 23 | `CO-C02-S02-P18` | CO | 5 | 近 5 年真题分值 9；近 3 年出现 2 次；节点重要度 5；置信 MEDIUM |
| 24 | `CO-C04-S01-P01` | CO | 4 | 近 5 年真题分值 8；近 3 年出现 5 次；节点重要度 4；趋势上升；置信 HIGH |
| 25 | `OS-C02-S03-P15` | OS | 5 | 近 5 年真题分值 7；近 3 年出现 5 次；节点重要度 5；置信 HIGH |
| 26 | `OS-C03-S03-P05` | OS | 5 | 近 5 年真题分值 7；近 3 年出现 5 次；节点重要度 5；置信 HIGH |
| 27 | `CO-C01-S02-P08` | CO | 5 | 近 5 年真题分值 6；近 3 年出现 5 次；节点重要度 5；置信 HIGH |
| 28 | `CO-C06-S03-P04` | CO | 5 | 近 5 年真题分值 6；近 3 年出现 5 次；节点重要度 5；置信 HIGH |
| 29 | `OS-C02-S03-P11` | OS | 5 | 近 5 年真题分值 6；近 3 年出现 5 次；节点重要度 5；置信 HIGH |
| 30 | `CO-C06-S01-P10` | CO | 4 | 近 5 年真题分值 6；近 3 年出现 5 次；节点重要度 4；置信 HIGH |

复现命令：

```bash
DATABASE_URL=<url> node scripts/audit-transfer-probe-content.mjs --candidates --limit 30
DATABASE_URL=<url> node scripts/audit-transfer-probe-content.mjs --candidates --limit 30 --json
```

### A.4 选点池的四科与置信度分布（真实数据）

```text
活跃原子节点            = 1149
最新考频快照            = 1154
primaryScore5y 分布     = 39×1, 25×1, 18×1, 15×1, 13×6, 12×8, 10×9, 9×6, 8×1, 7×3, 6×5, 4×29（其余为 0）
recent3Frequency 分布   = 5×104, 3×8, 2×224, 1×818
evidenceConfidence 分布 = LOW×695, MEDIUM×361, HIGH×98
```

**为什么排除 `evidenceConfidence = LOW`**：LOW 表示该节点缺乏可靠考频证据（多为无快照或快照退化）。为它做迁移探针，等于把测量成本花在"系统自己都不确定其价值"的节点上。此项**不是**产品排序偏好，而是内容投入的置信门槛。

**"high student exposure"（B1 第 3 项）未能从数据可靠得出**：真实曝光度需要 `UserKnowledgeMastery.attempts > 0` 的学生数，测试库里只有 10 条（一次性夹具），不足以排序。**诚实声明：本次选点使用了 primaryScore5y / recent3Frequency / importance 三项，未使用 student exposure。** 生产环境可用该数据重排（`--json` 已输出全部原始字段，人工可重排）。

**"high transfer value"（B1 第 4 项）无法从数据得出**：它取决于该考点能构造出多少**互不相同的同构变式**，属教研判断，不是数据属性。因此它是**人工评审必填项**（manifest 的 `expectedOperation` + `reviewedBy`），本报告不宣称已评估。

---

## B. Probe Question Specification（B2）

每道探针题在 manifest 中必须记录以下字段（缺一即 `unverified`）：

| 字段 | 来源 | 校验方式 |
|---|---|---|
| `nodeId` | 人工声明 | 必须等于数据库解析出的 PRIMARY 节点（直标 → 桥接，生产同款解析） |
| `questionId` | 数据库真实 id | 必须存在于 `Question` 且 `source='transfer_probe_pool'` |
| `questionType` | 人工声明 | 必须等于 `Question.type` |
| `difficultyBucket` | 人工声明 | 归一化后必须等于 `Question.difficulty`（`BASIC/MEDIUM/HARD`，兼容中文旧标签） |
| `isomorphismStatus` | 人工声明 | 只接受 `verified`/`unverified`；声明 `verified` 时必须同时满足 §C 全部条件 |
| `isomorphismEvidence` | 人工填写 | 见 §C；**不接受** `isomorphic: true` 这种无证据断言 |
| `solution` | 人工填写 | 必须存在，且与 `Question.answer` 一致 |
| `expectedOperation` | 人工填写 | 该题与参照题共享的**核心知识操作**名称 |
| `contentSource` | 人工填写 | 内容来源（供追溯） |
| `reviewStatus` | 人工填写 | `approved` 才可能 verified；`pending`/`rejected` 一律 unverified |

另外数据库侧必须有：`stem`、`options`、`answer`、`analysis`、`difficulty`、`type`、`contentFingerprint`、`familyId`；主观题（`COMPREHENSIVE`）还必须有可用的 `Question.rubric`（`criteria[]` 非空），否则 `NOT READY`（B7）。

---

## C. Isomorphism 标准（B3）与禁止自证（B4）

**只有以下五条同时成立才允许 `verified`**：

```text
I1 same node              ← 结构化，对照数据库 PRIMARY 节点
I2 same question type     ← 结构化，对照 Question.type
I3 same difficulty bucket ← 结构化，对照 Question.difficulty（归一化）
I4 same core knowledge operation ← 人工评审（operationId + declaredBy + reviewedAt）
I5 different surface      ← 结构化（contentFingerprint 不同 且 familyId 不同）
```

否则一律 `unverified`。**没有"自动升级为 verified"的代码路径**（`test/transfer-probe-content.test.js` 用 4 个反例钉死：缺人工评审、缺操作声明、`isomorphic=true` 但无证据、结构化事实与库不一致）。

### C.1 为什么需要两半证据

生成与判定若由同一个自由生成结果决定，等于自证。因此 `verified` 需要：

```text
结构半（可机检、对照真实数据库）
  + 人工半（具名评审人 + 时间戳 + 共享操作编号 + approved 状态）
```

`isomorphismEvidence` 就是这个结构的载体 —— manifest 里**不允许**只写 `isomorphic = true`。

### C.2 "同构已验证" ≠ "学生没见过"（B5）

这是两个**不同层次**的条件，本报告与工具都严格分开：

| 条件 | 性质 | 由谁保证 |
|---|---|---|
| `verified isomorphic` | **内容属性** | 本报告 / manifest / 结构校验 |
| `student never seen` | **投递时条件** | 系统在投递时刻验证（零作答 + 零曝光 + 零同族） |

因此：**内容库验收只证明 `question quality + isomorphism`**。真正的 "never seen" 由 S2 的 E1–E6 资格规则在投递时刻判定（`apps/api/src/transfer-probe/transfer-probe.service.ts`，三源反查）。本报告**不**声称任何题目对任何学生"没见过"。

校验器把两个维度**分别输出**：`exposure.clean` 单独报告，且曝光**永不**改变任何题目的 verified 状态，也**永不**作为内容阻断项（因为"被见过"是投递问题，不是内容缺陷）。

---

## D. Probe Pool Isolation（B6）

| 维度 | 实现 | 本次核验 |
|---|---|---|
| 内容标签 | `Question.source = 'transfer_probe_pool'`（唯一合法值；其他值报 `invalid_probe_label`） | 校验器强制 |
| 练习/推荐/搜索排除 | **单点排除**：`apps/api/src/study/study.service.ts:438-447` 从 `nodeQuestionIdsByNode` 中过滤掉池内题 | ✅ 代码在位 |
| 探针选题侧 | `apps/api/src/transfer-probe/transfer-probe.service.ts:426`：`source: poolOnly ? POOL : { not: POOL }` | ✅ 代码在位 |
| 意外曝光可查 | 校验器统计每题的 `priorAttempts`（`PracticeRecord`）与 `priorExposures`（`LearningSession.questionIds`） | ✅ 本次 `pool isolation: clean`（池内 0 题，无曝光面） |

**当前结论**：池为空 → 隔离 trivially clean；**一旦内容入库，必须重跑 `--validate` 并要求 `exposure.clean === true`**。

---

## E. Validation Tool（B9）

`scripts/audit-transfer-probe-content.mjs`（只读）：

| 检查 | 实现 | 级别 |
|---|---|---|
| missing solution | `answer` 为空 | 阻断 |
| missing difficulty | `difficulty` 为空 | 阻断（并入"无法归因"） |
| missing node | 解析不到 PRIMARY 节点 | 阻断（并入"无法归因"） |
| missing rubric | `type='COMPREHENSIVE'` 且 `rubric.criteria` 为空 | 阻断 |
| missing analysis | `analysis` 为空 | 阻断 |
| duplicate question | 池内 `contentFingerprint` 重复 | 阻断 |
| duplicate family | 池内 `familyId` 重复（**换数字的旧题正是这个形状**） | 阻断 |
| duplicate manifest entry | manifest 同一 `questionId` 出现两次 | 阻断 |
| invalid probe label | `source != 'transfer_probe_pool'` | 阻断 |
| manifest ↔ DB 不一致 | 节点/题型/难度/答案与库不符 | 阻断（且降级为 unverified） |
| manifest 引用不存在的题 | `questionId` 不在池内 | 阻断 |
| **unverified 识别** | 上述任一不满足 | 报告为 `unverified`，**绝不自动升级** |

运行：

```bash
DATABASE_URL=<url> node scripts/audit-transfer-probe-content.mjs --validate
DATABASE_URL=<url> node scripts/audit-transfer-probe-content.mjs --validate --json
```

本次真实输出：

```text
pool source            : transfer_probe_pool
manifest               : absent (no human isomorphism evidence recorded)
candidate nodes        : 30 (target 30)
pool questions         : 0
verified               : 0
unverified             : 0
unattributable         : 0
nodes meeting target   : 0 / 30 (>=2 verified each)
rubric covered         : 0 / 0 required
difficulty coverage    : {}
type coverage          : {}
pool isolation         : clean
coverage gap           : nodes -30, verified questions -60

PROBE CONTENT NOT READY
```

---

## F. Content Manifest（供教研填写）

路径：`data/408/transfer-probe-manifest.json`（**当前不存在**）。示例结构：

```json
{
  "version": 1,
  "generatedBy": "content-team",
  "questions": [
    {
      "questionId": "<数据库 Question.id>",
      "nodeId": "CO-C05-S03-P07",
      "questionType": "SINGLE_CHOICE",
      "difficultyBucket": "MEDIUM",
      "isomorphismStatus": "verified",
      "isomorphismEvidence": {
        "sameNode": true,
        "sameQuestionType": true,
        "sameDifficultyBucket": true,
        "differentSurface": true,
        "sameKnowledgeOperation": {
          "operationId": "cache-miss-rate-computation",
          "declaredBy": "<评审人>",
          "reviewedAt": "<ISO 时间>"
        },
        "referenceQuestionId": "<干预题 Question.id>"
      },
      "solution": "A",
      "expectedOperation": "由访存次数计算命中率",
      "contentSource": "content-team-2026-09",
      "reviewStatus": "approved",
      "reviewedBy": "<评审人>",
      "reviewedAt": "<ISO 时间>"
    }
  ]
}
```

**写 manifest 不会让题目变成 verified**：校验器仍会回到数据库核对 I1/I2/I3/I5、核对 `answer`，并检查 `reviewStatus`/`reviewedBy`/`reviewedAt` 与共享操作声明是否齐全。

---

## G. 质量最低标准与"不得为数量降标"（B7 / B8）

每题必须有：`题干`、`标准答案`、`解析`、`核心考点（nodeId）`、`题型`、`难度`、`同构说明`。
主观题还必须有 `rubric`（`criteria[]` 非空）——否则 `NOT READY`。

**明确禁止**（B8），校验器已能拦截其中大部分：使用旧题、改数字的旧题、学生已见过的题、难度明显不同的题、没有答案的题、无法解释为什么同构的题。

**本轮未生成任何题目。** 原因（诚实说明）：

1. B4 禁止生成与判定由同一自由生成决定 —— 而没有具名人工评审，任何我生成的题目最多只能是 `unverified`；
2. B7 要求主观题有 rubric、客观题有可核对的答案与解析，且需教研审定；
3. B8 明确"宁可 N < 30，也必须报告 gap"，**禁止为凑够 60 道而降标**。

因此正确的产物是：**选点 + 规格 + 校验工具 + 精确缺口**，而不是 60 道未经评审的题。

---

## H. Coverage Gap（精确缺口）

| 缺口 | 数量 | 说明 |
|---|---|---|
| 节点 | **0** | 30 个候选节点已选定（合格池 331，可扩充） |
| **题目** | **60** | 30 节点 × 2 道 verified（S2 形式化设计建议 1 道 practice-bucket + 1 道 exam-bucket） |
| manifest | 1 份 | 需教研填写同构证据与评审记录 |
| 主观题 rubric | 取决于题型选择 | 若探针全用客观题则不需要；但 CO/OS 的大题考点可能需要 `COMPREHENSIVE` + rubric |

**关单条件**（全部满足才可提出 `TRANSFER_PROBE_ENABLED=true`，B11）：

```text
1. data/408/transfer-probe-manifest.json 存在，且 60 条记录均有完整同构证据 + 具名评审
2. 60 道题入库且 source='transfer_probe_pool'
3. --validate 输出 verified >= 60 且 nodes meeting target = 30
4. --validate 输出 exposure.clean = true（无意外曝光）
5. blocking findings = 0
6. 主观题 rubric 覆盖 100%
7. 仍保持 MASTERY_SEMANTICS = OFF
```

---

## I. 不进入 S3（B12）

本阶段**只**解决 S2 内容可用性。**未**做且不做：

```text
TransferGap → TransferFactor → ROI → Recommendation Ranking   （属 S3）
```

选点排序是离线内容排期，**未接入任何生产排序路径**；`packages/shared` 与 `apps/api` 均不引用它。

---

## J. 停止声明

```text
Phase B = COMPLETE（内容就绪度审计完成）
PROBE CONTENT NOT READY
```

不自动开始 S2 runtime implementation；不启用生产 `TRANSFER_PROBE_ENABLED`；不修改 Mastery / ROI / Score Engine。
