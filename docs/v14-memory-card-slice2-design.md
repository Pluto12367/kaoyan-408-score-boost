# V14-② 切片二：卡片→做题回流 设计任务书（Design Gate）

> **Status**: DESIGN GATE — 待 Owner 批准，未实施任何代码变更。
> **任务来源**: `docs/v14-memory-card-roadmap.md` §3 首项，Owner 排期指令「3 的『卡片→做题回流』作为第二个功能切片」。
> **任务类别**: `CODE-BEHAVIOR`（零 Schema、零迁移、零新写路径）。
> **规范基线**: `docs/v14-memory-card-design.md`（v1，D1-D6b）+ `docs/v14-memory-card-roadmap.md`。

---

## 1. 只读审计事实（一手，`path:line` 为证）

| 事实 | 证据 |
|---|---|
| 知识抽屉已有一条「节点→选题→练习」的完整链路：抽屉「去练习」按钮 → `onNavigate` → App `handlePracticeQuestionFromCatalog(questionId, title)` → `beginRedo`（既有单题重做机制）→ 跳转题库分区作答 | `apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx:232-241`；`apps/web/src/App.tsx:873-879` |
| `handlePracticeQuestionFromCatalog` 不关心题目来源，只按 questionId 设置练习状态并切分区——记忆卡面可直接复用同一处理器 | `apps/web/src/App.tsx:873-879` |
| 节点选题装载器已存在且**学生视图安全**：`loadRelatedQuestionsForNode`（直标 QuestionKnowledgeNodeTag 优先，桥接 QuestionKnowledgePoint→NodeMap 兜底），select 仅 id/stem/type/difficulty/source/year/expectedTimeSec——**不含 answer/analysis/options/optionAnalyses**，orderBy createdAt asc、take 20、仅 isCurrent | `apps/api/src/score-center/repository.ts:302-330` |
| 该装载器已被生产端点 `GET /knowledge/:id`（`getKnowledgeDetail.relatedQuestions`）消费多年，答案剥离语义已被既有面验证 | `apps/api/src/score-center/service.ts:341-349` |
| 单题作答提交走既有 `POST /practice-records`（CreatePracticeRecordDto），判分后经 `ScoreCenterService.applyAttempts`（canonical 唯一写方）更新掌握度、点燃 ScoreLoss——**本切片零新写路径** | `apps/api/src/study/dto/create-practice-record.dto.ts`；`apps/api/src/score-center/service.ts:126-133`；契约 `docs/development/score-mastery-evidence-semantics.md` §3 |
| 记忆卡工作区按 `visibleSection` 条件渲染，切换分区即卸载（会话状态不跨区保留） | `apps/web/src/features/student/StudentSections.tsx:506-518` |

## 2. 产品问题回答（协议 §2 必答）

本切片把 v1「只安排重现」的卡片面升级为**能产生可观测作答的面**：卡片复习中产生的每次「做题」都是经 canonical 链的 `OBSERVED` 客观作答，自动进入能力层与失分账本。这正是 roadmap 判断「比调调度公式更可能影响提分」的依据。如实声明：它提升的是**证据产量**（OBSERVED attempts），对成绩的影响仍为 `UNAVAILABLE`（RULE-11）。

## 3. 方案设计

### 3.1 数据流

```
翻卡（卡面背面）→ 懒加载 GET /memory-cards/practice-candidate?nodeId=（按节点缓存，一次）
  → 有 SINGLE_CHOICE 候选题：背面下方出现「做一道「{节点名}」的题验证 →」
      → 点击 → App 复用 handlePracticeQuestionFromCatalog(questionId, 题干截断)
      → 既有题库分区作答 → POST /practice-records（既有）→ canonical mastery/ScoreLoss（既有）
  → 无候选（无题/无单选）：入口不渲染（诚实缺省，绝不伪造）
```

### 3.2 后端：一只读候选端点（唯一新增）

```
GET /memory-cards/practice-candidate?nodeId=
→ 200 {
    nodeId,
    candidate: {
      questionId, stem, questionType, difficulty, maxScore|null
    } | null,
    reason: 'ok' | 'no_related_question' | 'no_single_choice'
  }
→ 401 未认证；404 nodeId 不存在或未启用
```

- 实现：`MemoryCardService.getPracticeCandidate(userId, nodeId)` 复用 `loadRelatedQuestionsForNode`，取**首个 `type === 'SINGLE_CHOICE'`**（确定性：createdAt asc 序，不随机、不按对错过滤）；无单选但题库题存在 → `candidate: null, reason: 'no_single_choice'`。
- 挂 `StudyController`，`@Roles('student','teacher','admin')` + resolveUserId 隔离；无库显式 503（同 v1）。
- **答案安全硬卡**：响应 DTO 显式只挑 5 个字段（白名单式组装），契约测试断言响应键集精确等于 `{nodeId,candidate,reason}` 且 candidate 键不含 answer/analysis/options/optionAnalyses。

### 3.3 前端：翻卡面入口

- 翻面后、三档自评按钮下方，渲染文本链接：`做一道「{nodeName}」的题验证 →`。
- 懒加载 + 按 `nodeId` 缓存（同一节点多张卡只取一次）；`candidate=null` 或加载失败→入口不渲染（失败静默降级仅限此增强入口，主复习链路失败仍显式报错——注释注明理由）。
- 点击 → `props.onPracticeCandidate(questionId, stem截断40字)` → App 传入**既有** `handlePracticeQuestionFromCatalog`（零新回调逻辑，零状态新增）。
- 跳转作答后回到记忆卡分区：会话重新组队（既有行为，见 §5 Non-goals）。

### 3.4 语义围栏（钉死项）

1. **作答走 canonical，卡片仍不写能力层**：练习提交是既有 practice 链；卡片域对 `UserKnowledgeMastery`/`ReviewSchedule`/Evidence 的零写入围栏**原样保留**（E2E 负断言延续）。
2. **作答结果不回流卡片排程**（v1）：做对/做错不改变该卡 stabilityDays/nextReviewAt——「客观作答作为卡片质量信号」是新调度语义，属未来独立 Owner 决策，本切片明确不做。
3. 入口是**增强**不是依赖：无题/加载失败时卡片复习功能完整可用。

### 3.5 明确不做（Non-goals）

- ❌ 综合题（大题）不接（自评面不同，未来再说）；
- ❌ 不做「按学生作答历史智能选题」（v1 确定性取第一道单选；智能化属处方域）；
- ❌ 不接处方阶梯/不建 StudyTask/不碰 recommendation priority；
- ❌ 零 Schema/零迁移/零新写路径；跨分区会话保持不做。

## 4. 测试策略（RED 先行）

1. **shared**：无新增纯函数（复用 v1 全套数学）——本切片不加 shared 代码。
2. **E2E**（扩展 `scripts/integration-memory-card.mjs`，真实 PG+HTTP）：
   - seed：nodeA 挂 1 道 SINGLE_CHOICE 题库题（family+question+QuestionKnowledgeNodeTag）；
   - `practice-candidate?nodeId=nodeA` → 200，candidate.questionId=该题，**响应键集白名单断言（无 answer/analysis/options/optionAnalyses）**；
   - `practice-candidate?nodeId=nodeB` → 200 + `candidate:null, reason:'no_related_question'`；
   - 未知节点 → 404；未认证 → 401；
   - 端到端闭环：用候选 questionId 走既有 `POST /practice-records` 判分 → 断言 PracticeRecord 落库 + **该节点 canonical mastery 行出现**（写方=ScoreCenterService，证明回流进能力层）+ 记忆卡三表行数不变（卡片域围栏延续）。
3. **前端源码契约**（`test/memory-card-ui-contract.test.js` 追加）：入口文案与渲染条件（candidate 非空才渲染）、`onPracticeCandidate` 接线到 App 既有处理器、缓存 Map 存在、失败静默仅限入口。

## 5. 里程碑（PROXY 估时）

| 里程碑 | 内容 | 估时 |
|---|---|---|
| S2-M1 | 后端候选端点 + E2E 扩展（RED→GREEN） | 2–3h |
| S2-M2 | 前端入口 + 接线 + 源码契约 + 全门禁 | 2–3h |

## 6. Owner Decision 清单

| # | 决策 | 建议 |
|---|---|---|
| D-S2-1 | 入口位置：翻面后自评按钮下方文本链接（不与三档自评争优先级） | 按建议 |
| D-S2-2 | 选题规则：该节点首个 SINGLE_CHOICE（createdAt asc 确定性），无单选诚实缺省 | 按建议 |
| D-S2-3 | **作答结果不回流卡片排程**（v1 冻结；未来如要「做错→卡提前重现」须独立 Owner Gate） | 按建议（确认冻结） |

## 7. 开源参考检查

检索（2026-09-26）：Anki/Quizlet 等主流卡片工具**均不原生打通卡→题库**（[QuizMed 对比](https://quizmed.com)、[Quizlet](https://apps.apple.com) 均为「学生自行配对卡片与题库」模式），无现成实现可抄——本切片是差异化能力。**最强先例在仓库内**：知识抽屉「去练习」的节点→题→练习链（本切片整体复用该链，零模式创新）。实现方式：不复制任何外部代码，全部复用本仓既有装载器、练习链与 canonical 写方。

---

**STOP. Awaiting implementation approval.**（D-S2-1/2/3 批准后按 S2-M1→M2 实施；零迁移零语义变更，完工后走全门禁。）
