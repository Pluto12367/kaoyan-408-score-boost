# V11 Architecture Final — 架构冻结文档

> 状态：V11 Release Consolidation RC-3 产出。日期：2026-09-09。
> 范围：V11 全部已交付能力（M1 数据质量 / M2 学习证据 / M3 推荐诚实化 / M4 影响度量）+ 继承的 LE/V10 资产的边界说明。
> 纪律：本文档描述"是什么"，以代码为准；变更须同步更新。

---

## 1. Source of Truth（事实源，冻结）

### 学生事实（写路径唯一性）

| 表 | 写入方 | 幂等/并发机制 |
|---|---|---|
| `PracticeRecord` | `StudyService`（单题/会话/测评三路径） | `Idempotency-Key` 强制；会话 revision 乐观锁 |
| `AnswerReceipt` | 单题提交回执 | idempotencyKey+requestHash |
| `UserKnowledgeMastery` | **唯一写方 `ScoreCenterService.applyAttempts/applyReview`**（5 写点全收敛） | OCC version 字段，≤3 次退避 |
| `UserMasterySnapshot` | 掌握度写路径内联（每日一行） | (user,node,date) |
| `WrongQuestionReview` / `ReviewSchedule` / `ReviewAttempt` | 错因上报/复习事务（applyReview 仅 isReview=true） | (user,question) 唯一；attempt 幂等键 |
| `StudyPlan` / `StudyTask` / `StudyTaskCompletion` | OnboardingPlanRepository（advisory lock）+ generationKey 幂等 | (user,task,date) 完成唯一 |
| `RecommendationAction` | RecommendationActionAdapterService | creationKey 幂等 |
| `UserEvent` | CanonicalEventWriter + telemetry allowlist | eventKey 唯一 |

### 内容事实

`Question`(+`QuestionKnowledgeNodeTag` 节点标签) · `KnowledgeNode`/`KnowledgeRelation`(33 前置/21 关联，稀疏=内容债) · `KnowledgeFrequencySnapshot`(考频，1149/1296 节点) · `KnowledgePoint`+`KnowledgePointNodeMap`(PRIMARY 桥接) · `ExamPaper`/`ExamQuestion`/`ExamQuestionKnowledgeTag`(真题原子标签) · `KnowledgeNodeQuest`。

### 可丢弃运营状态（RuntimeState KV，非事实源）

`questionReviewItems`(审核队列) · `coach-session:{userId}`(对话压缩) · `sprite-memory:{userId}`(V10-4 陈述偏好) · sprite 弹泡额度（前端 localStorage）。

**红线**：任何新能力不得为上述表建立第二写入方；mastery 公式/引擎排序变更 = 暂停条件。

---

## 2. Projection Layer（只读派生层，51+ 投影）

共性纪律：纯函数可沙箱测、零 IO 装载分离、诚实缺席（null ≠ 0、insufficient_data 贯穿）、证据可溯源（evidenceRefs/payload 源表）。

| 投影 | 端点 | 回答的问题 |
|---|---|---|
| StudentContext v1 | `GET /student-context` | 学生现在整体什么水平 |
| **exam-alignment**（F1） | `GET /practice-sets/recommended?mode=exam_aligned` | 为什么练这道题（星级/考频/掌握度/估算收益/关联真题） |
| **exam-diagnosis**（F2） | `GET /exam/diagnosis/:sessionId` | 这次模考丢在哪（150 估算/分科/节点失分×考频/目标差距/闭环率） |
| task-evidence（V11-M2） | `GET /coach/task-evidence` | 完成的任务带来了什么能力变化 |
| **mastery-calibration**（V11-M4.2） | `GET /coach/mastery-calibration` | 存储掌握度与真实做题表现差多少（校准影子） |
| **outcome-tracking**（V11-M4.3） | `GET /coach/outcome-tracking` | 近期推荐是否见效（前后 14 天对照） |
| decay-defense selector（V11-M4，纯） | —（推荐层接入待设计） | 哪些已掌握节点正在遗忘 |
| daily-brief / progress-narrative / proactive（V9） | 既有 | 教练叙述层 |
| review-shadow（F3 M1） | `GET /coach/review-shadow`（teacher/admin） | 旧调度器的观测保持率基线 |
| admin-data-quality（V11-M1） | `GET /admin/data-quality`（admin） | 数据缺口清单（B4/B6/B13） |

---

## 3. Recommendation Flow（推荐流）

```
全部活跃原子节点 (1296, loadEvidenceNodes)
        ↓
有快照 → 真实考频证据 (buildEvidence)          无快照 → 中性证据 (V11-M3, LOW 置信)
        ↓                                                        ↓
calculatePriority（排序公式，冻结）
  考频 0.38/0.30/0.16/0.10/0.06 + 掌握度 + 遗忘 + 前置 + 考试临近
        ↓
9 个 reasonCodes（HIGH_RECENT_FREQUENCY 等）→ composeDailyPlan（预算/配额/前置替换）
        ↓
StudyPlan/StudyTask（generationKey 幂等）→ reasonCodes 随任务下发
        ↓
F1 排序投影（mode=exam_aligned：题目层按考频×缺口重排 + 对齐理由卡）
```

**诚实化语义**（V11-M3）：无快照节点以中性证据进入候选（不再静默排除）——排序公式未变，缺考频即无考频加成；缺口规模由 `/admin/data-quality` 观测。

---

## 4. Evidence Flow（证据流）

```
学生行为（练习/复习/任务完成/模考）
   ↓ 幂等入口（Idempotency-Key / AnswerReceipt / generationKey）
事实表（§1）
   ↓ 掌握度写（EMA+OCC，唯一写方）
UserKnowledgeMastery + 每日 UserMasterySnapshot
   ↓ 派生投影
├─ 校准（V11-M4.2）：存储掌握度 vs 真实正确率，±15pt 方向 + 置信度
├─ 保持（V11-M4.1/M4.3）：FSRS R(t,S) 预测 + 干预前后对照 + 闭环率
└─ 遗忘防线（selector 已就绪；推荐层接入待设计）
   ↓ 全部只读端点（/coach/*, /admin/data-quality）
学生/教师/管理端
```

## 5. Experimental Model Boundary（实验模型边界）

- **FSRS-4.5 预测器**（`fsrs-scheduler.ts`，纯函数）：公开未训练默认权重，显式标注 UNTRAINED；数学性质测试（R(0,S)=1、t/S 单调、I(r,S) 精确逆、clamp 边界）。
- **影子对照协议**：review-shadow 观测基线（已上线）↔ FSRS 预测（结构就绪）；**预注册切换阈值 = 7 日保持率差 ≥5 个百分点且样本 ≥30**，达标前不迁移；切换由人在环批准。
- **LLM 边界**：DeepSeek 已在生产解锁（实测 mode=llm）；所有智能输出走既有安全闸（agent-guard/LOW_EVIDENCE 诚实标注）；LLM 评分/提取不在 V11 范围。
- **校准边界**：mastery-calibration 只产建议方向（raise/lower/hold），绝不自动写 UserKnowledgeMastery。

## 6. Future Extension Points（扩展点，按优先序）

1. **保温复习推荐层接入**（decay-defense → 推荐 candidates）——遗忘防线的学生端兑现。
2. **V12 大题训练与测评系统**（F4）：`Question.rubric Json?` Schema 批准门 + 采分点内容批次 + LLM 对照评分（V12 单独立项设计）。
3. **推送/通知中心**（backlog #48）：站内 → 邮件 → 微信小程序（学之思模式参考）。
4. **FSRS 权重优化**：影子数据 ≥ 预注册样本后，以真实复习历史训练权重（需引入 ts-fsrs 对照或自研优化器）。
5. **知识图谱内容补录**：147 无快照节点考频、DS 科目先修边——教研侧队列（`/admin/data-quality` 持续观测）。
6. **Mastery Calibration 前端证据卡**（校准方向的学生可见化）。

## 7. 已知债（不阻塞，已入册）

StudyModule 双注册共享 provider · study.service.ts 5282 行单体 · 集成脚本 review-scheduler 断言（所有者定的稍后项）· 沙箱环境门禁替代（地雷区已登记）· 147 节点考频补录。

---

**冻结声明**：V11 架构以此文档为准。V12 大题训练系统将单独立项设计（Schema 批准门 + 内容批次前置），不在本冻结范围内启动。
