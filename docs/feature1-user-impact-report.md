# Feature 1 真题对标练习模式 — Phase 4 User Impact Report

> 状态：M1-M4 COMPLETE（本地提交 `cd0f953` + `a1178ad`，未推送）；M5 集成脚本与真实库验证待执行（见 §6）。
> 日期：2026-09-07。Track：LE-V10。

---

## 1. Before / After

### Before（学生以前如何学习）
1. 系统推荐一组题，卡片上只有一句话："优先覆盖 X，当前正确率 Y%"——**为什么是这些题**不可见。
2. 学生按部就班刷题，不知道练的知识点在真题里出现多频繁、值多少分。
3. 练完后看到正确率，但不知道"这次练的内容在真题版图里覆盖了多少"。
4. 时间紧的学生（15/30 分钟）无法判断快速会话与真题的关联度。

### After（学生现在如何学习）
1. 打开"**真题强化**"开关：题组按**真题考频 × 掌握缺口**重排，最值得练的题排最前。
2. 每道题（前 3 题预览 + 可展开的逐题理由卡）显示：
   - ★ 星级高频标签（★★★★★ 高频考点 / ★★★★ 常考 / ★★★ 偶考）
   - 近 5 年出现次数、最近出现年份
   - 当前掌握度（未练过显示"尚未练习"，绝不显示 0%）
   - **预计收益：约 N 分（估算，公式可展开）**——LOW 置信数据自动隐藏此行
   - 关联真题：`2025 数据结构 第8题 / 2024 第10题…`
3. 集卡标题旁的徽标："真题强化 · 覆盖 N 个真题知识点"。
4. 训练完成后：**真题覆盖报告**——覆盖知识点清单（带星级）、覆盖年份跨度、高频繁点数量。

## 提分价值（对应六项指标）
| 指标 | 作用机制 |
|---|---|
| **学习方向准确率（M1 主指标）** | 薄弱×高频的排序让"练什么"的决策质量可感知、可校验 |
| **高频考点覆盖率（M2 主指标）** | 覆盖报告让学生看见自己真题版图的盲区（覆盖 N 个 → 目标全目录 ★≥3 节点） |
| 单位学习时间收益（M6） | 考频排序 = 单位时间的期望分值密度提升；`predictedGain = primaryScore5y × (1−mastery) × 0.6` 保守估算 |
| 知识保持（M3）/ 大题（M4）/ 模考恢复（M5） | 间接（高频优先即遗忘前加固；大题考点与模考暴露点同入对标）——直接兑现由 F2-F4 承担 |

## 技术价值（面试可展示点）
1. **Explainable Recommendation**：每个展示数字携带 `evidence{source table, nodeId}` 与 `gainFormula`——"白盒推荐"完整落地，测试钉死"估算必须带标记、缺失必须缺席"。
2. **插件式排序投影**：不修改生产推荐引擎（shared 零 diff，源码断言），以 Selector/Projection 在题目层叠加排序策略——"给运行中的系统加能力而不动核心"的架构案例。
3. **同源阈值防漂移**：selector 星级阈值与引擎 `HIGH_RECENT_FREQUENCY`（recent3≥4）用**读 shared 源码的测试**锁死同步。
4. **工程克制**：0 migration、普通模式字节级一致、诚实缺席（null ≠ 伪造 0）。

---

## 2. 全部修改文件（M1-M4 汇总）

**后端**：`exam-alignment.selector.ts`（新，纯函数投影+排序）、`exam-alignment.service.ts`（新，只读装载，复用 score-center 五个既有导出 loader）、`study.service.ts`（mode 参 + 收口 + recentPracticeRefs + 构造器末位 @Optional）、`study.module.ts`（2 行）、`study.controller.ts`（mode Query 2 行）。
**前端**：`features/practice/exam-aligned/`（vm + ReasonCard + CoverageSummary + css，新）、`PracticePanel.tsx`（开关/徽标/逐题理由/覆盖报告挂载）、`StudentSections.tsx`（prop 转发 2 行）、`App.tsx`（接线 1 行）、`api/types.ts`（对齐类型）、`api/endpoints/dashboard.ts` + `hooks/useStudentLearningData.ts`（mode 透传）。
**文档**：roadmap §0/§0.1（四问门禁+六指标契约）、Plan、M1/M2 Report、本报告、DESIGN.md（真题对标组件条目）、账本。

## 3. 数据变化 / API 变化

- **数据**：零迁移、零新表、零写入（全只读投影；练习提交仍走既有唯一写方）。
- **API**：`GET /practice-sets/recommended` 增可选 `mode` Query 与可选 `examAlignment` 响应段（无 mode 时响应与现网逐字段一致——测试钉死）；无其他端点变化。

## 4. 测试结果

| 套件 | 结果 |
|---|---|
| `test/exam-alignment.test.js`（M1/M2 后端） | 20/20 |
| `test/exam-aligned-ui.test.js`（M3/M4 前端 vm+契约） | 6/6 |
| 全量 `npm test` | **1991 / 1989 pass / 0 fail / 2 skipped** |
| `build:api` / `build:web` | PASS / PASS |

过程中抓到并修复的真实问题：①摘要年份被展示上限截断丢年（M1）；②内存 PracticeRecord 时间字段误用 createdAt（M2，parity 测试经 ts-node 直载暴露）；③prop 需经 StudentSections 中转（M3，tsc 暴露）。三类测试层次各司其职。

## 5. Acceptance Checklist（对照 Plan §11）

- [x] 每道推荐题有理由（星级/频次/最近年份/掌握度）——预览行 + 可展开逐题卡
- [x] 理由可追溯（evidence 源表 + 原始值 + 公式）
- [x] 高频标签与库内 `KnowledgeFrequencySnapshot` 一致（M1 单测以 fixture 锁映射；M5 集成对库断言）
- [x] 掌握度正确且"尚未练习"≠ 0%
- [x] 所有估算收益带"估算"标记
- [x] 覆盖报告（知识点/年份/高频繁点）训练后可见
- [x] 非 exam_aligned 路径与现网逐字段一致
- [x] 全量测试零新增失败；build 双端 PASS
- [ ] **M5 待执行**：`scripts/integration-exam-aligned.mjs` 真实测试库断言（frequency 值取自库内种子）+ dev 栈四主题目检

## 6. 待办与下一阶段

1. **M5（F1 收尾）**：集成脚本 + dev 栈目检 → F1 整体关闭。
2. **F2 模考诊断增强（下一 Feature）**：按 §0 四问/六指标，含新并入的**缺口闭环率**（StudyTaskCompletion 派生，零迁移）。
3. 指标 M1/M2 的生产观测：F1 上线后从 UserEvent/practice 投影周报聚合（与 #48 站内提醒中心的报表共用基建）。
