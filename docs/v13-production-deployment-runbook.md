# V13 生产部署 Runbook（含 4 条迁移 + 两批内容）— 人工操作员执行

> **本文件由 Agent 依据仓库证据准备，不执行任何部署**；由 Owner/操作员逐条复制执行（AGENTS.md RULE-13）。
> 覆盖范围：S1 runbook（迁移 37→38）之后累积的**全部未部署内容**，生产迁移数 **38 → 41**（四条 additive 迁移：`20260913000000_score_loss_evidence` + `20260918000000_question_subtype` + `20260926000000_real_exam_foundation` + `20260927000000_memory_card_foundation`），外加**真题 13 个年包内容**（2009-2015 + 2022-2026）与**记忆卡首批 48 卡**两批内容导入（§3A）。
> **若生产已应用 38**（S1 runbook 已执行过）：跳过 38 的验证小节，只验 39/40/41；`prisma migrate deploy` 幂等，重复执行无副作用。
> 核心纪律不变：**"migration 成功" ≠ "功能部署成功"**——两者都要验证。标记：**【已验证】**= 仓库/本机测试库一手证据；**UNVERIFIED** = 服务器侧事实，现场确认。
> 前置阅读：`docs/s1-production-deployment-runbook.md`（同款纪律与陷阱，本文只写增量）。
> **V14 增补（2026-09-26）**：纳入迁移 40（真题库地基）+ 迁移 41（记忆卡三表）+ 真题五年内容导入 + 记忆卡 48 卡导入。记忆卡功能**无 feature flag**——部署即对学生可见（卡片目录导入前为诚实空态）。

---

## 0. 版本身份与部署内容

| 项 | 值 | 依据 |
|---|---|---|
| 部署分支 | `feature/v3-product-refactor` | 【已验证】 |
| 部署目标 | **push 后的 origin HEAD**（须包含 `20260918000000_question_subtype` / `20260926000000_real_exam_foundation` / `20260927000000_memory_card_foundation`）；本 runbook 增补时 origin HEAD = `7c81e560` | 操作员以 `git ls-remote` + `git ls-tree` 现场核对 |
| 内容校验（必须做） | `git ls-tree origin/feature/v3-product-refactor -- prisma/migrations/20260918000000_question_subtype/migration.sql prisma/migrations/20260926000000_real_exam_foundation/migration.sql prisma/migrations/20260927000000_memory_card_foundation/migration.sql` **三行都有输出**；`git log --oneline origin/feature/v3-product-refactor -1` | 【已验证】 |
| 本地门禁基线 | `npm test` **2682/2684/0/2** exit 0；build 三端 exit 0；集成套件 exit 0（含 clean-account-loop 14 阶段 / mock-loss-trend 5 步 / question-scoring 9 步 / error-diagnosis 6 步 / forgetting-risk 5 步 / score-recovery 5 步 / score-loss 9 步 / real-exam-import 18 步 / **memory-card 19 步**） | 【已验证】本机真实 PostgreSQL + HTTP 一手执行 |

**迁移 39 的精确内容**（【已验证】`prisma/migrations/20260918000000_question_subtype/migration.sql`）：
`CREATE TYPE "QuestionSubtype" AS ENUM ('SINGLE_CHOICE','JUDGEMENT','COMPREHENSIVE_CHOICE','ALGORITHM','CO_COMPUTATION','OS_PV','CN_ROUTING')` + `ALTER TABLE "Question" ADD COLUMN "questionSubtype" "QuestionSubtype"`（可空）。**零 DROP 既有对象 / 零 RENAME / 零回填 / 零 NOT NULL**；历史行全 NULL = unknown（D6，绝不猜测）。
**回滚**：`ALTER TABLE "Question" DROP COLUMN "questionSubtype"; DROP TYPE "QuestionSubtype";` —— 仅丢分类元数据（当前生产该列不存在 ⇒ 回滚零数据损失）；旧代码不引用该列。

**迁移 40 的精确内容**（【已验证】`prisma/migrations/20260926000000_real_exam_foundation/migration.sql`）：
`ALTER TABLE "Question" ADD COLUMN "optionAnalyses" JSONB` + `ADD COLUMN "examNo" INTEGER`（均可空，additive，零回填）。optionAnalyses = 答错陷阱呈现的逐错项数据（shape 契约 `packages/shared/src/score-center/option-analyses.ts`）；examNo = 真题卷内题号。学生提交前视图结构性剥离 optionAnalyses。
**回滚**：`ALTER TABLE "Question" DROP COLUMN "optionAnalyses"; ALTER TABLE "Question" DROP COLUMN "examNo";` —— 两条派生内容列（当前生产不存在 ⇒ 回滚零数据损失）。

**迁移 41 的精确内容**（【已验证】`prisma/migrations/20260927000000_memory_card_foundation/migration.sql`）：
新建三表 `MemoryCard`（卡片目录：knowledgeNodeId/cardType/front/back/reviewedBy/rightsConfirmed/isActive）+ `UserMemoryCardState`（每用户每卡排程状态：stabilityDays/lastReviewedAt/nextReviewAt/lastRating/reviewCount/version，userId+cardId 唯一）+ `MemoryCardReviewLog`（append-only 自评日志，idempotencyKey 唯一，复合外键挂 (userId,cardId) 状态行）。**additive 零回填、不改任何既有表**。语义围栏（contract §2.2）：卡片自评=self_reported 弱证据，**从不写** UserKnowledgeMastery/ReviewSchedule/证据台账——部署后旧代码不引用这三表，回滚零风险。
**回滚**（按外键顺序）：`DROP TABLE "MemoryCardReviewLog"; DROP TABLE "UserMemoryCardState"; DROP TABLE "MemoryCard";` —— 三表部署时为空（首次部署）或仅含卡片学习状态（不含能力数据 ⇒ 丢弃即回滚，能力层零损失）。

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
# 1.2 迁移现状（确认生产在 38：score_loss_evidence 已应用、39/40/41 未应用）
prisma migrate status
# PASS = "Database schema is up to date!" 且最后一条为 20260913000000_score_loss_evidence（待应用 39/40/41 三条）
# 1.3 部署前外部基线（判别器，回滚对照）
for p in error-patterns error-diagnosis training-prescription forgetting-risk score-recovery; do
  curl -s -o /dev/null -w "%{http_code} /api/coach/$p\n" "http://127.0.0.1/api/coach/$p"
done
curl -s -o /dev/null -w "%{http_code} /api/memory-cards/session\n" "http://127.0.0.1/api/memory-cards/session"
curl -s -o /dev/null -w "%{http_code} /api/memory-cards/practice-candidate?nodeId=x\n" "http://127.0.0.1/api/memory-cards/practice-candidate?nodeId=x"
# 预期：全部 404（路由不存在）。若已 401 → 生产已在新代码上，停止并核对版本（UNVERIFIED）。
```

---

## 2. 部署（代码 + 迁移）

```bash
# 2.1 取代码（字面 SHA）+ 确认四条迁移在位
git fetch origin feature/v3-product-refactor
git ls-tree origin/feature/v3-product-refactor -- prisma/migrations/20260913000000_score_loss_evidence/migration.sql prisma/migrations/20260918000000_question_subtype/migration.sql prisma/migrations/20260926000000_real_exam_foundation/migration.sql prisma/migrations/20260927000000_memory_card_foundation/migration.sql
# 2.2 deploy.sh（备份门禁 → build → prisma migrate deploy → 三容器）
# PASS：备份行出现；"All migrations have been successfully applied"（39+40+41 三条新增；38 幂等跳过）；三容器 healthy
```

---

## 3. 迁移验证（migration ≠ 功能）

```sql
-- 3.1 迁移 38（若未应用过）
SELECT to_regclass('"ScoreLossItem"');                       -- PASS = 非空
-- 3.2 迁移 39
SELECT unnest(enum_range(NULL::"QuestionSubtype"));           -- PASS = 7 个值
SELECT "questionSubtype", count(*) FROM "Question" GROUP BY 1; -- PASS = 全 NULL（零回填）
-- 3.3 迁移 40
SELECT to_regclass('"Question"') IS NOT NULL
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Question' AND column_name IN ('optionAnalyses','examNo'));
-- PASS = true（两列存在）；历史行验证：
SELECT count(*) FROM "Question" WHERE "optionAnalyses" IS NOT NULL OR "examNo" IS NOT NULL; -- PASS = 0（零回填）
-- 3.4 迁移 41（三表存在；目录为空=诚实空态，内容在 §3A 导入）
SELECT to_regclass('"MemoryCard"'), to_regclass('"UserMemoryCardState"'), to_regclass('"MemoryCardReviewLog"'); -- PASS = 三者非空
SELECT count(*) FROM "MemoryCard";    -- PASS = 0（导入前）
SELECT count(*) FROM "UserMemoryCardState"; SELECT count(*) FROM "MemoryCardReviewLog";  -- PASS = 0
-- 3.5 幂等
-- 重跑 prisma migrate deploy → "No pending migrations"（PASS）
```

---

## 3A. 内容导入（迁移成功后、功能冒烟前）

> 内容导入是**内容放行决策**（RULE-10）：本节所有命令均带 `--reviewed-by "zhoujiale(Owner)" --rights-confirmed`（Owner 已在 dev 库互审通过的同批内容）；缺任一标志脚本会硬拒。
> **前置**：记忆卡与真题内容都依赖 **v2 节点目录**（1296 KnowledgeNode + 五套 ExamPaper 对标标签，`npm run seed:408` = `scripts/seed-408-v2.mjs`）。若生产目录未升级，先执行 seed（脚本幂等性在生产=UNVERIFIED，**先在测试库演练一次**；seed 后 `SELECT count(*) FROM "KnowledgeNode"` 应 ≈ 1296）。

```bash
# 3A.1 真题内容（各年 CSV：kaoyan-408-content-starter/imports/real-exam-YYYY-pilot.csv）
# 已审定批次：2009-2021（十三年）与 2022-2026（五年）——18 年全部完成
# 前置小步：取生产管理员用户ID（--uploaded-by 用）：
#   psql <生产库> -c "SELECT id, email FROM \"User\" WHERE role='ADMIN' LIMIT 3;"
for Y in 2009 2010 2011 2012 2013 2014 2015 2016 2017 2018 2019 2020 2021 2022 2023 2024 2025 2026; do
  DATABASE_URL=<生产库> node scripts/import-real-exams.mjs kaoyan-408-content-starter/imports/real-exam-$Y-pilot.csv \
    --reviewed-by "zhoujiale(Owner)" --uploaded-by <生产管理员用户ID> --rights-confirmed
  # PASS：created=47（幂等复跑 skipped=47）
done
# 审计门禁（全部导入后）：
npm run audit:real-exam-content
# PASS：18 年全部收录 846 题（18×47）、选择定价 80/80、陷阱 120、rubric 7/7、分值互证；
#       2009-2021 大题未定价 7/年 = 诚实缺口（待官方分值表），非 FAIL

# 3A.2 记忆卡三批共 168 卡（Owner 已互审，dev 库同批已入库）
# 批 1（48 卡，考频 TOP24）：
DATABASE_URL=<生产库> node scripts/import-memory-cards.mjs kaoyan-408-content-starter/imports/memory-cards-batch1-highfreq.csv --dry-run
DATABASE_URL=<生产库> node scripts/import-memory-cards.mjs kaoyan-408-content-starter/imports/memory-cards-batch1-highfreq.csv \
  --reviewed-by "zhoujiale(Owner)" --rights-confirmed
# 批 2（60 卡，考频 25-54 名）：
DATABASE_URL=<生产库> node scripts/import-memory-cards.mjs kaoyan-408-content-starter/imports/memory-cards-batch2-highfreq.csv --dry-run
DATABASE_URL=<生产库> node scripts/import-memory-cards.mjs kaoyan-408-content-starter/imports/memory-cards-batch2-highfreq.csv \
  --reviewed-by "zhoujiale(Owner)" --rights-confirmed
# 批 3（60 卡，考频 55-84 名）：
DATABASE_URL=<生产库> node scripts/import-memory-cards.mjs kaoyan-408-content-starter/imports/memory-cards-batch3-highfreq.csv --dry-run
DATABASE_URL=<生产库> node scripts/import-memory-cards.mjs kaoyan-408-content-starter/imports/memory-cards-batch3-highfreq.csv \
  --reviewed-by "zhoujiale(Owner)" --rights-confirmed
# 每批 PASS：dry-run 结构校验通过 → created=60（批1=48）；幂等复跑 skipped=同数
# 内容修订（日后）：同 CSV 加 --update 即同正面覆盖背面+重盖 RULE-10 留痕
```

```sql
-- 3A.3 记忆卡导入验证
SELECT count(*) FROM "MemoryCard";                    -- PASS = 168（48+60+60）
SELECT "reviewedBy", "rightsConfirmed", count(*) FROM "MemoryCard" GROUP BY 1, 2;
-- PASS = 全行 reviewedBy='zhoujiale(Owner)' 且 rightsConfirmed=true（RULE-10 留痕）
SELECT count(*) FROM "MemoryCard" WHERE "knowledgeNodeId" NOT IN (SELECT id FROM "KnowledgeNode");  -- PASS = 0
SELECT count(DISTINCT "knowledgeNodeId") FROM "MemoryCard";  -- PASS = 84（54+30 节点全覆盖）
```

> **内容回滚**（仅在误导时）：`DELETE FROM "MemoryCard" WHERE "reviewedBy" = '<误导批次评审人>';` —— 学生卡片状态/日志经外键级联清除；能力层零关联（卡片域与掌握度无外键）。真题内容回滚 = 按 importBatch 定位版本行，遵循真题导入器自身回滚语义（不在此展开）。

---

---

## 4. 功能冒烟（判别器逐条）

```bash
# 4.1 新端点注册 + 守卫（部署前 404 → 部署后 401；404 = 判别失败）
for p in error-patterns error-diagnosis training-prescription forgetting-risk score-recovery; do
  curl -s -o /dev/null -w "%{http_code} /api/coach/$p\n" "http://127.0.0.1/api/coach/$p"
done
curl -s -o /dev/null -w "%{http_code} /api/memory-cards/session\n" "http://127.0.0.1/api/memory-cards/session"
curl -s -o /dev/null -w "%{http_code} /api/memory-cards/practice-candidate?nodeId=x\n" "http://127.0.0.1/api/memory-cards/practice-candidate?nodeId=x"
curl -s -o /dev/null -X POST -H "Content-Type: application/json" -d '{}' -w "%{http_code} /api/memory-cards/x/review\n" "http://127.0.0.1/api/memory-cards/x/review"
# PASS = 8 × 401（记忆卡三条路由含 POST 守卫）
# 4.2 legacy 回归：老端点不回归
curl -s -o /dev/null -w "%{http_code} /api/health\n" http://127.0.0.1/api/health            # 200
curl -s -o /dev/null -w "%{http_code} /api/wrong-questions\n" http://127.0.0.1/api/wrong-questions  # 401
# 4.3 前端 bundle 含新卡文案（登录页可见性之外的抽查）
curl -s http://127.0.0.1/ | grep -c "今天先解决这个" || true   # 懒加载 chunk：0 不判 FAIL，按 4.4 登录后核验
# 4.4 登录后（用任一有错题的测试学生）：
#   GET /api/coach/error-diagnosis?days=7 → dataStatus 字段存在
#   GET /api/coach/training-prescription?days=7 → ladder 五步存在
#   GET /api/memory-cards/session → storeAvailable:true；summary 结构存在；导入后 queue 含卡片
#     （examContext.isFallback=true + label 含「考试日期未设置」= 该学生未设置考试日期的诚实标注）
#   POST /api/memory-cards/<cardId>/review {"rating":"remembered","idempotencyKey":"smoke-1"}
#     → 200，applied.quality=4；同 key 重放 → replayed:true（幂等）；非法 rating → 400
```

> **分类语义冒烟（可在测试库先演练）**：本机 `npm run test:integration:clean-account-loop` 已在真实 PG+HTTP 走通 Day0→Day7 十四阶段（含处方阶梯、遗忘、失分恢复），生产等价验证见 §5。

---

## 5. 生产等价验证（真实数据链）

1. 任一有错题的学生登录 → 首页"学习处方与提醒"卡出现（或诚实静默=该生无证据，均 PASS）
2. `GET /api/coach/error-patterns|error-diagnosis|training-prescription|forgetting-risk|score-recovery` → `dataStatus`/`summary` 结构一致
3. 有定价题的错答 → `GET /api/coach/score-recovery` 的 `observedLossOutstanding` > 0（NULL ≠ 0 语义保持）
4. 错题列表错因列出现「待归因」⇐ 新语义生效的直接证据
5. **记忆卡闭环（V14-②）**：学生导航出现「记忆卡」→ 队列渲染导入的新卡（每轮 cap 10）→ 翻卡自评「记住/模糊/没记住」→ `UserMemoryCardState` 行生成且该学生 `UserKnowledgeMastery` **零变化**（卡片域围栏）→ 卡面「做一道「节点名」的题验证 →」→ 既有题库分区作答 → 该节点 mastery 行由 canonical 写方生成（真实作答回流）

---

## 6. 回滚

```bash
# 代码回滚 = 切回上一 commit 重建（V12.1 先例）；迁移回滚（仅在确需时）：
ALTER TABLE "Question" DROP COLUMN "questionSubtype";
DROP TYPE "QuestionSubtype";
ALTER TABLE "Question" DROP COLUMN "optionAnalyses";
ALTER TABLE "Question" DROP COLUMN "examNo";
DROP TABLE "MemoryCardReviewLog";   -- 先子后父（外键顺序）
DROP TABLE "UserMemoryCardState";
DROP TABLE "MemoryCard";
-- ScoreLoss 四表与 ledger 本轮全程未触碰。
-- 注意：DROP 三表会一并丢弃学生的卡片复习状态（卡片域数据）；能力层/掌握度/失分账本零关联。
-- 真题内容回滚 = 按 importBatch/年份定位，遵循真题导入器自身语义（见 §3A 注意）。
```

---

## 7. 部署后缺口登记（不属于本次部署）

- 真实大题内容=0（`npm run audit:large-question-content` 持续 NOT READY；Owner/教研轨）
- 干净账户今日计划题量为 0 的内容阈值问题（harness 诚实记录，非代码缺陷）
- 真实考试成绩样本=0（E1 校准未启动）
- Gate 15：处方→任务创建（Owner 裁决后由 harness 追加断言）
- 真题内容批次剩余：2016-2021 六年（内容轨进行中）+ 2009-2021 大题定价（待官方分值表，版本化 rubric 回填）
- 记忆卡内容批次剩余：考频 TOP24 之外的节点（`docs/v14-memory-card-roadmap.md` §1，同导入链路机械重复）
- 记忆卡 FSRS 影子对比：需生产真实复习数据积累后再提 Owner Gate（roadmap §4，样本=0 前不动）
