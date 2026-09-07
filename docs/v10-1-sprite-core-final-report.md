# V10-1 Sprite Core — Final Report

> 状态：COMPLETE（代码与测试完成；未提交，等待所有者审查；V10-2 未启动，按指令等待确认）
> 日期：2026-09-07
> 上游：`docs/v10-sprite-product-constitution.md`（产品宪法）、`docs/v10-1-sprite-core-design.md`（Phase A 契约冻结）

---

## 1. 交付摘要

V10-1 交付精灵的后端核心：**9 态确定性 Mood Engine + 宪法级禁词文案层 + 只读端点 `GET /sprite/state`**。全部纯派生：零迁移、零新表、零存储、零 LLM、零既有端点改动；精灵可整体删除而不影响系统其他行为。

TDD 全程：Phase B 先写 18 项契约测试（RED，ENOENT 全红确认）→ Phase C 最小实现转绿（18/18）。

## 2. 修改文件（精确清单）

| 文件 | 变更 | 内容 |
|---|---|---|
| `apps/api/src/study/sprite-state.ts` | 新增 | 契约类型（SpriteState/Evidence/输入快照）+ `buildSpriteState` 纯函数：10 档有序守卫（状态图语义，首中即停），CL-1~CL-5 澄清全部落地 |
| `apps/api/src/study/sprite-persona.ts` | 新增 | 六类禁词校验 `validatePersonaCopy`（comparison/guilt/empty_cheer/anxiety/childish/false_promise + length）+ 全量台词模板 `buildSpriteLines`（静态模板 build-time 自检；运行时干预 headline 不洁则落安全兜底句） |
| `apps/api/src/study/sprite.controller.ts` | 新增 | `GET /sprite/state`（RoleGuard + resolveUserId 逐字复用 DailyBriefController 模式）；四来源防御性拉取，失败记入 `degraded.unavailableSources`；celebrate 证据复用 `buildProgressStory`（周环比有效性门不重算）；`activeSession` = 未完成且 2h 内活跃的会话 |
| `apps/api/src/study/study.module.ts` | +2 行 | import + controllers 数组注册 `SpriteController` |
| `test/sprite-state.test.js` | 新增 | 18 项测试（四个 RED 组 + 接线/纯度契约），沙箱 loader 强制零依赖（sprite-state 仅许 import sprite-persona；禁 Date.now/Math.random；控制器禁 LLM/写调用字样） |
| `docs/v10-1-sprite-core-design.md` | 新增 | Phase A：开源参考检查 + SpriteState/Evidence 契约 + mood 裁决表 + 模板目录 + 测试计划 |
| `docs/current-sprint.md` | 账本 | V10-1 完成条目 |

未触碰：shared 引擎、Prisma Schema、Mastery 写路径、Recommendation、Effectiveness、前端（`build:web` 按门禁豁免——本轮零前端文件变更）。

## 3. 验证结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 定向 | `node --test test/sprite-state.test.js` | **18/18 PASS**（先 RED 后 GREEN） |
| 全量 | `npm test` | **1943 tests / 1941 pass / 0 fail / 2 skipped**（基线 1925/1923/0 + 本轮 18 项，零新增失败） |
| 构建 | `npm run build:api`（含 build:shared） | PASS |
| 前端 | `npm run build:web` | 按门禁豁免（零前端变更） |
| PostgreSQL 集成 | `npm run db:test:up && npm run test:integration:postgres` | **预存失败，非本轮引入**（见 §5） |

红线逐条核验（全部由测试钉死，非口头声明）：

1. 陪伴层非事实源：纯函数零副作用；`source` 恒 `'derived'`。
2. 零新表/零迁移/零 RuntimeState 写入：无任何 Prisma/存储 import（沙箱 require 全拒）。
3. 零用户向量记忆：无任何存储面。
4. 零 LLM：控制器源码断言 `doesNotMatch /deepseek|aiTutor/i`。
5. 数字全部来自既有派生：concern 台词逐字复用 V4 干预 headline（测试断言逐字相等）；celebrate 周环比来自 `buildProgressStory` 产出；模板只插值。

## 4. 实现要点（与设计文档的差异）

零契约偏差。实现中补充的两个防御细节（设计文档语义内）：

- `sprite-persona.buildLine` 对**静态模板**做 build-time 自检：未来任何模板编辑触禁词 → 模块加载即抛错（测试先红），不可能到达学生。
- `concern` 台词复用 V4 干预 headline 逐字（保证数字不被重算）；若运行时 headline 未过禁词校验（防御未来 V4 文案改动），落安全兜底句 `复习和错题在提醒你：今天先清最急的一件事。`，证据引用不变。

## 5. 遗留风险与预存问题

1. **【预存，非本轮引入】PostgreSQL 集成脚本断言失败**：`scripts/integration-postgres.mjs:1254→3168` 断言"明日计划含 ≥3 个目标任务"（review scheduler regression）。归因实验：**摘除 SpriteController 注册后复跑，失败完全相同**；全新库（down -v → up）亦复现 → 属当前分支 HEAD 预存债务。账本最近一次集成全绿记录在 V6.3（`b72bfc5`）；此后 V8 #13 断档结转重锚、V9 Phase 2 周强度改写计划管线，目标任务在目标日期上的分布很可能已变化。**本轮不修**（单任务纪律 + 不属精灵范围），已登记 current-sprint 地雷区，建议独立小任务收口。
2. `activeSession` 的 2 小时窗口与"弹泡每自然日 ≤1 次"属 V10-2 前端职责，后端已备好 `presence.mode='quiet'` 信号。
3. `bond.milestones` V10-1 恒 `[]`（V10-3 按 quest/ProgressStory 证据填充），契约已预留。
4. 测试 loader 为双模块沙箱（sprite-state + sprite-persona）；若未来 sprite-state 增加新 import，loader 的 require 白名单需同步（测试会以显式错误提示）。

## 6. 开源参考方向（AGENTS.md 参考检查收尾）

- [statelyai/xstate](https://github.com/statelyai/xstate) / [Stately 状态图](https://stately.ai/docs/xstate)：守卫转移、首中即停、转移纯函数化 → mood 阶梯实现为有序守卫函数（未引入依赖）。
- [Game Programming Patterns — State](https://gameprogrammingpatterns.com/state.html)：单状态+显式转移 → 9 态互斥、可穷举测试。
- [TUM Emotion Engine for Games](https://collab.dvb.bayern/download/attachments/77832785/ibrahim_tum_thesis_master_printable.pdf)：appraisal→mood 单向流 → 采纳"证据评估→情绪"；**拒绝**其模糊逻辑/OCC 情绪代数（与诚实红线冲突）。
- 仓库内先例（最强参考）：`daily-brief.ts`/`progress-narrative.ts` 的纯模块 + 测试沙箱 loader 模式，本实现与之完全同构。

## 7. 下一步（待所有者确认）

- **V10-2 Sprite UI**（MVP 终点线）：`features/sprite/` 悬浮球 + 面板 + App.tsx ≤10 行挂载；四主题/375px/reduced-motion 适配；弹泡频次与静音（localStorage）。
- 独立建议项：集成脚本 review-scheduler 断言收口（预存债，独立小任务）。
