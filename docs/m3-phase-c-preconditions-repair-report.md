# M3 Phase-C Preconditions Repair — Decision Report

> 日期：2026-09-11 · 分支 `feature/v3-product-refactor` · HEAD `61d6f26`
> 目标：修复并验证 M3 Phase C 的前置语义问题——"低掌握度 + 错误复习可能导致 mastery 上升"
> **未做**：未切换 Phase C、未部署、未改生产语义、未自行定稿 EMA 公式

---

## A. Semantic Problem

### A.1 机制（代码事实）

生产 EMA 把掌握度拉向一个"按结果给定"的目标值，而**目标值就是不动点**：

```
target(correct, d) = min(1, 0.72 + 0.055d)       // d=1 → 0.775 … d=5 → 0.995
target(wrong,   d) = max(0, 0.38 - 0.045(d-1))   // d=1 → 0.380 … d=5 → 0.200   ← 正的下界
mastery' = clamp01(mastery + α·(target − mastery))        α = 0.18 (PRIMARY)
```

`target(wrong, d)` **恒为正**，所以只要掌握度低于它，一次**错误**作答就会把掌握度**往上拉**。

### A.2 违反区间（精确、可复算）

| 难度 | 错误目标值 | **低于此值时，答错会提升掌握度** | 正确目标值 | **高于此值时，答对会降低掌握度** |
|---|---|---|---|---|
| 1 | 0.380 | mastery < 0.380 | 0.775 | mastery > 0.775 |
| 2 | 0.335 | < 0.335 | 0.830 | > 0.830 |
| 3 | 0.290 | < 0.290 | 0.885 | > 0.885 |
| 4 | 0.245 | < 0.245 | 0.940 | > 0.940 |
| 5 | 0.200 | < 0.200 | 0.995 | > 0.995 |

**注意违规区间之宽**：对简单题（d1），任何 mastery < 0.38 的学生答错都会被"奖励"。这正是本产品最该帮助的薄弱学生群体。而 `NEUTRAL_MASTERY = 0.5` 高于这些下界，所以问题**只在学生真正变弱后才出现**——这也是它此前未被注意的原因之一。

### A.3 四条不变量的判定（**测试证明，非声明**）

| 不变量 | 判定 | 证据 |
|---|---|---|
| **A 失败不提升** | ❌ **被违反** | `test/mastery-candidate.test.js`：`state(0.22)` + 错误(d1) → 0.22 → 0.2488 |
| **B 成功不下降** | ❌ **被违反** | `state(0.95)` + 正确(d1) → 0.95 → 0.9185 |
| **C 失败不减轻薄弱** | ❌ **被违反** | 与 A 同域（weakness = 1 − mastery） |
| **D 差异可证** | ✅ **成立** | 单步 \|Δ\| ≤ α（0.18）全网格成立；两模型差异确定且有界；每次分歧可归因到具体复习事件 |

---

## B. Candidate Fix

### B.1 候选 C1 —— "方向保持目标"（direction-preserving target）

```
target_raw(correct, d) = min(1, 0.72 + 0.055d)          // 与生产完全一致
target_raw(wrong,   d) = max(0, 0.38 - 0.045(d-1))      // 与生产完全一致

target_effective = isCorrect ? max(target_raw, mastery)   // 正确：目标不得低于当前估计
                             : min(target_raw, mastery)   // 错误：目标不得高于当前估计

mastery' = clamp01(mastery + α·(target_effective − mastery))
```

### B.2 数学含义

因为 EMA 的不动点**就是 target**，而 C1 **不修改 target_raw**：

> **两个模型的均衡点完全相同，差异只存在于瞬态**——C1 只是不允许一次结果把估计推向**与其自身方向相反**的一侧。

这不是新公式，而是给既有公式加了一条**方向约束**。

### B.3 影响范围（最小性）

| 维度 | 是否变化 |
|---|---|
| 数据结构（`MasteryState`） | **不变** |
| API contract | **不变** |
| `accuracy` / `recentAccuracy` / `attempts` / `correctCount` / `wrongCount` / `confidence` | **逐字段相同**（测试断言） |
| 均衡点（长期收敛目标） | **相同**（测试断言 60 次迭代后差 < 1e-6） |
| 瞬态（单步、连续多步） | 变化，且**只在旧模型违反不变量的格子里** |
| 回滚 | 删除一个分支即回到生产行为 |

### B.4 风险 / 权衡（必须披露）

**C1 的代价 = 地板/天花板黏滞**：低于错误目标值时，失败产生**零**掌握度变化（而非上升）；高于正确目标值时，成功同样产生零变化。

- 满足不变量 A/B/C 的字面要求（**零不是上升**）
- 但它是**产品可见**的：一个 0.22 的学生连续答错，掌握度会**停在 0.22 不动**
- 另一种取向（**C2，未实施**）是 `target_wrong = min(raw, mastery − margin)`，让失败**总是**小幅下降；代价是引入新的 margin 常数、并允许**无界下行**

> **选择 C1 还是 C2 属于产品判断；本模块不决定公式**（任务明令禁止），只提供已量化的候选。

---

## C. Before / After

### C.1 组合扫描（5 区间 × 正确/错误 × 难度 1/3/5 × 重复 1/3 = **60 格**）

```
oldViolationRows      = 10      ← 旧模型在 10 个格子违反不变量
candidateViolationRows= 0       ← 候选零违反
changedRows           = 10      ← 只有那 10 个格子不同
maxAbsDelta           = 0.0785  ← 单格最大差异，小于一个 α(0.18)
```

**关键性质：候选在旧模型正确的 50 个格子里逐位相同。** 这是"最小变更"的最强证据。

两个具体反直觉案例：

| 格子 | 旧模型 | 候选 | 差异 | 说明 |
|---|---|---|---|---|
| `0.00-0.30 / 错误 / d1 / ×3` | **0.2918** | **0.22** | −0.0718 | 旧模型把**连续三次答错**当成掌握度**上升 +0.0718** |
| `0.90-1.00 / 正确 / d1 / ×3` | **0.8715** | **0.95** | +0.0785 | 旧模型把**连续三次答对**当成掌握度**下降 −0.0785** |

### C.2 真实 PostgreSQL cohort（15 学生 × 6 节点，同一批学生与同一批事件）

逐学生对比（节选，完整表见脚本输出）：

| case | 旧 ΔMastery | 候选 ΔMastery | 旧 ΔPrio | 候选 ΔPrio | 旧 ΔRank | 候选 ΔRank |
|---|---|---|---|---|---|---|
| `0.00-0.30/all_wrong/x2@3d` | **+0.0229** | **+0** | 2 | 2 | 0 | 0 |
| `0.00-0.30/all_correct/x1@1d` | +0.1197 | +0.1197 | −4 | −4 | 2 | 2 |
| `0.00-0.30/mixed/x3@7d` | +0.2105 | +0.2105 | −6 | −6 | 3 | 3 |
| `0.75-1.00/all_wrong/x2@3d` | −0.1736 | −0.1736 | 9 | 9 | −2 | −2 |
| `0.60-0.75/all_wrong/x2@3d` | −0.1278 | −0.1278 | 5 | 5 | −2 | −2 |

> **15 行里只有 1 行不同**，且正是语义错误的那一行。其余 14 行的 mastery / priority / rank **完全一致**。

不变量在真实库上的检验：

```
all_wrong:   旧模型 5 名学生中 1 名出现"答错反而涨"，候选 0/5   ← 原问题消失
all_correct: 旧模型 0/5 出现"答对反而降"，候选 0/5
0.00-0.30 + all_wrong: 旧 +0.0229 → 候选 +0                    ← 报告的症状消除
```

### C.3 下游传播（未因修复而改变）

| 指标 | 候选侧 |
|---|---|
| median mastery Δ | +0.0229 |
| p90 mastery Δ | +0.1387 |
| median \|Δpriority\| | 3 |
| max \|Δpriority\| | **9** |
| median \|Δrank\| | 2 |
| max \|Δrank\| | **3** |
| 受影响比例 / 无影响比例 | 100% / 13.3% |

**归因链保持完整**（真实库断言）：每个分歧都带 `triggerEventType = review.recalled`，无触发事件数为 0；形如
`review.recalled → 掌握度 0.22 → 0.2429（+0.0229） → 优先级上升 2 分 → 排名未变`。

---

## D. Safety

| 项 | 结果 |
|---|---|
| **authoritative writes** | **0** —— `UserKnowledgeMastery`（取值+稳定性）/`ReviewSchedule`/`ReviewAttempt`/`RecommendationAction`/`UserEvent` 指纹前后 **deep-equal** |
| **student isolation** | **PASS** —— 每个学生的链恰好含自己的 6 个节点，无跨学生污染 |
| **candidate universe** | **一致** —— 两条路径同一宇宙；候选亦在同一宇宙（断言） |
| **ranking stability** | **有界且确定** —— max \|Δrank\| 3、max \|Δpriority\| 9（爆炸阈值 25，触发 0）；重复调用逐字段一致；无震荡 |
| 生产语义 | `score-center/service.ts` **0 行改动**、`mastery.ts` **0 行改动** |
| Shadow 权威性 | 纯模块/服务/summary/每行均 `authoritative:false`；`productionSemanticsChanged:false` |
| 候选默认值 | **默认仍是生产模型**；`?shadowModel=candidate` 才启用；`shadowModel` 仅在教师/管理员端点暴露 |

---

## E. Regression

| 项 | 结果 |
|---|---|
| `npm test` | **2257 / 2255 / 0 fail / 2 skip**，exit 0 |
| `npm run build:api` | exit 0 |
| `npm run build:web` | exit 0 |
| `test:integration:review-shadow-cohort`（含语义修复对比） | exit 0 |
| `test:integration:score-loop`（16 环节） | exit 0 |
| `test:integration:effectiveness` | exit 0 |
| `test:integration:event-key` | exit 0 |
| `test:integration:content-import` | exit 0 |

既有失败分类（**未因本轮改变，未伪造 PASS**）：

| 类别 | 项 |
|---|---|
| **NEW REGRESSION** | **无** |
| **PRE-EXISTING** | `integration-postgres.mjs:1254` 断言；2 个既有 skip；既有死代码；`study.service.ts:3424` 合成 75% 默认值 |
| **FIXTURE / DATA GAP** | `exam-aligned` 缺 `Question` 题库夹具；`seed:knowledge-map` 缺 legacy `KnowledgePoint` |
| **ENVIRONMENT** | 无 SSH 凭据（部署 PENDING）；4 套集成连跑时瞬时 `0xC0000409`（单独复跑 exit 0） |
| **OWNER DECISION** | M3 Phase C 切换；F4 教研内容 |
| **EXTERNAL INPUT** | 真实考研分录入通道（不存在） |

**本轮过程中的自我纠正**：`test/mastery-candidate.test.js` 首版 4 项失败，全部源于**同一处测试文件缺陷**（ESM 中误用 `require`），判定为 TEST BUG 而非实现缺陷，改为顶层 `import` 后 19/19 通过。

---

## F. M3 Phase-C Readiness

```
M3-PHASE-C PRECONDITIONS = READY
```

六项停止条件逐条成立：

| 条件 | 证据 |
|---|---|
| semantic invariants PASS | A/B/C 在候选中零违反（60 格扫描 + 真实库 15 学生）；D 两模型均成立 |
| shadow cohort PASS | exit 0，含两模型对比与不变量断言 |
| PostgreSQL E2E PASS | 真实库 + 真实 HTTP；5 套集成脚本 exit 0 |
| no authoritative writes | 五表指纹 deep-equal = 0 |
| no student leakage | 每链恰好含自身节点集 |
| ranking impact bounded | max \|Δrank\| 3、max \|Δpriority\| 9，无爆炸、无震荡 |

**同时必须由所有者定夺（工程不代答）**：
1. **是否采用方向约束**（C1）—— 它消除反直觉语义，代价是地板/天花板黏滞（极端区失败/成功产生零变化）
2. **若采用，是 C1 还是"C2 总是下降"** —— C2 需引入新常数并接受无界下行
3. **切换时机** —— 本报告只证明前置语义问题已被修复并可验证；**未执行 Phase C**

**未做**：未切换、未部署、未改生产语义、未把 shadow 结果写入权威状态、未自行定稿 EMA 公式、未做 F4 Ability Mapping、未弱化任何既有断言。
