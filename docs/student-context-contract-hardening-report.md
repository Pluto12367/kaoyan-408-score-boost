# StudentContext Contract Hardening Report — P-1 Mastery Bucket Semantics

日期：2026-09-05
Milestone：StudentContext Contract Hardening
状态：**DESIGN GATE COMPLETE — 已按指示停止，等待批准后才进入行为变更实施**
前置：`docs/student-context-contract-hardening-proposal.md`（P-1 初版提案，本报告为其正式设计门禁并取代其选项编号：P-1a≈Option A、P-1b≈Option B、P-1c≈不实施）
环境：`ENV-005 = BLOCKED`；`D4-B4 = BLOCKED BY ENVIRONMENT`（保持）

---

## 1. Audit — Current Behavior（代码 + 实证证据）

### 1.1 代码证据

- `student-context.selector.ts` `deriveMasteryStatus(mastery, attempts)`：
  - `attempts === 0` → `untouched`
  - `mastery < 0.45` → `weak`
  - `mastery < 0.75` → `review`
  - 否则 → `mastered`
- 同文件 `buildMastery` 桶过滤：
  - `weakNodes = nodes.filter(status === 'weak')`
  - `improvingPoints = nodes.filter(status === 'improving')` ← **`deriveMasteryStatus` 永不返回 `improving`**
  - `masteredPoints = nodes.filter(status === 'mastered')`

### 1.2 实证证据（本轮沙箱运行真实 selector）

输入 4 个节点（weak 0.32 / review 0.60 / mastered 0.90 / untouched attempts=0）：

```text
weakNodes:       [n-weak]
improvingPoints: []                        ← 恒空
masteredPoints:  [n-mastered]
INVISIBLE rows:  [n-review(review), n-untouched(untouched)]
```

- **review 节点（0.45–0.75）不出现在任何桶中** —— 契约不可见。
- untouched 节点不可见 —— 这是正确语义（无样本不参与掌握度统计），**不属于本缺陷**。
- 消费者可见值（该 fixture）：`averageMastery=61`（漏掉 review 行）、`reviewCount=0`（失真）。

### 1.3 测试证据

- `test/student-context-selector.test.js:109` 输入了 `status:'review'` 节点，但**从未断言其桶归属** —— 该丢失行为无测试钉死（也无测试保护）。
- 现有测试均不受影响地通过：没有任何断言把"review 行丢失"固化为期望。

## 2. Impact Analysis（三个已迁移消费者）

消费映射回顾：三个消费者的 `averageMastery` = 三桶节点均值；`reviewCount`（Report `counts.review`、Coach `masterySummary.reviewCount`）= `improvingPoints` 派生。

| 消费者 | 受影响字段 | 现状 | Option A（推荐）实施后 | 消费者代码是否需改 |
|---|---|---|---|---|
| **StudentHome**（`studentHomeContextAdapter`） | `mastery.averageMastery`、`subjects[].value` | review 节点被排除在均值外（数值系统性偏向两端） | review 节点按 0.45–0.75 真实参与均值 | **否**（纯数值修正） |
| **ReportWorkspace**（`reportWorkspaceContextAdapter`） | `averageMastery`、`counts.review` | `counts.review` 恒 0（filter `status==='review'` 于恒空桶） | review 节点入桶后 `counts.review` 自动生效（adapter 已按 `status==='review'` 过滤，无需改） | **否** |
| **Contextual Coach**（`toStudentContextBase`） | `masterySummary.averageMastery`、`reviewCount` | `reviewCount` 恒 0 → AI 看不到复习阶段规模 | `reviewCount` = 真实 review 节点数 | **否**（AI prompt 模板/结构不变，仅事实数值更准确） |

**回归风险面：**
- 三个 adapter 的定向测试均使用**自包含 fixture**（不经过 selector）→ 实施后仍 PASS，零测试改动。
- `student-context-selector.test.js`：现有 5 项测试不钉死缺陷行为 → 仍 PASS；需**新增**钉死正确行为的测试（见 §6 TDD 计划）。
- `student-context-query.test.js`、Coach base-context 测试、controller wiring：不受 selector 桶过滤影响（fixture 或不同路径）→ 预期全绿。
- 展示层视觉变化：摘要数值会变（更准确）；这是本次 hardening 的目的，属于语义修正而非回归。

## 3. Option Evaluation

| 维度 | **Option A**（修正桶过滤：`improving` ∪ `review` 入 improvingPoints，保留字段名） | **Option A2**（重命名字段 improvingPoints → reviewNodes） | **Option B**（新增显式 `reviewNodes` 桶） | **Option C**（引入 masteryStatusVersion） |
|---|---|---|---|---|
| 修复缺陷 | ✅ 直接修复 | ✅（伴随 A 的过滤修正） | ⚠️ 仅提供数据；消费者不迁移则 `averageMastery`/`reviewCount` 依旧失真 | ❌ 本身不修复任何行为 |
| 消费者破坏 | **无**（形状不变、字段名不变） | **破坏**：3 个 adapter + `api/types.ts` mirror + selector/query 测试 + 契约文档历史语义全部要改 | 无（纯增量） | 无 |
| 契约变更 | 无形状变更；仅注释澄清 `improvingPoints` 语义 = "review/improving-stage nodes"（契约注释本就写明 "Despite the historical name…"） | 字段改名 = breaking change，违反"不破坏消费者" | 新字段 = 向后兼容增量（契约修订政策允许） | 新元字段 = 增量但无修复价值 |
| 复杂度 | 1 行过滤条件 + 注释 + 测试 | 大 | 中（新旧桶并存期语义混乱：improvingPoints 恒空僵尸字段） | 中（消费者分支逻辑，3 个消费者却只有 1 个后端版本） |
| 身份/insufficient_data/asOf | 不触碰 | 不触碰 | 不触碰 | 不触碰 |
| 遗留问题 | `improvingPoints` 名称 historic（已注释澄清） | — | 恒空的 improvingPoints 成为长期噪音 | — |

**结论：推荐 Option A（过滤修正 + 语义注释澄清）。** A2 违反不破坏原则；B 可作为 A 被否决后的回退方案；C 仅在将来出现多版本消费并存需求时才有意义。

精确修复定义为：

```ts
// student-context.selector.ts buildMastery 内：
const improvingPoints = nodes.filter((node) => node.status === 'improving' || node.status === 'review');
```

（同时匹配显式 `status:'improving'` 输入与 `deriveMasteryStatus` 派生的 `review`，两种词表都收敛到同一桶。）

## 4. Preservation Checklist（实施时必须保持）

- [x] `knowledgeNodeId`：桶内行仍是 Node 行，身份字段不变（本次不触碰）。
- [x] `insufficient_data`：trend 语义零改动。
- [x] `asOf`：selector 无时钟语义零改动（`student-context-selector.test.js:174` 钉死）。
- [x] untouched 行继续不进任何桶（无样本不伪造掌握度）。
- [x] `mastery.source === 'empty'` 行为不变。

## 5. Forbidden Check

实施仅触及 `apps/api/src/study/student-context.selector.ts`（1 行过滤条件 + 注释）与测试、契约文档。不触及：Prisma schema、migration、任何写路径、Mastery Engine（`ScoreCenterService.applyAttempts/applyReview`）、Recommendation、AI prompt 模板/normalizer、RAG、D4-B4、ENV-005。✅ 合规。

## 6. TDD Plan（批准后执行）

1. **RED**：在 `test/student-context-selector.test.js` 新增测试：输入 weak/review/mastered/untouched 四节点 → 断言 `improvingPoints` 恰含 review 节点（`knowledgeNodeId` 保留）、untouched 仍不在任何桶、weak/mastered 桶不变；并断言显式 `status:'improving'` 输入同样入桶。当前实现下该测试 FAIL（review 行丢失）。
2. **GREEN**：实施 §3 的一行修复 + 契约注释澄清。
3. **Regression**：全量运行 `student-context-selector` / `-contract` / `-query` / `-controller-wiring` / `student-home-context-adapter` / `report-workspace-context-adapter` / `contextual-coach-base-context` / `-context` / `-integration`（预期 57+ 全绿，adapter 测试自包含 fixture 不受影响）+ `npm run build:api`（+ `build:web` 因 `api/types.ts` mirror 无形状变化非必需，但计划中仍执行以保守验证）。
4. 若任何现有断言失败：定位语义，禁止改断言凑绿；唯一预期中的"断言变化"是 §1.3 所述——**当前不存在**钉死缺陷的断言。

## 7. Reference Note

开源参考方向（文档级）：契约演进实践参考了 API 演进的向后兼容原则（不重命名已发布字段、用注释澄清 historic 命名、新增字段才走增量）与 CQRS read-model 的"投影语义修正 + 消费者回归"模式（Microsoft CQRS / Fowler CQRS 对 read model 可重建性的表述）。无代码复制。

## 8. Gate Decision

**READY FOR IMPLEMENTATION — Option A**

判定：缺陷真实（实证复现）、修复最小（1 行过滤 + 注释）、三个消费者零代码改动、无破坏性契约变更、禁止域零触及、TDD 计划明确。

**按任务指示在此停止。** 未修改任何生产代码；行为变更实施（TDD RED → GREEN → Regression）等待你的批准。批准后执行范围：`student-context.selector.ts`（1 行 + 注释）、`test/student-context-selector.test.js`（新增钉死测试）、`docs/student-context-contract.md` §mastery 注释澄清（如需）、回归运行记录，完成后补 `student-context-contract-hardening-report.md` 的实施结果章节。

---

## 9. Implementation Result

实施日期：2026-09-05
批准：Design Gate APPROVED — Option A（修正 bucket 过滤逻辑），范围 = Minimal Semantic Fix

### Changed Files

| 文件 | 变更 |
|---|---|
| `apps/api/src/study/student-context.selector.ts` | `buildMastery` 的 improvingPoints 过滤：`status === 'improving'` → `status === 'improving' \|\| status === 'review'`，附语义注释（review-stage 节点入桶，避免从所有桶中消失） |
| `test/student-context-selector.test.js` | 新增 4 项 P-1 钉死测试（RED→GREEN） |
| `apps/api/src/study/student-context.contract.ts` | 仅注释：`improvingPoints` doc 注明 "include review-stage mastery nodes" |

未触及（与批准边界一致）：StudentContextQueryService、三个消费者 adapter、StudentHome/Coach/ReportWorkspace、Prisma、Migration、Mastery Engine、Recommendation、AI Prompt、RAG、D4-B4。

### TDD Result

- **RED**：新增 4 项测试中 2 项 FAIL（review 入桶 / 消费者均值基线含 review）——精确暴露缺陷；untouched 隐藏与显式 `improving` 兼容两项在修复前即 PASS（它们锁定的是必须保持的语义）。
- **GREEN**：一行过滤修复后 9/9 PASS。

### Contract Impact

- **零形状变更**：字段名、类型、桶结构全部不变；仅 `improvingPoints` 的**内容语义**按契约注释既有意图（"Despite the historical name…"）补全为包含 review-stage 节点。
- `version` 保持 `student-context-v1`（未引入 V2/版本化字段）。

### Consumer Regression

| 套件 | 结果 |
|---|---|
| `student-context-selector`（5 旧 + 4 新） | 9/9 PASS |
| `student-context-contract` / `-query` / `-controller-wiring` | 3+3+1 PASS |
| `student-home-context-adapter` | 11/11 PASS |
| `report-workspace-context-adapter` | 14/14 PASS |
| `contextual-coach-base-context` / `-context` / `-integration` | 9+5+6 PASS |
| **合计** | **61/61 PASS（0 失败）** |

与 Design Gate 影响分析一致：三个消费者零代码改动、自包含 fixture 全绿；运行时可见变化 = review 节点重新参与 `averageMastery` 与 `reviewCount`（数值更准确，展示层无需改动）。

### Build Result

```
build:api  PASS（exit 0）
build:web  PASS（exit 0，13.15s）
```

### Remaining Risks

1. **展示数值变化**：摘要中的平均掌握度与 review 计数会随真实数据变化（方向 = 更准确）；如产品侧对"数值漂移"有文案依赖，需后续观察，不属于代码回归。
2. **QueryService fallback 路径**：`toMasteryNodeFact`（DB 无 mastery 行时的 state.weakPoints 回退）仍硬编码 `status:'weak'` —— 该路径下 improvingPoints 保持为空，属既有回退语义，不在本批准范围内（已登记为 **SC-P2-001 — Mastery fallback semantic alignment**，见 `docs/student-context-production-readiness-audit.md` §8，不处理于本任务）。
3. untouched 节点继续不进任何桶（无样本不参与掌握度统计）——确认为正确语义并已测试钉死。
4. 全量 `npm test` 与 PostgreSQL integration 维持 ENV-005 阻塞，未绕过、未伪造。

**P-1 Implementation = COMPLETE（Option A，Minimal Semantic Fix）**
