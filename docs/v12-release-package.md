# V12 Release Package — v12.0.0-score-improvement-engine

> 生成日期：2026-09-10 · 分支 `feature/v3-product-refactor`
> 状态：**代码就绪，部署 PENDING（所有者执行）** —— 本会话**无服务器 SSH 凭据**，按任务 §5 不伪造部署
> 适用：把生产从 `43b715e` 前后构建升级到 V12 HEAD

---

## 1. 发布内容

| 项 | 值 |
|---|---|
| 目标 ref | `feature/v3-product-refactor` |
| 发布提交 | 见 §6（tag `v12.0.0-score-improvement-engine`） |
| 迁移 | **+1**：`20260911000000_question_rubric`（`ALTER TABLE "Question" ADD COLUMN "rubric" JSONB`） |
| 迁移类型 | 纯增量、可空、无回填、旧服务忽略未知列 |
| V12 新增端点 | 9 个（5 个 coach 影子/校准 + 2 个 rubric + 既有 4 个 V11-M2+ 一并上线） |

### 1.1 必须知道的**行为变更**

| 变更 | 影响 | 是否需回滚 |
|---|---|---|
| `Question.rubric` 新增列 | 无 rubric 的题目行为**逐字节不变** | 否 |
| 新端点 | 纯新增，不改既有路由 | 否 |
| 新证据写入（`EVIDENCE_RECORDED` 事件） | 新增 `UserEvent` 行；**不改任何既有写路径与掌握度语义** | 否 |
| **M3 复习语义** | **未变更**（刻意保持 Shadow）——`applyReview` 行为与 V11 完全一致 | 不适用 |

> **本次发布不含任何掌握度/推荐排序语义变更。** 这是刻意的：M3 Phase C 切换就绪度为 NOT READY（见 `docs/v12-failure-classification.md` §5）。

---

## 2. 部署前检查（服务器上执行）

```bash
cd /srv/kaoyan408                     # 以实际部署路径为准
git rev-parse HEAD                    # 记录当前提交，作为回滚点
docker compose --env-file .env.production -f compose.production.yml ps
curl -fsS http://127.0.0.1/health     # 记下当前健康状态
```

**必须记录三项**（回滚需要）：
1. 当前生产提交：`__________`（预期为 `43b715e` 前后）
2. 当前健康：`__________`
3. 迁移状态：`docker compose --env-file .env.production -f compose.production.yml exec -T app npx prisma migrate status --schema prisma/schema.prisma`

---

## 3. 部署（推荐：使用既有脚本）

```bash
./deploy/tencent-ip/deploy.sh
```

该脚本（183 行）已内含：校验 `.env.production`（`PUBLIC_IP`/`POSTGRES_USER`/`PASSWORD≥24`/`POSTGRES_DB`/`JWT_SECRET≥32`/`BACKUP_RETENTION_DAYS`）→ 拒绝在既有 postgres 不健康时部署 → **部署前备份** → `docker compose --env-file .env.production -f compose.production.yml up -d --build --wait` → 网关 `/health` 检查 → 播种 408 + 知识点映射 → 重启 app。

### 3.1 手工等价流程（脚本不可用时）

```bash
# 关键：显式 refspec。服务器 git 默认 pull 会命中代理陈旧 ref（V6.3 报告 §6/§7 的教训）
git fetch origin feature/v3-product-refactor
git reset --hard FETCH_HEAD

# 备份（见 scripts/backup-postgres.mjs 的宿主等价命令）
docker compose --env-file .env.production -f compose.production.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "backup-pre-v12-$(date +%Y%m%d%H%M%S).sql"

# 重建并等待健康
docker compose --env-file .env.production -f compose.production.yml up -d --build --wait
```

迁移由容器启动流程执行（Dockerfile 先 `prisma migrate deploy` 再启动 NestJS）。

---

## 4. 部署后验证（必须逐项执行）

### 4.1 基础

```bash
curl -fsS http://127.0.0.1/health          # 期望 200，overall ok
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1/api/coach/learning-evidence
```

### 4.2 端点注册验证（**401 ≠ 404**）

未带令牌时应返回 **401（已注册且被守卫）**，而**不是 404（未注册）**：

```bash
for p in \
  /api/coach/learning-evidence \
  /api/coach/recommendation-funnel \
  /api/coach/review-semantics-shadow \
  /api/coach/score-opportunity \
  /api/coach/score-calibration \
  /api/admin/data-quality \
  /api/coach/task-evidence \
  /api/coach/mastery-calibration \
  /api/coach/outcome-tracking
do
  printf '%-45s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1$p)"
done
# 期望：全部 401
```

### 4.3 迁移验证

```bash
docker compose --env-file .env.production -f compose.production.yml exec -T app \
  npx prisma migrate status --schema prisma/schema.prisma
# 期望：Database schema is up to date!（35 个迁移）
```

### 4.4 前端

```bash
curl -fsS http://127.0.0.1/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1
```
—— 记录新的 bundle 名，并在浏览器刷新后确认页面可加载（V12-M2b 的「学习证据台账」应出现在**报告 → 总览**页）。

### 4.5 rubric 列验证（只读 SQL）

```bash
docker compose --env-file .env.production -f compose.production.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT column_name, data_type, is_nullable FROM information_schema.columns
   WHERE table_name='Question' AND column_name='rubric';"
# 期望：rubric | jsonb | YES
```

---

## 5. 回滚

### 5.1 回滚代码（保留 new 列与新增事件行）

```bash
git reset --hard <部署前记录的提交>
docker compose --env-file .env.production -f compose.production.yml up -d --build --wait
```
`Question.rubric` 列与新增的 `UserEvent` 行**不会**影响旧代码：旧服务忽略未知列；证据事件是 append-only，旧代码不读取它们。

### 5.2 回滚迁移（仅在确认不需要 rubric 内容时）

```sql
ALTER TABLE "Question" DROP COLUMN "rubric";
```
> **已记录的评分不会因此失效**：每条评分在 `UserEvent.payload.detail` 中携带自己的 `rubricVersion` 与 `rubricHash`，删列后历史评分仍可解释。

### 5.3 回滚数据

用 §3.1 的备份：`psql < backup-pre-v12-*.sql`（注意：会丢弃部署后的新数据，慎用）。

---

## 6. 发布提交与 tag

```bash
git tag -a v12.0.0-score-improvement-engine -m "V12 Score Improvement Engine (code complete; production deploy owner-gated)"
git push origin v12.0.0-score-improvement-engine
```

---

## 7. 部署**不要**做的事

| 禁止 | 原因 |
|---|---|
| 切换 M3 复习语义 | 所有者明确指令；队列证据显示就绪度 NOT READY（方向一致率 64.3% < 70%，效果随掌握区变号） |
| 修改 `integration-postgres.mjs:1254` 的既有断言 | 属既有债务；改断言会让真实回归失去拦截面 |
| 用 `git reset --hard` 清理未知改动 | 违反 AGENTS.md §9 与任务 §19 |

---

## 8. 部署后应观测的指标（首个观察窗）

| 指标 | 来源 | 期望 |
|---|---|---|
| `EVIDENCE_RECORDED` 事件量 | `SELECT type, count(*) FROM "UserEvent" GROUP BY type` | 随学生使用增长；含 `review.marked` / `review.recalled` / `task.completed` |
| 任务完成证据判定分布 | `GET /coach/task-evidence`（学生令牌） | `improved` / `practiced` / `insufficient_data` 三类都出现（`insufficient_data` 出现是**预期**，不是故障） |
| 曝光遥测是否流动 | `GET /coach/recommendation-funnel` | `exposureTelemetryAvailable` 转为 `true` 后方有曝光数字；此前为 `null`（**不是 0**） |
| 校准样本量 | `GET /coach/score-calibration` | `pairedCount` 累积到 ≥5 前**不给 MAE**（预期行为） |
| 复习语义分歧 | `GET /coach/review-semantics-shadow`（teacher/admin） | 持续积累；用于最终回答"是否压缩分布是我们想要的" |
