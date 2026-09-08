# Product Evolution Report — Feature 2 全真模考诊断增强（后端闭环）

> 格式：LE-V10 长期研发 §八 阶段报告。日期：2026-09-08。
> 状态：后端 COMPLETE（本地提交，未推送）；诊断前端视图为下一 Milestone。
> 上游：`docs/feature2-exam-diagnosis-plan.md` + Roadmap §0 四问/六指标。

---

## 1. 学生问题

模考后只知道"答对多少"——不知道**为什么错、丢在哪些知识点、和目标差多少、恢复计划执行了没有**。模考暴露的缺口不转化为修复动作，同样的失分就在真实考场重演。

## 2. Before / After

**Before**：`GET /exam/report` = 成绩单（总数/正确率/分科正确率/主观题自评分/失分考点 Top10——按考点计数、无考频、无分值口径）。

**After**：`GET /exam/diagnosis/:sessionId` = 诊断书——
- **score150Estimate**：150 分制估算分（客观题正确率 × 408 标准结构 80 分 + 主观题真实自评分，自评超上限自动截断；basis 字段永远附带给"估算/80 分结构/自评"三重声明，confidence=medium）。
- **perSubject**：逐科目客观题口径估算得分（题数×2 分标准，scopeNote 明示主观题自评分只计入汇总行）。
- **nodeLoss**：失分题归因到知识节点，按 lostCount×考频排序取 Top5，每行带 ★ 星级（阈值与引擎同源逻辑）——"死锁丢了 3 题、近 5 年考 5 次"一望即知。
- **gapDecomposition**：目标分 − 估算分 = 差距（无目标分 → 整段 null，绝不伪造基线）。
- **recoveryClosure**：**缺口闭环率**——恢复任务（确定性 id `exam-review-{sessionId}-day-N`）的存在数与 `StudyTaskCompletion` 完成数对比；计划未生成 → null + `recovery_plan_not_generated` 显式原因。

## 3. 产品价值（六项指标）

| 指标 | 影响 |
|---|---|
| **模考恢复效率（M5 主指标）** | ✅ 直接落地：closureRate 从"生成了计划"深化为"缺口闭环率"，每次模考自动输出 |
| 大题采分能力（M4） | 先导：主观题自评分独立聚合标注（逐点版随 F4 rubric） |
| 学习方向准确率（M1）/ 高频考点覆盖率（M2） | 失分节点按考频排序 = 下一轮练习的输入（与 F1 同一投影语言） |
| 知识保持率（M3） | 间接（失分节点回流复习队列） |

## 4. 技术价值

- **架构**：新端点 `GET /exam/diagnosis/:sessionId`（只读、self-only、ownership 经既有 getExamReport 内部校验）；`ExamDiagnosisService` 注入 StudyService（单向依赖，零循环）；getExamReport 响应**纯增量**附加 `lostQuestionIds`（既有字段零改动）；shared/引擎/写路径零触碰。
- **数据流**：report（内存+SoT）→ 失分题 →(score-center loader 节点解析)→ 节点归因 →(频次 loader)→ 考频富化 → 纯投影；恢复闭环 ← 确定性任务 id 反查 StudyTask/StudyTaskCompletion。
- **诚实设计**：估算分三重声明（估算/结构/自评）+ 置信字段；无法归因的失分题**计数呈现**（nodeLossUnmappedCount）而非静默丢弃；自评超上限截断。
- **面试点**："成绩单→诊断书"的投影演进；确定性 id 反查闭环率的无迁移设计；估算分口径的诚实标注体系。

## 5. 验证

| 套件 | 结果 |
|---|---|
| `test/exam-diagnosis.test.js`（纯投影 9 项 + 接线 1 项） | **10/10**（先 RED 9/9） |
| 全量 `npm test` | **2001 / 1999 pass / 0 fail / 2 skipped**（1991 基线 + 10，零新增失败） |
| `build:api` | PASS（修复：readonly 索引赋值、类型缺导入——tsc 门禁捕获） |

## 6. 遗留与下一阶段

1. **诊断前端视图**（下一 Milestone）：报告页"诊断"tab 消费本端点（150 仪表/分科行/失分节点/闭环率卡）。
2. **集成冒烟**：诊断端点与 exam report 同链（ownership 与数据源一致），HTTP 级冒烟并入下次部署前检查。
3. **F3 影子评估器**（队列下一项）：旧算法保持率指标纯模块——`ReviewAttempt.nextIntervalDays` 数据持续积累中。
4. **F4 content-blocked**：rubric 内容批次前置。
