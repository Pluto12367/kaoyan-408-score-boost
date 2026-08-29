我要在当前考研408系统中新增一个功能：

# 408 知识点目录 / 四科知识树

本轮先不要写代码，先做只读审计和实现设计。

## 你必须先阅读

1. `README-KNOWLEDGE-CATALOG.md`
2. `data/408/knowledge-catalog/knowledge-tree-408-v2.json`
3. `data/408/knowledge-catalog/frequency-model-v2.json`
4. `data/408/knowledge-catalog/chapter-section-stats-2022-2026.json`
5. 当前项目：
   - package.json / workspaces
   - apps/web
   - apps/api
   - packages/shared
   - prisma/schema.prisma
   - 当前知识点/学习地图/导航相关代码
   - 当前 UI 组件和样式体系

## 数据约束

`knowledge-tree-408-v2.json` 是本功能的唯一权威知识树。

层级：

subject
→ chapter
→ section
→ atomicPoint

四科：

- DS = 数据结构
- CO = 计算机组成原理
- OS = 操作系统
- CN = 计算机网络

不要使用旧版 V1 知识树覆盖 V2。

### 频率语义

原子点：

- Recent3Y = 2024–2026
- Recent5Y = 2022–2026
- AllTimeEvidence = 历史混合证据
- Trend = rising / stable / falling / cold

注意：

AllTimeEvidence 不是所有 2009–2026 真题逐题原子精标后的精确次数，
UI 文案应写“长期考频证据”或“All Time Evidence”，不要写成虚假的“历史精确考频”。

## 第一版功能范围

新增一个学生可访问的“408知识图谱/知识点目录”页面。

需要：

1. 四科 Tab：
   - 数据结构
   - 计算机组成原理
   - 操作系统
   - 计算机网络

2. 树结构：
   - 章节
   - 小节
   - 原子知识点

3. 展示：
   - 章节名称
   - 小节名称
   - 知识点名称
   - importance 1~5
   - difficulty 1~5（可以弱展示）
   - Recent3Y
   - Recent5Y
   - All Time Evidence
   - trend

4. 交互：
   - 展开/收起章节
   - 搜索知识点
   - 只看高频
   - 只看重要度 >= 4
   - 一键展开/收起
   - 显示当前科目的章节数、小节数、原子知识点数

5. 详情：
   点击原子知识点后展示侧栏/Drawer：
   - 所属科目
   - 章节
   - 小节
   - importance
   - difficulty
   - Recent3Y / Recent5Y / AllTimeEvidence
   - trend
   - prerequisites
   - relatedPoints

第一版只读，不做 CRUD。

## 架构要求

优先使用：

`data JSON`
→ 数据适配层
→ stable DTO
→ 页面组件

不要让 React 页面直接到处解析原始 JSON。

建议纯函数：

- buildKnowledgeTree()
- joinFrequencyEvidence()
- filterKnowledgeTree()
- searchKnowledgeTree()
- summarizeSubject()

具体名称可以根据项目现有规范调整。

如果项目当前已经有 KnowledgePoint / mastery-map / 学习地图页面，
优先复用现有组件和导航方式，不要平行重造一套完全不同 UI。

## 本轮禁止

- 不实现 Priority Score
- 不实现 UserKnowledgeMastery
- 不实现今日提分中心
- 不实现错题系统
- 不修改历史题库业务
- 不做数据库迁移，除非只读审计证明纯 JSON 方案无法满足当前功能
- 不重构整个 App.tsx
- 不 commit

## 快而稳

第一版推荐优先使用静态 JSON + shared/web adapter，
因为该功能目前是全局只读知识目录。

除非你发现项目已有数据库 KnowledgePoint 页面强依赖后端，
否则不要为了展示目录提前引入数据库复杂度。

## 现在只输出

1. 当前项目里最适合挂载这个页面的位置
2. 当前是否已经有相似“知识点/学习地图”功能，可以复用哪些
3. 建议：
   - A. 前端静态 JSON
   - B. 后端 API
   - C. 数据库
   三种方案的取舍
4. 推荐方案
5. 推荐后的实际文件结构
6. 每个文件职责
7. 数据 DTO 设计
8. 页面布局
9. 最小测试计划
10. Task 1 / Task 2 / Task 3 的拆分
11. 哪些文件预计会修改
12. 风险
13. 完成第一版的验收标准

完成后停止，不修改任何文件。
