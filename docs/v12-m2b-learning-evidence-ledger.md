# V12-M2b — Learning Evidence Ledger (frontend consumption)

> 里程碑：V12-M2b（Task Evidence 前端兑现）
> 目标：让 V12-M1 建立的证据层**到达学生**——回答"我完成的这个任务/这次复习，到底产生了什么学习证据？"
> 状态：**实现 + 测试 + 门禁通过**
> 纪律：零 Schema / 零写路径 / 复用既有设计 token / 静态演示模式不渲染

---

## 1. 背景与缺口

| 资产 | 状态 |
|---|---|
| V11-M2 `TaskEvidencePanel`（按任务的能力变化投影，`GET /coach/task-evidence`） | 已存在并已消费（报告总览 tab） |
| **V12-M1 证据账本（`GET /coach/learning-evidence`）** | **后端已完成，前端零消费** ← 本次缺口 |

M1 让系统开始**记录**证据，但学生看不到，也就无法获得"做完有用"的反馈——这正是审计原话"系统零记录、零归因、**零反馈**"里最后一项。

## 2. 实现

| 文件 | 类型 | 说明 |
|---|---|---|
| `apps/web/src/api/types.ts` | 修改（+42 行） | `LearningEvidenceRecord` / `LearningEvidenceSummary` / `LearningEvidenceBundle` |
| `apps/web/src/api/endpoints/dashboard.ts` | 修改（+11 行） | `fetchLearningEvidence(limit = 30)` → `/coach/learning-evidence` |
| `apps/web/src/features/report/LearningEvidenceLedger.tsx` | 新增 | 证据账本面板 |
| `apps/web/src/features/report/learning-ledger.css` | 新增 | **纯 token**（零 hex/rgba），词汇与同目录 `task-evidence.css` 一致 |
| `apps/web/src/features/report/ReportWorkspace.tsx` | 修改（+2 行） | 挂载于总览 tab，紧随 `TaskEvidencePanel` |
| `test/learning-evidence-ui.test.js` | 新增（9 项） | 诚实契约 + 接线 + token 契约 |

### 2.1 三类证据在 UI 上必须可区分

| 记录强度 | 徽标 | 颜色 token | 语义 |
|---|---|---|---|
| `strong` | **观测证据** | `--primary-faint` / `--primary-strong` | 系统观测到已判分作答或重做结果——唯一可支撑能力判断的一类 |
| `weak` | **自评证据** | `--amber-soft` / `--amber-strong` | 学生自报数字；已记录，但**不作为能力依据** |
| `none` | **仅活动** | `--surface-soft-2` / `--text-muted` | 动作发生但什么都没被观测到 |

### 2.2 四条诚实规则（测试钉死）

1. **只有被系统观测到的作答才能支撑能力判断** —— 这句话对学生可见（不是内部注释）
2. **系统必须说出它的拒绝**：当 `hasAbilityEvidence=false` 时渲染"没有可支撑能力推断的观测证据，**系统拒绝据此判断能力变化**"，而不是画一个 0 或一个提升
3. **活动行永不渲染能力数字**：`factLine` 依据 `canInfluenceMastery` 决定是否追加"（不作为能力依据）"；无观测时直接输出"未观测到任何表现数据。"而非 0
4. **缺席即缺席**：`reason==='store_unavailable'` 或 `summary==null` → 明示"数据存储未就绪，因此不显示任何能力判断"；记录为空 → 明示"还没有任何学习证据记录"

### 2.3 静态演示与错误

- `isStaticDemoMode()` → `return null`（演示环境无真实学生，不渲染伪证据）
- 请求失败 → 显式文案"学习证据加载失败，请稍后重试。"

## 3. 门禁证据

| 项 | 命令 | 结果 |
|---|---|---|
| 前端类型检查 | `tsc -p apps/web/tsconfig.json --noEmit` | exit 0 |
| 定向测试 | `node test/learning-evidence-ui.test.js` | **9/9 pass** |
| **正式测试门禁** | `npm test` | **2121 tests / 2119 pass / 0 fail / 2 skip，exit 0** |
| **正式构建门禁** | `npm run build:web` | **exit 0** |

token 存在性已逐个核对（`--line-faint` / `--radius-lg` / `--surface-soft` / `--surface-soft-2` / `--text-strong` / `--primary-faint` / `--primary-strong` / `--amber-soft` / `--amber-strong` / `--space-1..4` 全部存在于 `styles.css`）——首版误用了不存在的 `--border` / `--surface-muted` / `--success` 等，已在提交前全部替换为真实 token。

## 4. 明确未做

| 项 | 原因 |
|---|---|
| 今日任务行内联证据徽标增强 | V11-M2 的 chips 已覆盖（`掌握度 ↑ / 已练·未见提升 / 已练习`），且刻意不为 `insufficient_data` 渲染徽标（无主张即无徽标，已是诚实行为） |
| 证据分页 / 筛选 | 当前 `limit=30` 足够；真实数据量积累后再评估 |
| 前端运行时 DOM 测试 | 仓库既有前端测试均为源码行为断言（`frontend-events.test.js` / `task-evidence-ui.test.js` 同约定），引入 DOM 测试框架属独立工程决策 |
| 证据 → 掌握度回流的学生可见化 | 需先完成 V12-M3 语义统一（写路径，需批准） |
