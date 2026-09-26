# V14-②+ 卡片管理面 设计任务书（小 Design Gate）

> **Status**: DESIGN GATE — 待 Owner 批准，未实施任何代码变更。
> **任务来源**: roadmap §2「teacher╱admin 卡片管理面」，Owner 2026-09-26 指令纳入。
> **任务类别**: `CODE-BEHAVIOR`（零迁移——复用迁移 41 的表结构）。

## 1. 范围

教研（teacher╱admin）对 `MemoryCard` 目录的增、删（=停用）、改、查管理面；学生面零变化。

## 2. 审计事实（缺口）

- 当前唯一内容入口是脚本 `scripts/import-memory-cards.mjs`（新建+幂等跳过）；**没有任何更新或停用路径**。
- 已入库卡片（dev 108 张）如需改文本，目前只能手工 SQL——绕过 RULE-10 留痕。

## 3. 设计要点

| 项 | 设计 |
|---|---|
| 端点 | `GET╱POST╱PATCH /admin/memory-cards`、`PATCH /admin/memory-cards/:id/retire`（isActive=false 软停用；**不物理删除**——学生状态行有外键） |
| 角色 | teacher（限自己授权学科的节点）、admin 全量——复用 `resolveUserId╱assertAccess` 同源隔离思路；`@Roles('teacher','admin')` |
| **编辑语义（核心 Owner 决策）** | 卡片文本被学生复习过后，直接改文本会让历史自评对不上内容。建议：**轻量编辑（错字）原行更新并在 reviewLog 无需变化；实质性改写（正面或结论变化）= 停用旧行 + 新建新行**（新 reviewedBy 留痕，学生状态留在旧行上不动）——与题目「版本化承继」同思想但轻量实现 |
| RULE-10 | 新建╱改写必须带 `reviewedBy`+`rightsConfirmed` 字段（请求体强制），日志留痕 |
| 导入器增强 | `--update` 模式（可选，同正面覆盖背面）列为可选项，与 API 编辑语义一致后实施 |
| 前端 | admin 分区新增「记忆卡管理」标签：列表（按节点筛选）+ 新建表单 + 停用按钮 + 编辑对话框；token CSS；演示模式显式拒绝 |

## 4. 测试策略

- E2E（真实 PG+HTTP）：admin 建卡→学生可见；停用→学生队列消失；改写→旧行停用新行生效+旧状态不动；student 角色 403；无 reviewedBy 400。
- 源码契约：管理面挂载、演示拒绝、RULE-10 字段强制。

## 5. Owner Decision

| # | 决策 | 建议 |
|---|---|---|
| D-M-1 | 编辑语义：轻量原行改 vs 停旧建新（见上表） | 按建议的双轨制 |
| D-M-2 | teacher 角色开放范围：全量 vs 按授权学科 | 建议先 admin-only（v1 最小），teacher 授权学科后置 |
| D-M-3 | 导入器 `--update` 模式是否同批做 | 建议做（内容轨批量修订需要） |

## 6. 估时

PROXY 6–8h（端点 2h + 前端 3h + E2E/契约 2h + 门禁 1h）。

---

**STOP. Awaiting implementation approval.**（D-M-1/2/3 批准后实施。）
