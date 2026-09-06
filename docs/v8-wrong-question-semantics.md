# V8 口径文档：错题/复习计数语义（backlog #7）

> 2026-09-07。背景：生产走查发现错题页"待复盘 0"与报告"23 道错题待复盘"并存（v8-full-product-audit P5）。本文是统一前的权威口径声明。

## 三个数据源与三种语义

| 口径 | 来源 | 语义 | 生产示例（jackchou, 2026-09-07） |
|---|---|---|---|
| `pendingWrongQuestionCount`（canonical） | `WrongQuestionReview` 表，`resolved !== true` | **尚未标记解决**（含已复盘但未解决） | 23 |
| `pendingCount`（legacy summary） | 练习记录派生错题本，`reviewedAt == null` | **从未复盘** | 0 |
| ReviewSchedule 到期项 | `ReviewSchedule` 表，`nextReviewAt` | **到期/逾期复习**（与错题本松耦合） | 11 到期 + 13 逾期 |

## 用词规则（前端展示）

- canonical 数字 → 一律表述为"**尚未标记解决**"，禁止表述为"待复盘"。
- legacy pendingCount → "**待复盘**"（从未复盘语义）。
- ReviewSchedule 到期/逾期 → "**到期复习 / 已逾期**"，禁止与错题数混用。
- 任何计数旁标注口径来源（如"错题本口径"/"复习计划口径"）。

## 已实施

- `ReportSummaryPanel`：canonical 分支措辞改为"尚未标记解决"（风险卡 + 行动卡），legacy 分支保持"待复盘"。契约测试：`test/report-wrong-count-semantics.test.js`。

## 未实施（挂起为独立条目）

- **深层对账**：canonical `WrongQuestionReview` 表存在 23 行未解决，而派生错题本仅 12 题——两表漂移（旧数据/重答未回写 resolved？）。对账需触碰 canonical 读模型（架构保护边界），设计先行：数据来源审计 → 回写策略 → 迁移评估。已登记为 `docs/v8-master-backlog.md` P2 #56。
