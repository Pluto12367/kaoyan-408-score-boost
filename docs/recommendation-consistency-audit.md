# Recommendation Consistency Audit（Phase 5）

日期：2026-09-05
范围：RecommendationEngine → RecommendationAction → generationKey → StudyPlan 一致性
方法：只读审计 + 既有测试断言引用（不重复造测试；覆盖缺口才补）

---

## 1. Identity Derivation（纯契约函数）

`createRecommendationActionKey(generationKey, actionType, targetType, targetId)` = `ACTION:{generationKey}:{actionType}:{targetType}:{targetId}`（`action-creation-key.ts`，输入非空校验）。

同一 generation 内：相同 (actionType, targetType, targetId) ⇒ **相同 creationKey** ⇒ 幂等复用同一 Action；不同 generation ⇒ generationKey 段不同 ⇒ **不同 Action**。

## 2. Verified Guarantees（`test/recommendation-action-generation-runtime.test.js` 实测断言）

| 保证 | 断言锚点 |
|---|---|
| **same generation → same action identity**：同 generation 重试返回相同 `id` 与 `creationKey`，存储仅 1 行 | :54-55, :61 |
| **different generation → different action identity**：不同 generationKey 产生不同 `id`，存储 2 行 | :75-76 |
| **LearningLoop vs 手动生成隔离**：`LEARNING_LOOP:{userId}:{date}:v1` 与手动 generation 互不合并 | :90-91 |
| **legacy 无 generation 兼容**：date-scoped key（`u-1:2026-09-02:PRACTICE:...`）不迁移、幂等保持 | :99-100 |
| generationKey 透传到引擎/事件 | :153-154 |

## 3. Duplicate Generation 场景矩阵

| 场景 | 机制 | 结果 |
|---|---|---|
| 同日任务完成后重试触发 | StudyPlan `createOrGetByGenerationKey`（userId+generationKey 唯一）| 复用既有 Plan，不新建 |
| 同 generation 重复创建 Action | Action repository 按 creationKey 幂等 | 复用并保持 `studyTaskId` 绑定 |
| 同 generation 重复写 plan.generated | UserEvent (userId, eventKey) 唯一 + 冲突回读 | 单行事件 |
| 跨实例并发（同 generation 同时到达） | 外层事务 + 唯一冲突回滚 + fresh read 收敛 | 单 Plan/Action/Event（**集成级验证 = D4-B4，BLOCKED BY ENVIRONMENT**，维持既有状态） |
| 不同 scheduledDate | generationKey 含日期 → 天然隔离 | 各自独立 Plan |
| 引擎重入（同 asOf 重复计算） | 引擎纯函数、无副作用；持久化仅在 writer 层 | 幂等 |

## 4. Consistency Verdict

- **same generation → same action identity：✅ 已钉死**（运行时测试 + creationKey 纯函数 + DB 唯一）。
- **different generation → different action identity：✅ 已钉死**。
- 重复生成不产生重复逻辑动作：✅（三层幂等：Plan generationKey / Action creationKey / Event eventKey）。
- 遗留：D4-B4 跨实例并发集成验证受 ENV 阻塞（既有登记，非本任务可解）；单元级并发收敛已由事务回滚 + fresh read 测试覆盖。

**结论：无需新增回归测试**——既有测试矩阵已覆盖本阶段全部边界；本审计将其固化为契约证据。
