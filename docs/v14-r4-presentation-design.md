# V14-R4 呈现层任务书（作战板 / 真题套卷 / 数据屏）

> 性质：**任务书（Design Gate 材料）**。Owner 批准后按 R4-A → R4-B → R4-C 实施。
> 前置：R1 迁移 40（Question.examNo/optionAnalyses）、R2 陷阱呈现、R3 五年真题入库（235 题 READY）均已完成。
> 竞品基准：CodeBrick 实测（docs/audit/codebrick-benchmark-2026-09-25.md）——作战板/套卷/数据屏的学生价值已验证。
> 边界：零 schema 变更（数据全部就绪）；语义零变更（所有新端点为只读投影，RULE-08）。

---

## 1. 目标

把 R1-R3 沉淀的真题资产变成学生可感知的三个呈现面（对标 CodeBrick 实测形态）：

| 面 | 内容 | 数据源 |
|---|---|---|
| 作战板 | 按年 47 格网格（40 选择+7 综合），按学生作答状态着色（全对/答错/未做），各科分值、首考/回归考点侧栏 | Question(examNo) × PracticeRecord + ExamQuestion 层 |
| 真题套卷 | 18 年套卷列表 → 一键组卷 → 走既有整卷作答/报告链（150 分制） | 真题 Question + 既有 Paper 链路 |
| 数据屏 | 真题大盘（总量/覆盖/高频 TOP）、考频地图（四级）、大纲漏网清单 | KnowledgeFrequencySnapshot + ExamQuestionKnowledgeTag + KnowledgeNode 目录 |

## 2. 只读审计结论（一手事实，2026-09-25）

1. **前端架构**：SPA 分区制——`RoleNavigation.tsx:24-44` 定义学生导航 6 项（dashboard/question/knowledge-catalog/wrong-book/test/ai）；`StudentSections.tsx` 按 section 分发组件；新增分区 = RoleSection 类型 + 导航项 + 分发 case（`studentCompatSections` 同步）。无路由库。
2. **套卷链路**：`POST /exam/papers/prepare` 现契约 `{paperType:'模拟卷'|'专项卷', subject?, questionCount}`（`exam.ts:5-9`）——**不含年份维度**，需 additive 扩展。
3. **数据就绪**（dev 库实测）：真题 235 题（5 年，全定价/200 题带陷阱）；`ExamPaper` 2022-2026 + `ExamQuestionKnowledgeTag`（每年 ~150 条原子标签）；`KnowledgeFrequencySnapshot` 1296 节点（recent3/5/allTime 频次 + 分值 + 趋势）；`KnowledgeNode` 目录 1296 节点全量。
4. **既有读端点**（复用而非重建）：`/exam/score-history`（套卷成绩历史）、`/exam/report/:sessionId`（报告）、`/coach/*` 家族（self-only 只读投影的既定模式）。
5. **作答状态推导**：PracticeRecord 按 (userId, questionId) 存在且 correct 判定；多题同练的「最新一次」口径需在端点内固定（见 §3.1）。

## 3. 三大呈现面设计

### 3.1 R4-A 作战板（先实施）

**端点**（coach 家族，self-only，只读，沿用既有 coach 模式）：

```
GET /coach/real-exam-board?year=2022..2026
→ {
    year, storeAvailable,
    slots: [{ examNo, questionId, subject, questionSubtype, maxScore,
              status: 'correct' | 'wrong' | 'unanswered' | null }],   // null=题库无此题（诚实缺席）
    summary: { total, answeredCount, correctCount, wrongCount, totalScore },
    novelKps:  [{ knowledgeNodeId, name }],   // 该年首考考点（全历史首次出现）
    returningKps: [{ knowledgeNodeId, name, lastYear }],  // 沉寂≥2 年后回归
  }
```

- **状态口径（钉死）**：取该生对该题**最新一次** PracticeRecord 的 correct；无记录 = unanswered；题库无该题 = null（RULE-06：不伪造）。
- **首考/回归**：由 ExamPaper(年) × ExamQuestionKnowledgeTag 全历史聚合（node 的最早出现年 = 首考；上一出现年 ≤ 当前年−3 = 回归）。纯只读聚合。

**前端**：新增学生分区「真题」（D-R4-1）内首个标签页：年份选择器（2022-2026 起，随导入扩展）+ 47 格网格（格子=科目缩写+分值，着色=状态）+ 右侧首考/回归考点清单；格子点击跳转该题练习面（复用既有题库入口）。

### 3.2 R4-B 真题套卷

**端点扩展**（additive，向后兼容）：

```
POST /exam/papers/prepare  新增可选字段 year?: number
  语义：year 提供时，按该年真题组卷（40 选择+7 综合，题目直接取 Question(year, examNo)），
  paperType 仍必填（'模拟卷'）；year 缺省时行为逐字节不变。
```

- 组卷走既有 Paper 快照/会话/提交/报告链，**零新写语义**；卷面分 = ΣmaxScore（150 分制，exam_total 量纲已由 S1 定标）。
- 前端：套卷标签页 = 年份卡片列表（18 年，未入库年份显式「未收录」）→ 一键组卷 → 跳既有会话作答流。
- 成绩记录与失分账本：与既有模考同链（ScoreLoss coverage>0 已由 R3 点燃），**不新建任何成绩口径**。

### 3.3 R4-A 同批交付的数据屏（只读，无个人维度）

```
GET /coach/real-exam-dashboard
→ { years: [{year, count}], totalQuestions, knowledgePointsTested, knowledgePointsTotal, coveragePct,
    topKps: [{ knowledgeNodeId, name, score5y, allTime, yearsTested }] (TOP 15 按累计分值) }

GET /coach/real-exam-frequency?subject=
→ { levels: { high: n, mid: n, low: n, cold: n },   // 按考过年数：≥10/5-9/2-4/≤1
    rows: [{ knowledgeNodeId, name, yearsTested, totalScore, lastYear }] }

GET /coach/real-exam-uncovered
→ { nodes: [{ knowledgeNodeId, name, subject, chapter }] }   // 1296 节点中从未被真题考察的
```

- 数据源：ExamQuestionKnowledgeTag × ExamPaper（考试事实）+ KnowledgeFrequencySnapshot（分值/趋势）+ KnowledgeNode（目录全集）。
- 前端：数据屏标签页 = 大盘卡片区 + 考频四级表格（科目筛选）+ 漏网清单（可折叠）。
- 可见角色（D-R4-2）：三个屏均为**公共统计**（无个人作答数据），建议学生/教师/管理员可见。

## 4. 分阶段实施

```
R4-A（批准后第一批）：作战板端点+前端「真题」区、数据屏三端点+标签页、
                      契约测试 + E2E 扩展 + build 三端。只读，风险低。
R4-B（第二批）：     prepare 套卷 year 扩展 + 套卷列表页 + E2E（组卷→作答→报告 150 分核对）。
R4-C（后续增强）：   章节命题图谱（26 章×年分值折线）、命题轨迹（高频近 3 年沉默）、难题榜。
```

## 5. 验证门禁（每批）

- 契约测试：端点响应结构、状态推导口径（最新一次作答）、null 诚实缺席、首考/回归判定规则。
- E2E（真实 PG+HTTP，扩展 `integration-real-exam-import.mjs`）：学生作答部分真题 → 作战板状态逐格断言（答错/全对/未做/null）→ 数据屏计数与 dev 库一致 → 401 守卫 → R4-B 组卷→提交→报告 150 分。
- `npm test` 零回归、build 三端 exit 0、`npm run audit:real-exam-content` 不受影响。

## 6. Owner 决策点（RULE-14）

| # | 决策 | 建议 |
|---|---|---|
| D-R4-1 | 学生导航形态：新增独立分区「真题」（6→7 项）还是挂进现有「题库」 | 新增独立分区（三面同源、导航一次到位） |
| D-R4-2 | 数据屏可见角色 | 学生/教师/管理员均可读（公共统计，无个人维度） |
| D-R4-3 | 套卷成绩口径 | 走既有整卷链路（150 分制 exam_total + 失分账本），不新建口径 |
| D-R4-4 | 作战板「首考/回归考点」是否进 R4-A | 进（数据可算、学生价值高；判定规则钉死在契约测试里） |

**STOP 条件**：D-R4-1~D-R4-4 未决则停留 Design Gate（BLOCKED 合法终态）；批准后按 R4-A 起实施。

## 7. 边界

- 不改任何既有端点语义（prepare 仅 additive 可选字段）；不动 Mastery/推荐/ScoreLoss 语义；零 schema 迁移。
- 陷阱完整呈现（含「其他选项为什么错」的整卷报告版）不在 R4 范围（既有单题作答面已覆盖主路径，报告版属 R4-C 增强）。
- 年份覆盖随内容扩展（当前 5 年；2009-2021 待映射补制后自动纳入作战板年份选择器）。

---

*起草：ZCode 只读会话 2026-09-25。基准 HEAD 含 R3 交付（235 题真题 + 迁移 40 + 陷阱呈现）。*
