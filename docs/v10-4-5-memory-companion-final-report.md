# V10-4 Memory + V10-5 Real AI Companion — Final Report

> 状态：COMPLETE（本地已提交、**未推送**——生产保持 V10-3 MVP HEAD `6b17041`，本切片待所有者审查后另行推送上线）
> 日期：2026-09-07
> 上游：`docs/v10-4-5-memory-companion-design.md`

---

## 1. 交付摘要

**V10-4 Memory（零 LLM）**：用户主动陈述的偏好记忆——确定性正则提取（我喜欢/我想考/我的目标/我在准备/我不擅长/我怕/我每天，单消息 ≤3 条、单条 ≤80 字）→ 有界合并（12 条上限、精确去重 touch lastSeenAt、最旧淘汰、id 确定性）→ RuntimeState `sprite-memory:{userId}` 可丢弃存储（零新表，逐字复刻 coach-session Design Gate）。端点：`GET/POST/DELETE /sprite/memory`（**严格 self-only**，恒用会话用户 id）；`GET /sprite/state` 增量携带 `memory.entries`（≤3）。库不可用 → 显式 `disabled` 标记，绝不静默伪装。

**V10-5 Real AI Companion**：面板"问星野"对话——`POST /agent/supervisor/run`（零新端点，服务端恒取会话用户）；按 `routedTo` 诚实分型渲染：coach→`answer.summary`+suggestions chips+`workflow` 确定性模式标注；tutor→宪法 §4.2 **不内嵌解题**，卡片 deep-link `#/ai`；plan→`#/dashboard`；exam→`#/test` + citations 展示；`ok:false`/网络失败→显式错误文案。每次发送并行 best-effort 记忆回流（`POST /sprite/memory`）。LLM garnish 与 LLM 提取、聊天历史拼接均按设计补编声明**后置**（红线内）。

## 2. 修改文件

| 文件 | 变更 |
|---|---|
| `apps/api/src/study/sprite-memory.ts` | 新增（纯模块：提取/合并/边界常量，零依赖） |
| `apps/api/src/study/sprite-memory.repository.ts` | 新增（RuntimeState KV，@Optional Prisma，enabled 门） |
| `apps/api/src/study/sprite-memory.service.ts` | 新增（remember/list/forget，disabled 诚实降级） |
| `apps/api/src/study/sprite-state.ts` | 增量（输入 `memory?`、输出 `memory.entries` ≤3，v1 契约向后兼容增量） |
| `apps/api/src/study/sprite.controller.ts` | 增量（三个 memory 端点 + state 记忆接线 + SpriteMemoryService 末位 DI） |
| `apps/api/src/study/study.module.ts` | +2 行（providers）+1 行 import |
| `apps/web/src/features/sprite/useSpriteState.ts` | 增量（`SpriteStateView.memory` 类型） |
| `apps/web/src/features/sprite/SpriteWidget.tsx` | 增量（星野记得区 + 对话区 + 适配器 + 记忆回流） |
| `apps/web/src/features/sprite/sprite.css` | 增量（memory/chat 样式，纯 token；面板 max-height 滚动） |
| `test/sprite-memory.test.js` | 新增（6 测试） |
| `test/sprite-state.test.js` / `test/sprite-ui.test.js` | 各 +1/+2 测试 |
| `docs/v10-4-5-memory-companion-design.md` / 本报告 / `docs/current-sprint.md` | 文档 |

## 3. 验证结果

- 定向：sprite 三文件 **40/40 PASS**（9 项新增先 RED 后 GREEN；1 处测试夹具修正——单消息 7 命中被 ≤3 上限正确截断，改为逐模式断言）。
- 全量：`npm test` **1965 / 1963 pass / 0 fail / 2 skipped**（1956 基线 + 9，零新增失败）。
- 构建：`build:api` / `build:web` PASS（首轮 build:api 抓到漏导入 `Body` 装饰器，修复后过）。

## 4. 红线自查

记忆绝不回流学习引擎（mastery/计划/复习零接触）；无向量；RuntimeState 可丢弃声明写入代码头注释；提取与 mood 判定零 LLM；对话不新增端点、body 禁传 userId；tutor 意图不内嵌解题；失败显式（网络 catch / `ok:false` / disabled 三层都有显式文案）。

## 5. 遗留风险

1. 对话为无状态轮次（派生记忆上下文，不携带聊天历史）——红线内取舍，连续对话需 contextual-coach 通道另行设计。
2. LLM 提取偏好、LLM garnish 台词：后置，需独立设计。
3. 埋点仅 `sprite.interact` 四 action；memory 增删未单独埋点（面板打开已覆盖入口观测）。
4. 部署隔离：本切片未推送；推送即进 origin HEAD，下次部署带上——推送时机由所有者掌握。
