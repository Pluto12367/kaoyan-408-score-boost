# 408 Knowledge Catalog Codex Handoff

本交接包只服务一个功能：

> 在现有考研 408 系统中增加“408 知识点目录 / 四科知识树”功能，
> 展示章节、小节、原子知识点，以及重要度和真实考频。

## 权威数据

唯一权威知识树与频率模型（根目录，不维护副本）：

- `data/408/knowledge-tree-408-v2.json`（Knowledge Tree）
- `data/408/frequency-model-v2.json`（Frequency Model）

章节/小节与原子点统计文件：

- `data/408/knowledge-catalog/chapter-section-stats-2022-2026.json`
- `data/408/knowledge-catalog/atomic-stats-2022-2026.json`
- `data/408/knowledge-catalog/hotspots-2022-2026.json`

当前 V2：
- 4 科
- 24 章
- 119 小节
- 1149 原子知识点

章节/小节统计（2022–2026）覆盖全部 24 章 + 119 小节，ID 与 V2 树完全对齐。

四科代码：
- DS：数据结构
- CO：计算机组成原理
- OS：操作系统
- CN：计算机网络

## 文件说明

### data/408/knowledge-tree-408-v2.json（唯一权威知识树）
层级：
subject → chapter → section → atomicPoint

主要字段：
- id
- nodeType
- subject
- name
- parentId
- order
- importance
- estimatedFrequency
- difficulty
- prerequisites
- relatedPoints
- tags

### data/408/frequency-model-v2.json（唯一权威频率模型）
原子知识点真实考频证据：
- recent3Y.frequency：2024–2026
- recent5Y.frequency：2022–2026
- allTimeEvidence.frequency：历史混合证据
- trend.direction
- evidenceConfidence
- recent5Y.primaryScore

注意：
AllTimeEvidence ≠ 全历史逐题原子精确标注。它是“历史 broad evidence + 近 5 年
exact atomic”的混合证据，UI 统一使用“长期考频证据”，禁止写成“历史精确考频”
或“2009–2026 全部逐题精确统计”。

### data/408/knowledge-catalog/chapter-section-stats-2022-2026.json
章节/小节近 5 年（2022–2026）聚合统计：
- relatedQuestionCount（相关题目数量，非独占分值）
- primaryQuestionCount
- primaryScore（近 5 年主考分值）
- yearCount
- avgRelatedQuestionsPerYear
- coverageRate（0–1 小数，展示时 ×100 转百分比）

### data/408/knowledge-catalog/atomic-stats-2022-2026.json
近 5 年原子点统计，用于知识点详情或调试。

### data/408/knowledge-catalog/hotspots-2022-2026.json
四科热点知识点，可用于“高频考点”快速筛选。

## 数据流

```text
V2 Tree → buildKnowledgeTree
Frequency → joinFrequencyEvidence
Chapter/Section Stats → joinChapterSectionStats
最终 Stable DTO → React（catalogData 是唯一允许 import raw JSON 的入口）
```

## UI 第一版（已完成）

1. 四科切换：数据结构 / 组成原理 / 操作系统 / 计算机网络
2. 章节 → 小节 → 原子知识点树（展开/收起、一键展开/收起）
3. 章节统计：近5年主考分值、涉及题数、覆盖年份
4. 小节统计：主考分值、涉及题数
5. 原子知识点：重要度、难度、近3年、近5年、长期考频证据、趋势
6. 搜索、只看高频、只看高重要度
7. 点击原子知识点打开详情 Drawer（含前置知识/相关知识真实名称解析）
8. 移动端 StudentLaunchpad 入口

第一版只读，不做后台 CRUD。

## 非本功能范围

第一版禁止顺手实现：
- UserKnowledgeMastery
- Priority Score
- 今日提分中心
- 错题闭环
- FSRS
- AI 自动生成知识点
- 管理后台编辑知识树

## 已知后续项

- Performance：KnowledgeCatalog 懒加载 chunk 约 1.10 MB（gzip 约 57–58 KB），
  单独作为后续 Performance Task，不做 public JSON fetch / code splitting 重构。
- `data/408/knowledge-catalog/` 下若仍有 `knowledge-tree-408-v2.json` /
  `frequency-model-v2.json` 交接副本，仅作交接存档，生产代码不引用；
  后续可清理（YAGNI，不强制）。

## 快而稳原则

- 先复用现有项目导航、卡片、筛选组件
- 不重构整个 App
- 不创建第二套题库
- 数据解析放独立模块
- UI 不直接理解原始 JSON 的所有字段
- 建一个适配层，把原始数据转成稳定 DTO
- 优先纯函数 + 单元测试
