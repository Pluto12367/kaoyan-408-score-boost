# StudentContext Contract Hardening Proposal

日期：2026-09-05
性质：**提案（proposal）** — 本文件不改变任何行为、契约、selector 或消费者
触发：Consumer Convergence Milestone Phase 3 审查
环境：`ENV-005 = BLOCKED`；`D4-B4 = BLOCKED BY ENVIRONMENT`

---

## 1. Review Scope

按 milestone Phase 3 要求审查了：

- **Identity consistency**：`knowledgeNodeId` / `knowledgePointId` / `actionId` / `studyTaskId` 分离。
- **Semantic consistency**：mastery 桶、review 状态、insufficient_data、freshness。

## 2. Review Result — Identity: PASS

- Contract（`student-context.contract.ts`）四类身份字段空间分离，无通用 `id` 字段承载知识/任务实体。
- 前端 adapter（studentHome / reportWorkspace）与 Coach base bridge 均未发现 Node-as-Point 或 Task-as-Action。
- legacy `StageReport.mastery.weakestPoints[].knowledgePointId`（Node-as-Point）无任何消费者转入 canonical 路径。

## 3. Review Result — insufficient_data / freshness: PASS

- trend 契约统一 `window/baseline/sampleSize/status/value`，缺失样本为 `insufficient_data + null`，不造 0。
- selector 无 `Date.now()`；asOf 单点解析传入全部 loader（`student-context-selector.test.js` 钉死）。

## 4. FINDING — Mastery 桶语义不一致（提案 P-1）

### 现象（代码证据）

1. `student-context.selector.ts` 的 `deriveMasteryStatus(mastery, attempts)` 产生四种状态：
   `untouched`（attempts=0）/ `weak`（<0.45）/ `review`（0.45–0.75）/ `mastered`（≥0.75）。
2. 但 `buildMastery` 的桶过滤为：
   - `weakNodes = nodes.filter(status === 'weak')`
   - `improvingPoints = nodes.filter(status === 'improving')`
   - `masteredPoints = nodes.filter(status === 'mastered')`
3. `deriveMasteryStatus` **永远不会返回 `improving`**，因此：
   - `improvingPoints` 在 DB 路径下**恒为空数组**；
   - `review` 状态的节点（0.45–0.75）**不出现在任何桶中**，对外不可见；
   - 消费者（两个 adapter、Coach base bridge）基于三桶计算的 `averageMastery` 与 `reviewCount` 会**系统性遗漏 review 阶段节点**。

### 影响（当前实际消费者）

| 消费者 | 受影响字段 | 影响 |
|---|---|---|
| StudentHome 摘要 | `mastery.averageMastery`、subjects | review 节点不参与均值（显示值偏高/偏低取决于数据） |
| ReportWorkspace 摘要 | 同上 + `counts.review`（恒 0） | review 计数失真 |
| Contextual Coach base | `masterySummary.reviewCount`（恒 0） | AI 看到的复习阶段计数失真 |

该 quirk 在 StudentHome / ReportWorkspace 迁移门禁时已存在并通过当时的验收（基线行为一致），非本次引入；Coach 迁移报告中已作为 remaining risk 记录。

### 提案（三选一，供人工决策）

- **P-1a（推荐）**：`improvingPoints` 桶过滤改为 `status === 'improving' || status === 'review'`（即"复习/提升中"桶），并在契约注释中明确 `improvingPoints` 语义 = review-stage nodes。
  - 影响面：StudentHome/Report/Coach 的 `averageMastery` 与 `reviewCount` 数值将变化（变准确）；需要同步更新三个消费者的定向测试期望与 parity 说明。
  - 性质：**行为变更**（向正确语义收敛），必须走契约 §10 修订记录 + 单独批次 + 消费者回归。
- **P-1b**：契约新增第五个只读桶 `reviewNodes`（纯增量，不动现有桶）。
  - 影响面：向后兼容；消费者逐步切换；`averageMastery` 语义仍需消费者自行决定是否纳入。
- **P-1c**：维持现状，仅在文档记录。
  - 适用条件：若近期无消费 review 计数的业务需求。

### 明确不做

- 本 milestone **不实施** P-1 任何选项（红线：不为迁移扩契约/改 selector 行为）。
- 不静默改行为：任何选项实施前需人工批准 + 消费者回归批次。

## 5. Other Observations（无需行动）

- `weakPoints`（Point 行为弱点）与 `weakNodes`（Node 掌握度）命名 historic 但契约注释已澄清，身份安全。
- `recommendationEvidence` 为 provenance-only，无第二推荐源风险。
- `freshness.sources` 的 available/unavailable 标注未被前端消费——可留待未来 UX 需要，非缺陷。

## 6. Gate

**Contract = READY AS-IS（带 1 项已记录提案 P-1，行为未变）。**
