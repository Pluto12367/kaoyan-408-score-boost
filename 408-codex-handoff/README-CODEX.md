# 408 Codex Handoff

这个目录用于把“408 今日提分中心”设计、实施计划和最终数据交给 Codex。

## 1. 权威来源

唯一权威知识树：

`data/408/knowledge-tree-408-v2.json`

不要使用、恢复或重新引入旧版：

- `knowledge-tree-408.json`
- `knowledge-tree-408.ts`
- `knowledge-tree-408.types.ts`

如果现有项目中已经存在 V1 文件，先不要删除；在实现计划明确迁移前，只把 V2 作为新功能的数据权威来源。

## 2. 数据精度

### 2022—2026

`data/408/exam-mapping/`

这 5 年是逐题原子级映射，可作为精确证据层使用。

### 2009—2021

`data/408/408-2009-2021-historical-question-index.json`

这是完整题号索引 + 历史广义标签证据层，不要将它伪装成逐题原子级 primary/secondary 精标。

### 考频

`data/408/frequency-model-v2.json`

同时包含：
- Recent 3Y
- Recent 5Y
- All Time Evidence
- Trend

All Time Evidence 当前是混合证据模型，不是所有历史题目都已完成 exact atomic mapping。

## 3. Codex 必读顺序

在修改代码前按以下顺序阅读：

1. `docs/superpowers/specs/2026-08-07-today-score-center-design.md`
2. `docs/superpowers/plans/2026-08-07-today-score-center.md`
3. `data/408/knowledge-tree-408-v2.json`
4. `data/408/frequency-model-v2.json`
5. `data/408/exam-mapping/`
6. `data/408/408-2009-2021-historical-question-index.json`
7. `docs/reference/408/`

## 4. Reference 目录

`docs/reference/408/priority-score-prototype.ts`
和
`docs/reference/408/user-learning-model-prototype.types.ts`

只作为设计参考。

Codex 应优先遵循真实项目结构和 Implementation Plan，
不要直接把 prototype 原封不动复制到生产路径。

## 5. 第一轮禁止修改代码

第一次交给 Codex 时，只允许：

- 阅读 Design Spec
- 阅读 Implementation Plan
- 检查真实项目结构
- 检查 package/workspace
- 检查 Prisma
- 检查 apps/api
- 检查 apps/web
- 检查 packages/shared
- 检查认证、数据库与测试方式
- 汇报 Plan 与真实项目的路径差异和风险

第一轮不要修改代码。

## 6. 后续开发规则

按 Task 逐个执行：

Task 1 → Test → Review → Commit
Task 2 → Test → Review → Commit
...

不要一次性执行 Task 1—10。

## 7. 不包含的文件

本交接包刻意排除了：

- V1 知识树
- 冷启动预览
- 中间验证 JSON
- estimated-vs-actual 审计文件
- 旧 README
- 中间统计结果

这些内容不是 Codex 实现当前功能的必要输入。
