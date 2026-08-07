# 408 历史真题映射进度（2009–2021）

> 维护约定：本文档记录 2009–2021 真题从"广义标签证据"升级到"逐题原子级精标"的进度与验收规则。
> 数据源：`data/408/408-2009-2021-historical-question-index.json` 与 `data/408/historical-tag-evidence-2009-2025.json`。

## 现状（2026-08-07）

- 2009–2021 共 611 题，全部建立了题号槽位（47 题/年 × 13 年）。
- 348 题带有公开历史广义主题标签（`source-tagged-broad`）。
- 263 题仅有题号索引，尚无任何标签（`historical-index-awaiting-atomic-inversion`）。
- 这些标签是中文主题（如"排序算法""处理机调度算法"），**不是**原子知识点 ID，禁止伪装成逐题原子级 primary/secondary 精标。

运行审计队列：

```bash
node scripts/audit-historical-408-tags.mjs
```

输出四类：

| 分类 | 含义 |
|---|---|
| `EXACT_ATOMIC_COMPLETE` | 已逐题完成原子级 primary/secondary 映射 |
| `BROAD_ONLY` | 仅有公开广义标签，待原子化 |
| `UNMAPPED` | 题号已建、无任何标签，待从公开题源补标签 |
| `NEEDS_REVIEW` | 标签跨多个科目，需要人工确认主考点 |

## 验收规则（每次精确升级必须满足）

任何把 `BROAD_ONLY` / `UNMAPPED` 提升为精确映射的改动，必须提供：

1. 来源年份与题号（如 `408-2015-Q42`）。
2. 恰好 1 个 primary 原子考点（`role=PRIMARY`）。
3. 0 个或多个 secondary 原子考点（`role=SECONDARY`）。
4. `confidence`（0–1，表示现有知识树对题目的覆盖置信度）。
5. `taggedBy`（`AI` / `HUMAN` / `HYBRID`）。
6. 不发明完整真题题干；只保存题号、分值、自写摘要与映射。

## 边界约束（永久生效）

- `precision = BROAD_HISTORICAL` 的标签**永远不允许** `role = PRIMARY`。
- `BROAD_HISTORICAL` 证据只进入 AllTimeEvidence，不进入 Recent3Y / Recent5Y / exact primary score。
- 精确升级必须写入 `ExamQuestionKnowledgeTag` 且 `precision = EXACT_ATOMIC`。
- `scripts/verify-408-data.mjs` 拒绝任何 `BROAD_HISTORICAL + PRIMARY` 组合（防止证据边界被破坏）。

## 升级队列排序

审计脚本按以下顺序输出待办队列：

1. 最新年份优先（新题对近期考频更有参考价值）。
2. 跨年份综合题型优先（`tagYears` 高者优先）。
3. 历史标签证据量高者优先（`tagFrequency`）。
