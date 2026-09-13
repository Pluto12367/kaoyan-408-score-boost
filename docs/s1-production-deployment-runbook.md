# S1 生产部署 Runbook（含迁移）— 人工操作员执行

> **本文件由 Agent 依据仓库证据准备，不执行任何部署**；由 Owner/操作员逐条复制执行（AGENTS.md RULE-13：生产服务器操作由 Owner 执行）。
> 与 G1「纯代码部署、无迁移」不同：**本次包含 1 条新迁移**（`20260913000000_score_loss_evidence`），生产迁移数 **37 → 38**。
> 核心纪律：**"migration 成功" ≠ "功能部署成功"**——两者都要验证。
> 标记：**【已验证】**= 仓库内有直接证据（本机已在真实 PostgreSQL 测试库完整走通）；**UNVERIFIED** = 服务器侧事实，操作员现场确认。

---

## 0. 版本身份与部署内容

| 项 | 值 | 依据 |
|---|---|---|
| 部署分支 | `feature/v3-product-refactor` | 【已验证】 |
| 部署目标 | **push 后的 origin HEAD**（≥ `b8f103a1`，且包含 `20260913000000_score_loss_evidence`） | 操作员以 `git ls-remote origin feature/v3-product-refactor` 输出为准 |
| 内容校验（必须做） | `git ls-tree origin/feature/v3-product-refactor -- prisma/migrations/20260913000000_score_loss_evidence/migration.sql` **有输出** | 【已验证】该迁移存在于 S1 提交集 |
| 本地门禁基线 | `npm test` 2538/2536/0/2 exit 0；build 三端 exit 0；8 个集成套件 exit 0（含 score-loss E2E 9 步） | 【已验证】docs/s1-score-anchor-implementation-report.md §6 |
| ⚠️ tag 陷阱 | 不要用任何历史 tag 部署（V12.1 教训：tag 落后 HEAD） | 【已验证】 |

**本迁移的精确内容**（【已验证】`prisma/migrations/20260913000000_score_loss_evidence/migration.sql`）：
1 × `CREATE TABLE "ScoreLossItem"`（含 `(scoreEntryKind, scoreEntryId, questionId)` 唯一索引 + `nodeId` 索引 + `userId` FK ON DELETE CASCADE）+ 1 × `ALTER TABLE "Question" ADD COLUMN "maxScore" DOUBLE PRECISION`（可空）。**零 DROP 既有对象 / 零 RENAME / 零回填**；`Question.maxScore` 历史行全 NULL = 诚实未知。

**回滚影响**：代码回滚 → 旧代码不引用新表/新列，行为逐字节回到部署前（V12.1 先例）；迁移回滚 = `DROP TABLE "ScoreLossItem"` + `ALTER TABLE "Question" DROP COLUMN "maxScore"`——loss 行是**可整体重建的派生投影**，当前分值标注为 0 条，回滚零数据损失；ledger 四表全程不受影响。

---

## 1. 部署前 Preflight（服务器）

```bash
# 1.1 磁盘与容器基线
docker ps                                   # 三容器 healthy；postgres 容器应 Up（数据卷不动）
# 1.2 备份门禁（deploy.sh 自带；若手动部署必须先手动备份）
pg_dump -U kaoyan408 -d kaoyan408 -F c -f /backup/kaoyan408-$(date -u +%Y%m%dT%H%M%SZ).dump s1
# PASS = 备份文件存在且 > 0 字节；FAIL = 停止，不得继续
# 1.3 记录部署前外部基线（回滚判别器）
curl -s http://127.0.0.1/health | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/api/coach/score-loss          # 预期 401（当前生产无此路由 → 实际 404）
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/api/coach/score-anchor-summary # 预期 401（同上）
```

> **判别器**：`/api/coach/score-loss` 部署前 **404**（路由不存在）→ 部署后 **401**（路由注册 + 守卫）。这是本次上线唯一可纯外部确认的判别器（与 G1 的 practice-patterns 404→401 同型）。
> （若部署前已返回 401 而非 404，说明生产已在新代码上——停止并核对版本，**UNVERIFIED**。）

---

## 2. 部署（代码 + 镜像 + 迁移）

```bash
# 2.1 取代码（字面 SHA，绕开服务器 stale refspec —— V12.1 教训）
git fetch origin feature/v3-product-refactor
git ls-remote origin feature/v3-product-refactor        # 记录 SHA = <TARGET>
git switch --detach <TARGET>                            # 字面 SHA，不用 origin/<branch>
# 2.2 确认迁移文件在位
ls prisma/migrations/20260913000000_score_loss_evidence/migration.sql   # PASS = 存在
# 2.3 deploy.sh（含备份门禁 → build:shared → prisma generate → nest build → prisma migrate deploy → 三容器）
bash deploy/deploy.sh 2>&1 | tee /tmp/s1-deploy.log
# PASS 标准（逐条）：
#   备份行出现（kaoyan408-<ts>.dump）
#   build 无 error
#   "All migrations have been successfully applied"（本条即 37→38）
#   三容器 healthy
```

> 若 deploy.sh 版本不含 migrate deploy 步骤，则手动补：
> `DATABASE_URL=<生产DSN> npx prisma migrate deploy` → PASS = `38 migrations found ... successfully applied`。
> **迁移失败（任何一步）= STOP**：数据库处于部分迁移状态时不得继续部署，用备份评估回滚。

---

## 3. 迁移验证（migration ≠ 功能，先验结构）

```bash
docker exec -it <postgres容器> psql -U kaoyan408 -d kaoyan408 -c "\dt" | grep ScoreLossItem
# PASS = ScoreLossItem 出现
docker exec -it <postgres容器> psql -U kaoyan408 -d kaoyan408 -c "\d \"ScoreLossItem\""
# PASS = scoreEntryKind/scoreEntryId/questionId/lossKind NOT NULL；maxScore/earnedScore/lostScore/nodeId 可空；
#        唯一索引 (scoreEntryKind, scoreEntryId, questionId) 存在；userId FK ON DELETE CASCADE
docker exec -it <postgres容器> psql -U kaoyan408 -d kaoyan408 -c "\d \"Question\"" | grep maxScore
# PASS = maxScore | double precision |（可空）
docker exec -it <postgres容器> psql -U kaoyan408 -d kaoyan408 -c \
  "SELECT count(*) AS priced FROM \"Question\" WHERE \"maxScore\" IS NOT NULL;"
# PASS = 0（零回填；任何非零都说明有人写了数据 → 记入报告）
docker exec -it <postgres容器> psql -U kaoyan408 -d kaoyan408 -c \
  "SELECT count(*) FROM prisma_migrations WHERE migration_name LIKE '20260913000000%';"
# PASS = 1
```

---

## 4. HTTP / 功能验证（migration 成功之后才做这节）

```bash
# 4.1 硬门禁（不变量）
curl -s http://127.0.0.1/health
# PASS = 200 且 dataSource:postgresql
# 4.2 新端点：路由注册 + 守卫（401 ≠ 404）
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/api/coach/score-loss            # PASS = 401
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/api/coach/score-anchor-summary  # PASS = 401
# 4.3 回归冒烟（既有端点守卫不变）
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/api/coach/daily-brief           # PASS = 401
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/api/coach/score-evidence        # PASS = 401
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/api/coach/score-opportunity     # PASS = 401
# 4.4 迁移语义检查：评分 API 仍正常（P0-1 收窄不影响合法 150/150 配对）
#   以教师/管理员账号调用 GET /coach/score-evidence → 200 且无 5xx；此步需真实账号 = UNVERIFIED（操作员执行）
# 4.5 前端：新 bundle hash ≠ 部署前记录值，页面 200（P0 触及 web 三组件）
curl -s http://127.0.0.1/ | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1
```

**功能行为证据边界（诚实声明）**：
- 生产 `ScoreLossItem` 行数在首次**真实整卷提交**之前 = 0；`GET /coach/score-loss` 对真实学生返回 `entries: []`/`coverage 0` 是**设计内诚实缺席**，不是故障。
- 业务行为（提交 → 派生 → 投影 → 守卫 → 幂等）已由 `scripts/integration-score-loss.mjs` 在真实 PostgreSQL + HTTP 上 9 步验证（本地，同代码）；生产侧"DEPLOYED AND VERIFIED"的完整判定还需要一次真实学生提交后的外部观察（Owner 可选执行）。
- 迁移验证（§3）+ 路由守卫（4.2）+ 回归冒烟（4.3）全部 PASS → 可判定 **S1 = DEPLOYED（路由与迁移层验证）**；**DEPLOYED AND VERIFIED**（业务层）需 4.4 + 一次真实提交观察。

---

## 5. 回滚预案（只列触发与动作）

| 触发 | 动作 |
|---|---|
| 迁移失败/部分应用 | STOP；`prisma migrate resolve` 评估；必要时从 §1.2 备份恢复（最后手段） |
| 部署后 5xx / health 异常 | `bash deploy/rollback.sh`（或字面 SHA 切回上一生产 commit）+ 重建镜像；**新表/新列可保留**（旧代码不引用） |
| 需要彻底回滚迁移 | `DROP TABLE "ScoreLossItem"; ALTER TABLE "Question" DROP COLUMN "maxScore";`（当前零标注，零数据损失；loss 行可由派生重建） |
| 任何情况 | **不改写 ledger 四表既有行**（历史事实保护） |

## 6. 本次部署不要做的三件事

1. **不开任何开关**：`TRANSFER_PROBE_ENABLED` 保持 false；`MASTERY_SEMANTICS` 保持不出现在环境里（C1 结构性 OFF）。
2. **不做任何回填**：不批量写 `Question.maxScore`（内容标注走独立内容任务，带 provenance 与 dry-run）；不手写 ScoreLossItem 行（系统自动派生是唯一来源）。
3. **不混用旧 runbook 的"纯代码部署"结论**：本次含迁移，`migrate status` 必须从 37 → 38 逐条核对。

## 7. 部署后状态判定

```text
§1-§4 全 PASS，且 4.4 真实账号抽查通过   → S1 = DEPLOYED AND VERIFIED（路由/迁移/回归层）＋ 业务层待首次真实提交观察
仅 §1-§3 PASS（迁移+构建+容器）          → S1 = DEPLOYED（基础设施层）
任何 FAIL                                → FAILED → 按 §5 回滚，S1 = CODE READY（保持）
```
