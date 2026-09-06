# V8 #56 设计文档：错题本与 canonical WrongQuestionReview 漂移对账

> 状态：DESIGN（架构保护边界——触碰 canonical 读模型，设计先行，未经所有者确认不实施）。
> 证据：生产 jackchou 账号 2026-09-07——canonical `pendingWrongQuestionCount`=23（未解决行），派生错题本"当前错题"=12、待复盘=0、已复盘=12、重做解决=13；复习队列另有 24 条 ReviewSchedule 到期项。

## 1. 现状数据流

| 写入点 | 触发 | 效果 |
|---|---|---|
| `touchWrongQuestion`（score-center/repository.ts:259） | 答错 | `WrongQuestionReview` upsert，`resolved=false` |
| `resolveWrongQuestion`（同文件 :275） | 重做答对 | `resolved=true, resolvedAt` |
| 派生错题本（study.service listWrongQuestions） | 实时 | 由 `PracticeRecord` 聚合，独立于上表 |
| `ReviewSchedule` | 答错建排期；复习调度 | 与上两套平行 |

漂移假说（按可能性排序）：
1. **旧数据无 resolved 回写**：早期版本答错写 `touchWrongQuestion`，但重做路径未调用 `resolveWrongQuestion`（或调用前数据已存在），11 行停留在 `resolved=false`；
2. **派生错题本已"忘"的题在表里还在**：错题本由近期 PracticeRecord 派生，一道题练习历史被会话口径排除后，派生侧不再显示，但表行未清理；
3. **同一题多轮错答**：表按 (userId,questionId) 唯一——排除重复行假说。

## 2. 对账目标（口径声明见 docs/v8-wrong-question-semantics.md）

canonical 未解决数应 ≤ 派生错题本总数 + 合理容差（已解决但保留历史的行不影响计数）；
"未解决"的判定必须与学生在错题本看到的事实一致。

## 3. 方案比较

| 方案 | 做法 | 优点 | 风险 | 结论 |
|---|---|---|---|---|
| A 读时合并 | canonical 投影改为与派生错题本 join，表行仅作历史 | 不动写路径 | 投影 SQL 复杂化；canonical 契约变更 | 备选 |
| B 回填脚本 | 一次性：`resolved=false` 且派生错题本不存在的行 → `resolved=true, resolvedAt=now, metadata=backfill` | 简单、可审计（脚本+备份先行） | 需确认"派生错题本不存在"即"已解决"的产品语义 | **推荐** |
| C 写路径修复 | 重做完成链路补 `resolveWrongQuestion` 调用 | 阻止新漂移 | 不解决存量；需确认现状是否已修 | 与 B 并行：先审计写路径 |

## 4. 推荐实施序（B+C）

1. **写路径审计**（读代码，1 次会话）：确认重做答对 → `resolveWrongQuestion` 是否全链路覆盖（含 score-center 重做、错题详情重做、变式完成三入口）；缺口即修（TDD）。
2. **对账脚本** `scripts/reconcile-wrong-question-review.mjs`：dry-run 输出漂移清单（questionId、lastReviewedAt、派生态）→ 确认后 `--apply` 回填；先行 `db:backup`。
3. **验收**：dry-run 清单人工抽查 10 条；`GET /admin/metrics` 与报告口径复查；漂移数 23→≈12。

## 5. 边界

- 不改 `WrongQuestionReview` Schema（无迁移）；
- 不动 canonical 投影契约（读模型只换数据修复，不改形状）；
- 回填属破坏性写操作——执行前必须所有者确认 + 备份（AGENTS.md 第 6 条）。
