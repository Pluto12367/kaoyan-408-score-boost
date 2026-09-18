# V13 生产部署 Runbook（含 2 条迁移）— 人工操作员执行

> **本文件由 Agent 依据仓库证据准备，不执行任何部署**；由 Owner/操作员逐条复制执行（AGENTS.md RULE-13）。
> 覆盖范围：S1 runbook（迁移 37→38）之后累积的**全部未部署内容**，生产迁移数 **38 → 40**（两条 additive 迁移：`20260913000000_score_loss_evidence` + `20260918000000_question_subtype`）。
> **若生产已应用 38**（S1 runbook 已执行过）：跳过 38 的验证小节，只验 39；`prisma migrate deploy` 幂等，重复执行无副作用。
> 核心纪律不变：**"migration 成功" ≠ "功能部署成功"**——两者都要验证。标记：**【已验证】**= 仓库/本机测试库一手证据；**UNVERIFIED** = 服务器侧事实，现场确认。
> 前置阅读：`docs/s1-production-deployment-runbook.md`（同款纪律与陷阱，本文只写增量）。

---

## 0. 版本身份与部署内容

| 项 | 值 | 依据 |
|---|---|---|
| 部署分支 | `feature/v3-product-refactor` | 【已验证】 |
| 部署目标 | **push 后的 origin HEAD**（须包含 `20260918000000_question_subtype`） | 操作员以 `git ls-remote` + `git ls-tree` 现场核对 |
| 内容校验（必须做） | `git ls-tree origin/feature/v3-product-refactor -- prisma/migrations/20260918000000_question_subtype/migration.sql` **有输出**；`git log --oneline origin/feature/v3-product-refactor -1` | 【已验证】 |
| 本地门禁基线 | `npm test` **2607/2605/0/2** exit 0；build 三端 exit 0；12 个集成套件 exit 0（含 clean-account-loop 14 阶段 / mock-loss-trend 5 步 / question-scoring 9 步 / error-diagnosis 6 步 / forgetting-risk 5 步 / score-recovery 5 步 / score-loss 9 步） | 【已验证】本机真实 PostgreSQL + HTTP 一手执行 |

**迁移 39 的精确内容**（【已验证】`prisma/migrations/20260918000000_question_subtype/migration.sql`）：
`CREATE TYPE "QuestionSubtype" AS ENUM ('SINGLE_CHOICE','JUDGEMENT','COMPREHENSIVE_CHOICE','ALGORITHM','CO_COMPUTATION','OS_PV','CN_ROUTING')` + `ALTER TABLE "Question" ADD COLUMN "questionSubtype" "QuestionSubtype"`（可空）。**零 DROP 既有对象 / 零 RENAME / 零回填 / 零 NOT NULL**；历史行全 NULL = unknown（D6，绝不猜测）。
**回滚**：`ALTER TABLE "Question" DROP COLUMN "questionSubtype"; DROP TYPE "QuestionSubtype";` —— 仅丢分类元数据（当前生产该列不存在 ⇒ 回滚零数据损失）；旧代码不引用该列。

**本次代码增量（对照生产基线 b62903d，41+ commits）**：
- A1 错因基础：classifyMistake 兜底解除（无信号错答 → NULL=unknown，不再冒充"概念混淆"）；`POST /wrong-questions/:id/reason` 新增可选 `controlledReason`/`optionalNote`（legacy 自由文本逐字兼容）
- PHASE 5/7/9/11 四类只读投影端点：`GET /coach/training-prescription`、`GET /coach/forgetting-risk`、`GET /coach/score-recovery`、`GET /exam/score-history`（增量 `lossTrend` 字段）、`GET /coach/error-patterns`、`GET /coach/error-diagnosis`
- PHASE 8 工具链：`Question.rubric`/`questionSubtype`/`maxScore` 的 create/update/导入写入路径（导入列 `questionSubtype`/`maxScore`/`判分标准`，非法→行级硬错）
- PHASE 10 前端：学生首页"学习处方与提醒"卡（纯消费既有端点）、错题区"失分与错因（逐题）"下钻
- **行为变更（唯一）**：classifyMistake 无信号错答的错因从「概念混淆」改为「待归因」（NULL）——前端错题列表该列将显示"待归因"，属**有意语义修正**（UNKNOWN ≠ CONCEPT_CONFUSION，Owner Decision v1.1 锁定）

---

## 1. 部署前 Preflight（服务器）

```bash
# 1.1 备份门禁（deploy.sh 自带；手动部署必须先手动备份）
pg_dump -U kaoyan408 -d kaoyan408 -F c -f /backup/kaoyan408-$(date -u +%Y%m%dT%H%M%SZ).dump
# PASS = 备份文件存在且 > 0 字节；FAIL = 停止
# 1.2 迁移现状（确认生产在 38：score_loss_evidence 已应用、question_subtype 未应用）
prisma migrate status
# PASS = "Database schema is up to date!" 且最后一条为 20260913000000_score_loss_evidence
# 1.3 部署前外部基线（判别器，回滚对照）
for p in error-patterns error-diagnosis training-prescription forgetting-risk score-recovery; do
  curl -s -o /dev/null -w "%{http_code} /api/coach/$p\n" "http://127.0.0.1/api/coach/$p"
done
# 预期：全部 404（路由不存在）。若已 401 → 生产已在新代码上，停止并核对版本（UNVERIFIED）。
```

---

## 2. 部署（代码 + 迁移）

```bash
# 2.1 取代码（字面 SHA）+ 确认两条迁移在位
git fetch origin feature/v3-product-refactor
git ls-tree origin/feature/v3-product-refactor -- prisma/migrations/20260913000000_score_loss_evidence/migration.sql prisma/migrations/20260918000000_question_subtype/migration.sql
# 2.2 deploy.sh（备份门禁 → build → prisma migrate deploy → 三容器）
# PASS：备份行出现；"All migrations have been successfully applied"（38+39 两条）；三容器 healthy
```

---

## 3. 迁移验证（migration ≠ 功能）

```sql
-- 3.1 迁移 38（若未应用过）
SELECT to_regclass('"ScoreLossItem"');                       -- PASS = 非空
-- 3.2 迁移 39
SELECT unnest(enum_range(NULL::"QuestionSubtype"));           -- PASS = 7 个值
SELECT "questionSubtype", count(*) FROM "Question" GROUP BY 1; -- PASS = 全 NULL（零回填）
-- 3.3 幂等
-- 重跑 prisma migrate deploy → "No pending migrations"（PASS）
```

---

## 4. 功能冒烟（判别器逐条）

```bash
# 4.1 新端点注册 + 守卫（部署前 404 → 部署后 401；404 = 判别失败）
for p in error-patterns error-diagnosis training-prescription forgetting-risk score-recovery; do
  curl -s -o /dev/null -w "%{http_code} /api/coach/$p\n" "http://127.0.0.1/api/coach/$p"
done
# PASS = 5 × 401
# 4.2 legacy 回归：老端点不回归
curl -s -o /dev/null -w "%{http_code} /api/health\n" http://127.0.0.1/api/health            # 200
curl -s -o /dev/null -w "%{http_code} /api/wrong-questions\n" http://127.0.0.1/api/wrong-questions  # 401
# 4.3 前端 bundle 含新卡文案（登录页可见性之外的抽查）
curl -s http://127.0.0.1/ | grep -c "今天先解决这个" || true   # 懒加载 chunk：0 不判 FAIL，按 4.4 登录后核验
# 4.4 登录后（用任一有错题的测试学生）：
#   GET /api/coach/error-diagnosis?days=7 → dataStatus 字段存在
#   GET /api/coach/training-prescription?days=7 → ladder 五步存在
```

> **分类语义冒烟（可在测试库先演练）**：本机 `npm run test:integration:clean-account-loop` 已在真实 PG+HTTP 走通 Day0→Day7 十四阶段（含处方阶梯、遗忘、失分恢复），生产等价验证见 §5。

---

## 5. 生产等价验证（真实数据链）

1. 任一有错题的学生登录 → 首页"学习处方与提醒"卡出现（或诚实静默=该生无证据，均 PASS）
2. `GET /api/coach/error-patterns|error-diagnosis|training-prescription|forgetting-risk|score-recovery` → `dataStatus`/`summary` 结构一致
3. 有定价题的错答 → `GET /api/coach/score-recovery` 的 `observedLossOutstanding` > 0（NULL ≠ 0 语义保持）
4. 错题列表错因列出现「待归因」⇐ 新语义生效的直接证据

---

## 6. 回滚

```bash
# 代码回滚 = 切回上一 commit 重建（V12.1 先例）；迁移回滚（仅在确需时）：
ALTER TABLE "Question" DROP COLUMN "questionSubtype";
DROP TYPE "QuestionSubtype";
-- ScoreLoss 四表与 ledger 本轮全程未触碰。
```

---

## 7. 部署后缺口登记（不属于本次部署）

- 真实大题内容=0（`npm run audit:large-question-content` 持续 NOT READY；Owner/教研轨）
- 干净账户今日计划题量为 0 的内容阈值问题（harness 诚实记录，非代码缺陷）
- 真实考试成绩样本=0（E1 校准未启动）
- Gate 15：处方→任务创建（Owner 裁决后由 harness 追加断言）
