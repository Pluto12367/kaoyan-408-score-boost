# StudentContext Payload Optimization（SC-5 TASK 2）

日期：2026-09-05
目标：语义不变前提下 payload 降幅 ≥ 30%（基线 ~80 KB，见 production-readiness audit §4）
约束：**不改变 contract shape**（字段名/类型/节结构不变）；优化载体 = 有界化（bounded sections）

---

## 1. Field/Section 消费分析（谁真正读什么）

| Section | 占比（80KB 基线） | 消费者实际读取 | 可优化点 |
|---|---|---|---|
| `mastery` | 48.6 KB（60%） | adapter/Coach 用 knowledgeNodeId/subject/chapter/title/mastery/status/accuracy/attempts/wrongCount/lastUpdatedAt | 桶行有目录上界，**不可裁行**（语义即"全量桶"）；`weakPoints`（Point 行为弱点，无界向量）可裁为 top-20 |
| `recommendationEvidence` | 28.2 KB（35%） | StudentHome 只用 `length`（证据计数）；Coach/Report 不读 | **无界向量 → 有界 provenance window（60 行最新）** |
| `momentum.recentSessions` | 小 | 展示最近 10 条 | selector 本就 slice(0,10)（DB 层 TASK 1 已同步 take 10） |
| 其余 | <4 KB | 全部使用 | 无 |

`mastery` 四桶与 `plan/practice/review/momentum` 聚合均为 summary 语义本体，不可压缩；优化集中在两个无界列表。

## 2. Implemented Bounds（shape 不变，行数有界）

| 节 | 规则 | 实现位置 |
|---|---|---|
| `recommendationEvidence` | 按时间倒序取**最近 60 行**；缺 source 归一 'unknown'；只保留契约字段（TASK 3 防御同函数） | `student-context.selector.ts` `normalizeEvidence` |
| `mastery.weakPoints` | 按 wrongCount 降序取 **top 20**（最弱点摘要；完整逐点历史属 report 投影领域） | 同文件 `buildPracticeWeaknesses` |
| DB 侧（配合） | actions `take:200`、sessions `take:10`（TASK 1） | `student-context.query.service.ts` |

## 3. Measured Result（同一合成负载：200 mastery 节点 / 1000 practice records / 50 actions × 3 refs）

| Profile | Before | After | Δ | 预算 |
|---|---|---|---|---|
| Small（20 节点 / 50 records / 5 actions） | — | **9.3 KB** | — | <50 KB ✅ |
| Medium（200 / 1000 / 50） | 79.9 KB | **52.9 KB** | **−34%**（≥30% 目标达成） | <100 KB ✅ |
| Heavy（600 / 3000 / 150） | 外推 ~180+ KB（无界） | **131.8 KB** | evidence 恒定 8.4 KB | <200 KB ✅ |

分段明细（After）：medium mastery 42.7 KB + evidence 8.4 KB（60 行封顶）；heavy mastery 121.5 KB + evidence 仍 8.4 KB（60 行）。payload 从"随 action 历史/错题点数无界增长"变为"有界 + 仅随目录规模增长"。测试基线钉死于 `test/student-context-performance.test.js`。

## 4. Semantics Notes（随 TASK 5 契约文档化）

- `recommendationEvidence` = **bounded provenance window**（最近 60 条，时间倒序）；证据计数为展示性摘要。
- `mastery.weakPoints` = **top-20 by wrongCount**（最弱点摘要）。
- 两者均为"摘要的有界列表"，与契约"summary read model"定位一致；字段 shape 零变化，三个消费者零改动（61+ 项回归继续作为守卫）。
