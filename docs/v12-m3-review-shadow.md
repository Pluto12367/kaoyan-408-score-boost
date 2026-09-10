# V12-M3 Phase B — Review Semantics Shadow

> 里程碑：V12-M3（Phase A 审计见 `docs/v12-m3-review-semantics-audit.md`）
> 状态：**Phase A 审计 + Phase B 影子实现完成**；Phase C（正式切换）**等待所有者批准**
> 纪律：**零生产写语义变更 / 零 Schema / 影子只读 / 输出显式 NON-AUTHORITATIVE**

---

## 1. 影子要量化什么

Phase A 实证：`mastery` 与 `stabilityDays` 由**不相交的路径**更新（练习只动前者，复习只动后者），且 `applyReview` 原样 spread 掌握度、`retention` 恒为 `1`。因此：

- 已观测的复习结果（V12-M1 分类为**强证据**）对能力估计**零贡献**
- 存储的 `retention` 是**无条件宣称**而非测量

影子做两件事，都不写任何表：

| 影子 | 问题 | 方法 |
|---|---|---|
| **masteryReplay** | 若复习结果与练习走同一 EMA，掌握度会是多少？ | 以 `UserMasterySnapshot` 为基线，按时间顺序对每次已观测复习应用 `updateMasteryAfterAttempt`（**复用生产同一纯函数**），与当前存储的 `UserKnowledgeMastery.mastery` 对比 |
| **retention** | 存储的 `retention=1` 与时间感知计算差多少？ | 用生产同一 `estimateRetention(lastReviewedAt, stabilityDays, asOf)` 计算，与存储值对比 |

同时把 `REVIEW_SEMANTICS_MATRIX`（Phase A 的矩阵）**以代码形式**随响应下发——文档、端点、测试共用同一真相源，杜绝"两套口径各自表述"。

---

## 2. 实现清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/shared/src/score-center/review-semantics.ts` | 新增（纯） | `REVIEW_SEMANTICS_MATRIX`、`replayUnifiedReviewMastery`、`reviewRetentionShadow`、`REVIEW_CONVERGENCE_EPSILON` |
| `apps/api/src/study/review-semantics-shadow.service.ts` | 新增（只读） | 装配：ReviewAttempt → 题目 → 节点（PRIMARY 优先）+ 节点数值难度 + 快照基线 + 当前存储值 |
| `apps/api/src/study/review-schedule.repository.ts` | 修改（+27 行） | `listAttemptsByUser(userId, limit)` |
| `apps/api/src/study/daily-brief.controller.ts` | 修改 | `GET /coach/review-semantics-shadow`（**teacher/admin**，走 `resolveUserId` 授权） |
| `apps/api/src/study/study.module.ts` | 修改 | 注册 provider |
| `test/review-semantics.test.js` | 新增（12 项） | 纯模块契约 |
| `test/review-semantics-shadow-service.test.js` | 新增（9 项） | 装配 / 窗口 / 边界 / 端点权限 |

**零迁移理由**：影子只读既有表（`ReviewAttempt` / `ReviewSchedule` / `QuestionKnowledgeNodeTag` / `KnowledgeNode` / `UserKnowledgeMastery` / `UserMasterySnapshot`），不需要任何新存储。

## 3. 诚实设计要点

| 场景 | 行为 |
|---|---|
| 节点无复习观测 | `replayMastery=null`、`delta=null`、`direction='insufficient_data'`——**不报 0** |
| 有观测但无存储掌握度 | 报告重放值，但 `delta=null`（**不与缺失值作差**） |
| 无历史快照 | 以中立初值重放，并在 `basis` 明示"无历史快照，以中立初值重放" |
| ✓ 快照基线不完整 | `UserMasterySnapshot` **只有** mastery/attempts/correctCount/wrongCount，**没有** accuracy/recentAccuracy/confidence。`accuracy` 由计数恢复；`recentAccuracy` 用 `accuracy` 近似；`confidence` 由 EMA 依 attempts 重算故其种子值无关紧要。近似事实写进 `basis`，不冒充完整基线 |
| 稳定性/时间缺失 | `computedRetention=null`、`verdict='unknown'`——且 **`unknown` 不计入分歧统计** |
| 偏差 ≤ `REVIEW_CONVERGENCE_EPSILON`（0.005） | 判 `converged`，不宣称为"变化" |
| 存储不可用 | 返回 `null` → 端点 `reason: 'store_unavailable'` |

**边界测试**：扫描服务源码（**剥离注释后**，因为文档块会合法地提到它所规避的写路径），断言不含 `.create(` / `.update(` / `.upsert(` / `.delete(` / `saveMastery` / `applyReview` / `applyAttempts` / `recordCanonicalEvent`。

## 4. 端点

```
GET /coach/review-semantics-shadow?userId=<可选>&windowDays=60
```
- 角色：**teacher / admin**（与既有 `review-shadow` 一致——这是模型质量仪器，不是学生界面）
- teacher 访问经 `resolveUserId` → `assertTeacherAuthorizedForStudent`
- 返回：`{ userId, generatedAt, windowDays, authoritative:false, semantics[], masteryReplay{rows,summary}, retention{rows,summary} }`

## 5. 门禁证据

| 项 | 命令 | 结果 |
|---|---|---|
| shared 构建 | `tsc -p packages/shared/tsconfig.json` | exit 0 |
| API 类型检查 | `tsc -p apps/api/tsconfig.json --noEmit` | exit 0 |
| 纯模块 | `node test/review-semantics.test.js` | **12/12 pass** |
| 服务/端点 | `node test/review-semantics-shadow-service.test.js` | **9/9 pass** |
| **正式测试门禁** | `npm test` | **2142 tests / 2140 pass / 0 fail / 2 skip，exit 0** |
| **正式构建门禁** | `npm run build:api` / `build:web` | exit 0 / exit 0 |

### 5.1 过程中发现并修复的一个 TEST BUG（诚实记录）

插入新端点后，`npm test` 出现 **2 个失败**。定位为 **TEST BUG 而非产品回归**：`v12-evidence-boundary.test.js` 与 `v12-exposure-wiring.test.js` 用"切片到下一个**文档注释**"界定控制器方法体，新端点（带 `@Query('userId')`）落进切片 → 误报"端点接受 userId 覆盖"。

修复：改为按**下一个路由**（`@Get(`）界定切片，并新增**正向对照**断言（切片必须非空且覆盖方法签名中的 `@Query('limit')` / `function` 名），防止切片为空时**空洞通过**。修复后 `npm test` 2140/0。

## 6. Phase C（切换）**未实施**——需所有者批准

完整设计见 `docs/v12-m3-review-semantics-audit.md` §4.3，要点：

| 项 | 设计 |
|---|---|
| 变更类型 | 纯语义（**无 Schema 变更**）：`applyReview` 增加 EMA 掌握度更新；`retention` 改为计算值 |
| 迁移 | **零迁移**，历史行不回填（避免不可逆改写历史） |
| 可回滚 | 单函数体回滚；无数据形态变更 |
| 预注册阈值 | 偏差方向一致率 ≥ 70% 且复习样本 ≥ 30（沿用 `MIN_SHADOW_SAMPLE`），达标前不切换 |
| 风险 | 掌握度被复习拉高 → 可能改变推荐排序（`calculatePriority` 消费 `mastery`）；影子期需同时观测排序变化幅度 |
| 人在环 | 所有者批准后实施，保留影子端点继续对照 ≥ 1 个观察窗 |

## 7. UNKNOWN / 局限

| 项 | 原因 |
|---|---|
| 影子在真实数据上的分歧分布 | 需连数据库；本会话 Docker 引擎未就绪，PostgreSQL 集成测试不可执行 |
| 生产 `retention` 是否已被前端消费 | 未做前端消费面审计 |
| FSRS 与统一语义的三方对照 | 本轮的 FSRS 对照仍只有 `review-shadow`（F3 M1 观测基线）+ `fsrs-scheduler` 纯函数，二者**尚未在同一端点内并排输出**，属 Phase C 前的剩余工作 |
