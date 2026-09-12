# G1 生产部署 Runbook（人工执行）

> 日期：2026-09-12 ｜ 性质：**DEPLOYMENT RUNBOOK（人工执行；本文件由代理生成，代理不执行服务器操作）**
> 部署目标：`feature/v3-product-refactor` @ **`066e4eac7b7786ed16de4b1f1be8d9017e83dded`**
> 事实来源：`deploy/tencent-ip/deploy.sh`(183 行)、`deploy/tencent-ip/rollback.sh`(102 行)、`deploy/tencent-ip/backup.sh`、`deploy/tencent-ip/nginx.conf`、`compose.production.yml`(153 行)、`Dockerfile`、`prisma/migrations/`。
> **每个命令都来自仓库真实实现，未猜测。** 无法从仓库证明的检查项一律标注 `需在服务器上确认`。

---

## 0. 部署性质与风险（先读这一节）

> **部署目标与"最新 HEAD"的区别（重要）**：本 Runbook 部署的是 **`066e4eac`**。
> `066e4eac` 之后还有若干 commit（本 Runbook 自身 + Phase B 的只读内容审计工具与报告），
> 它们**不包含任何生产代码变更**（新增的 `probe-content.ts` 是纯校验函数、仅被只读脚本与测试引用；
> 无 API 路由、无 prisma、无前端、无 compose 改动）。因此**不必**为它们重新部署，
> `066e4eac` 是本次的正确目标。若后续把它们一并部署，需重新走一遍本 Runbook 的验证。

| 项 | 事实 | 依据 |
|---|---|---|
| 变更范围 | **61 个文件**，全部为代码/文档/测试/配置 | `git diff --name-only 7832a5b5..066e4eac` |
| **数据库迁移** | **0 个** —— G1 发布区间内 `prisma/` **零改动** | `git diff --stat 7832a5b..066e4eac -- prisma/` 输出为空 |
| **依赖变更** | **0 个** —— 四个 `package.json` 在本区间无改动 | `git diff … -- package.json apps/*/package.json packages/*/package.json` 输出为空 |
| 迁移总数 | 磁盘 **37** 个，与生产上次部署记录的 `37 up to date` 一致 | `prisma/migrations/` 目录数 |
| 容器重建 | `app` 与 `gateway`（`gateway` 前端**有变更**：本次区间含 `apps/web` 改动） | `compose.production.yml:63,130` |
| `postgres` 容器 | **不重建**（无 compose/镜像变更影响它） | `compose.production.yml:2`（image 固定 `postgres:16-alpine`） |
| 回滚难度 | 低：无迁移需回滚，`rollback.sh` 可回到任意历史 commit | `rollback.sh:62`（脚本自述"迁移不会自动回滚"——本次不涉及） |

**关键结论：本次是纯代码部署，无迁移、无依赖变更。** 唯一的"不可逆"风险面不存在；回滚只需切回旧 commit 重建镜像。

---

## 1. 部署前准备（A0）

### 步骤 0.1 — 确认服务器仓库与目标 commit

| 项 | 内容 |
|---|---|
| **目的** | 确认服务器上的检出可到达目标 commit，且工作区干净（`rollback.sh` 会拒绝脏工作区） |
| **命令** | `cd ~/kaoyan-408-score-boost && git status --short && git rev-parse HEAD && git rev-parse --verify 066e4eac7b7786ed16de4b1f1be8d9017e83dded^{commit}` |
| **预期输出** | 第一行为空（干净）；HEAD 打印当前生产 commit（**记下来，这是回滚锚点**）；第三行打印 `066e4eac7b7786ed16de4b1f1be8d9017e83dded` |
| **PASS** | 工作区无输出 **且** 目标 commit 可解析 |
| **FAIL** | 工作区有文件 → **停止**，先处理（`git stash` 或人工确认）；目标 commit 无法解析 → 执行步骤 0.2 |
| **回滚** | 不需要（只读步骤） |

> 注意：本仓库根目录不是仓库路径时的实际路径 `需在服务器上确认`。用 `find ~ -maxdepth 3 -name compose.production.yml -printf '%h\n'` 定位。

### 步骤 0.2 — 取回目标 commit（若 0.1 未解析到）

| 项 | 内容 |
|---|---|
| **目的** | 把远端对象取回本地（**不要**依赖 `origin/<branch>` 的 stale ref） |
| **命令** | `cd ~/kaoyan-408-score-boost && git fetch origin feature/v3-product-refactor && git rev-parse FETCH_HEAD` |
| **预期输出** | `066e4eac7b7786ed16de4b1f1be8d9017e83dded` |
| **PASS** | `FETCH_HEAD` == 目标 SHA |
| **FAIL** | 不等 → **停止**，报告实际 SHA（**不要**用"看起来差不多"的 commit 部署） |
| **回滚** | 不需要 |

> 历史教训（已修复，仍建议按此执行）：该服务器曾出现 `git fetch <branch>` 只更新 `FETCH_HEAD`、`origin/<branch>` 停留在 161 个 commit 之前的情况。因此**一律用字面 SHA 校验**，不要用分支名当前指向。

### 步骤 0.3 — 确认运行环境

| 项 | 内容 |
|---|---|
| **目的** | 确认 `deploy.sh` 的硬依赖齐全（脚本自身会检查，此处提前确认） |
| **命令** | `docker --version && docker compose version && curl --version | head -1 && df -h /var/lib/docker | tail -1` |
| **预期输出** | Docker 版本号；Compose 版本号；curl 版本号；Docker 数据盘有可用空间 |
| **PASS** | 四个命令均成功，磁盘可用空间明显大于当前镜像体积 |
| **FAIL** | 缺 docker/compose/curl → 先安装；磁盘将满 → 先 `docker system prune` 并**人工复核** |
| **回滚** | 不需要 |

依据：`deploy.sh:36-42`（rollback 脚本同款检查）、`deploy.sh:98-135`（env 校验）、`deploy.sh:137`（compose config 校验）。

---

## 2. 配置门禁（A2）—— 必须先过

### 步骤 1.1 — 确认 `.env.production` 存在且通过校验

| 项 | 内容 |
|---|---|
| **目的** | `deploy.sh` 会从仓库根 `.env.production` 读取并强校验 6 个变量 |
| **命令** | `cd ~/kaoyan-408-score-boost && test -f .env.production && echo ENV_OK && grep -c . .env.production` |
| **预期输出** | `ENV_OK` + 行数 |
| **PASS** | 文件存在 |
| **FAIL** | 不存在 → 从 `deploy/tencent-ip/.env.production.example` 复制并填真实值，`chmod 600 .env.production` |
| **回滚** | 不需要 |

`deploy.sh` 的校验规则（`deploy.sh:98-135`）：`PUBLIC_IP` 必须是全局可达 IPv4；`POSTGRES_USER`/`POSTGRES_DB` 为 `[A-Za-z_][A-Za-z0-9_]*` 且 ≤63；`POSTGRES_PASSWORD` ≥24 且仅 `[A-Za-z0-9_-]`，不得为占位串；`JWT_SECRET` ≥32 且非占位串；`BACKUP_RETENTION_DAYS` ∈ [1,365]。

### 步骤 1.2 — **G1 配置门禁**：probe OFF / C1 OFF（本次部署的核心断言）

| 项 | 内容 |
|---|---|
| **目的** | 确认生产**不会**开启 Transfer Probe，且 C1 语义**未启用** |
| **命令** | `cd ~/kaoyan-408-score-boost && docker compose --env-file .env.production -f compose.production.yml config --format json > /tmp/g1cfg.json && grep -o '"TRANSFER_PROBE_ENABLED":"[a-z]*"' /tmp/g1cfg.json && (grep -q 'MASTERY_SEMANTICS' /tmp/g1cfg.json && echo MASTERY_PRESENT || echo MASTERY_ABSENT) && (grep -q '"c1"' /tmp/g1cfg.json && echo C1_LEAK || echo C1_CLEAN)` |
| **预期输出** | `"TRANSFER_PROBE_ENABLED":"false"` ／ `MASTERY_ABSENT` ／ `C1_CLEAN` |
| **PASS** | **三者全部符合**。这就是期望值，来自 `compose.production.yml` 的 `app.environment` 白名单（`TRANSFER_PROBE_ENABLED: ${TRANSFER_PROBE_ENABLED:-false}`，且**没有** `MASTERY_SEMANTICS` 条目） |
| **FAIL** | 出现 `"true"` → 检查宿主是否 `export TRANSFER_PROBE_ENABLED=true`（会被 compose 插值）；出现 `MASTERY_PRESENT` 或 `C1_LEAK` → **停止部署**并报告 |
| **回滚** | 不需要（只读）。若失败，撤销宿主的 `export` / `.env.production` 中的相关行 |

> 白名单是**结构性保证**：`compose.production.yml` 的 `app.environment` 是显式枚举，宿主 shell 里 `export MASTERY_SEMANTICS=c1` **无法**渗透进容器。因此只要渲染结果里该变量不存在，`MASTERY_SEMANTICS` 在容器内必然为空 → 单点解析回落 `legacy`。
> 本步骤只输出**布尔结论与固定字符串**，不打印任何 secret（`grep -o` 只取该键，`/tmp/g1cfg.json` 含密码，**用后删除**：`rm -f /tmp/g1cfg.json`）。

### 步骤 1.3 — 清理临时文件

| 项 | 内容 |
|---|---|
| **目的** | 渲染出的 compose 配置含数据库密码与 JWT secret，不得留在磁盘 |
| **命令** | `rm -f /tmp/g1cfg.json && ls /tmp/g1cfg.json 2>&1 | head -1` |
| **预期输出** | `ls: cannot access '/tmp/g1cfg.json': No such file or directory` |
| **PASS** | 文件不存在 |
| **FAIL** | 删除失败 → 人工确认后再继续 |
| **回滚** | 不需要 |

---

## 3. 部署（A4）—— 人工执行

### 步骤 2.1 — 切到目标 commit（**字面 SHA**）

| 项 | 内容 |
|---|---|
| **目的** | 把检出固定到目标 commit。`deploy.sh` **不做任何 git 操作**（`deploy.sh` 全文无 `git` 调用），因此仓库版本必须由人工切换 |
| **命令** | `cd ~/kaoyan-408-score-boost && git switch --detach 066e4eac7b7786ed16de4b1f1be8d9017e83dded && git rev-parse HEAD` |
| **预期输出** | `HEAD is now at 066e4eac ...` + `066e4eac7b7786ed16de4b1f1be8d9017e83dded` |
| **PASS** | 打印的 HEAD == 目标 SHA |
| **FAIL** | 报"工作区有改动" → 回到步骤 0.1 处理 |
| **回滚** | `git switch --detach <步骤 0.1 记录的旧 SHA>`（此时尚未重建镜像，生产无变化） |

### 步骤 2.2 — 执行部署脚本

| 项 | 内容 |
|---|---|
| **目的** | 一条命令完成：备份 → 构建 → 起容器 → 健康等待 → 幂等 seed → 重启 app |
| **命令** | `cd ~/kaoyan-408-score-boost && sh deploy/tencent-ip/deploy.sh` |
| **预期输出（按脚本真实顺序）** | ① `Creating a database backup before deployment...`（`deploy.sh:156-157`）② 构建日志 ③ compose `up -d --build --wait` 无报错（`deploy.sh:165`）④ 无 `Gateway health check did not succeed`（`deploy.sh:167-170`）⑤ `Seeding 408 evidence data (idempotent, safe on every deploy)...`（`:172`）⑥ `Seeding knowledge point -> catalog node bridge (idempotent, safe on every deploy)...`（`:175`）⑦ `Restarting app so catalog display names take effect...`（`:179`）⑧ `Deployment succeeded. Open: http://<PUBLIC_IP>`（`:182`）⑨ `docker compose ... ps` 表格，`postgres`/`app`/`gateway` 均为 `Up ... (healthy)` |
| **PASS** | 脚本退出码 0，且最后打印 `Deployment succeeded`，且 `ps` 中三个服务 healthy |
| **FAIL** | 见 §7 failure playbook。脚本 `set -eu`（`deploy.sh:2`），任一步失败即中止 |
| **回滚** | 见 §6（`rollback.sh`） |

**关于迁移**：脚本**不显式**跑迁移；迁移由 app 容器启动命令自动执行 —— `Dockerfile:49`：
`sh -c "cd apps/api && npx prisma migrate deploy --schema ../../prisma/schema.prisma && exec node dist/main.js"`。
本次**无新迁移**，该命令应为 no-op。

**关于备份**：仅当发现既有 `postgres` 容器且状态 `running`/health `healthy` 时才备份（`deploy.sh:147-157`）；若发现存在数据卷但找不到容器，脚本会**拒绝**部署（`deploy.sh:158-160`）。备份文件落宿主 `<仓库>/backups/`（`compose.production.yml:54` → `./backups:/backups`），命名 `kaoyan408-<UTC>.dump` + `.sha256`（`backup.sh:18-20`）。

---

## 4. 部署后验证 — 服务器侧（A5）

### 步骤 3.1 — 容器与健康

| 项 | 内容 |
|---|---|
| **目的** | 确认三容器健康、网关可达 |
| **命令** | `cd ~/kaoyan-408-score-boost && docker compose --env-file .env.production -f compose.production.yml ps && curl -fsS http://127.0.0.1/health` |
| **预期输出** | `app` 有 `(healthy)`；`gateway` `Up`；`postgres` `Up ... (healthy)`。health JSON：`{"status":"ok","operational":{...,"overall":"ok"},"service":"kaoyan-408-api","version":"1.0.0","dataSource":"postgresql","uptimeSec":<小数值>,"checks":{"database":"connected"},"timestamp":"..."}` |
| **PASS** | `status=="ok"` 且 `dataSource=="postgresql"` 且 `checks.database=="connected"` 且 `uptimeSec` **很小**（说明刚重启，不是旧进程） |
| **FAIL** | `503` + `status:"degraded"` → 数据库连接失败，查 `docker compose logs app`；`uptimeSec` 很大 → 容器未真正重建 |
| **回滚** | 见 §6 |

依据：`apps/api/src/health.controller.ts:11-57`（503 degraded 分支在 `:28-37`）。

### 步骤 3.2 — 迁移状态

| 项 | 内容 |
|---|---|
| **目的** | 确认 37 个迁移全部已应用且无待应用 |
| **命令** | `cd ~/kaoyan-408-score-boost && docker compose --env-file .env.production -f compose.production.yml exec -T app sh -c 'cd apps/api && npx prisma migrate status --schema ../../prisma/schema.prisma'` |
| **预期输出** | `37 migrations found in prisma/migrations` + `Database schema is up to date!` |
| **PASS** | 迁移数 **37** 且 `up to date` |
| **FAIL** | 出现 `following migration have not yet been applied` → 容器启动时迁移失败，查 `docker compose logs app` |
| **回滚** | 见 §6（**注意**：本次无新迁移，故无需回滚数据库） |

### 步骤 3.3 — C1 语义（A6）

| 项 | 内容 |
|---|---|
| **目的** | 确认 mastery 语义为 `legacy`，C1 **未启用** |
| **命令** | `cd ~/kaoyan-408-score-boost && docker compose --env-file .env.production -f compose.production.yml logs app --since 10m 2>&1 | grep -i 'Mastery semantics' | tail -1` |
| **预期输出** | 形如 `... [Bootstrap] Mastery semantics: legacy — legacy（现行生产语义）（未设置，使用默认）` |
| **PASS** | 输出包含 **`legacy`**，且**不包含** `c1` |
| **FAIL** | 出现 `c1` → **立即回滚**并报告（C1 未获批准） |
| **回滚** | §6 |

### 步骤 3.4 — G1 路由已注册（非 404）

| 项 | 内容 |
|---|---|
| **目的** | 证明 G1 新增的 2 个端点已注册且被守卫（401 而非 404） |
| **命令** | `for p in /api/coach/practice-patterns /api/coach/transfer-probes /api/coach/score-evidence; do printf '%s -> ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1$p"; done` |
| **预期输出** | 三行均 `401` |
| **PASS** | 全部 `401`（注册 + 守卫生效） |
| **FAIL** | 任一 `404` → 镜像未真正重建（回到步骤 3.1 检查 `uptimeSec`） |
| **回滚** | §6 |

`GET /coach/practice-patterns` 为 G1 新增（`apps/api/src/study/daily-brief.controller.ts`），`POST /coach/exam-date` 亦为 G1 新增（`apps/api/src/score-anchor/score-anchor.controller.ts`）。**注意**：`POST` 端点用 `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1/api/coach/exam-date`，预期同为 `401`。

### 步骤 3.5 — Transfer Probe 保持关闭（A7）

| 项 | 内容 |
|---|---|
| **目的** | 确认生产 probe 功能位为 **false**（生产题池 = 0，不得让学生进入无题可投递的流程） |
| **命令** | `cd ~/kaoyan-408-score-boost && docker compose --env-file .env.production -f compose.production.yml exec -T app sh -c 'node -e "console.log(\"TRANSFER_PROBE_ENABLED=\"+(process.env.TRANSFER_PROBE_ENABLED??\"<unset>\"))"'` |
| **预期输出** | `TRANSFER_PROBE_ENABLED=false`（或 `<unset>`，两者都表示 OFF） |
| **PASS** | 输出为 `false` 或 `<unset>`；**绝不允许** `true` |
| **FAIL** | `true` → 回滚并报告（题池为 0，会让学生看到空的复测流程） |
| **回滚** | §6 |

配套只读断言（学生端不见探针卡）：`curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/api/coach/transfer-probes` → `401`（未登录）。**已登录**行为由 §5 的浏览器步骤覆盖。

---

## 5. 部署后验证 — G1 产品面（A5 重点）

以下需要**浏览器**（学生账号）或带 token 的 curl。全部为**只读**观察。

### 步骤 4.1 — Reason Integrity：学生 WHY 只有 evidenced 理由

| 项 | 内容 |
|---|---|
| **目的** | 确认学生看到的主 WHY **不含**考频/趋势等非证据文案，且无 evidenced 理由时显示"证据不足" |
| **命令（UI）** | 打开 `http://43.128.30.191` → 用学生账号登录 → 首页「今天的主行动」卡 → 看「为什么推荐（你的学习证据）」与「排序参考（考试统计，不是你的学习证据）」是否**分开两块** |
| **命令（API）** | `curl -s -H "authorization: Bearer <STUDENT_TOKEN>" http://43.128.30.191/api/today/plan` |
| **预期输出** | UI：只有一块「为什么推荐（你的学习证据）」，其条目为 `掌握度偏低 / 正确率偏低 / 反复出错 / 到期复习` 之一；若无证据，则卡片显示 `当前证据不足：…`。API：每个 `priorityTasks[].reason` 为中文自然句或 `当前证据不足…`；**不得**出现 `LOW_MASTERY` 这类英文码、`recommendation:` 机器串、或 `近3年高频考点 / 考频上升 / 前置知识未掌握 / 临近考试 / 考频证据不足` 这些非证据文案 |
| **PASS** | 上述两条同时成立 |
| **FAIL** | 出现英文码/机器串/非证据文案 → **回滚**并报告（这是本次加固的核心不变量） |
| **回滚** | §6 |

> 单行自检（把 token 与域名替换）：`curl -s -H "authorization: Bearer $T" http://43.128.30.191/api/today/plan | grep -Eo '"(reason)":"[^"]*"' | grep -E 'LOW_|HIGH_|recommendation:|近3年高频考点|考频上升|临近考试|考频证据不足' && echo WHY_LEAK || echo WHY_CLEAN` → 期望 `WHY_CLEAN`。

### 步骤 4.2 — Today Mission：只有一个 PRIMARY

| 项 | 内容 |
|---|---|
| **目的** | 首页信息层级为 PRIMARY / SECONDARY / CONTEXT 三层，只有 1 张主行动卡 |
| **命令（UI）** | 首页观察：是否存在**唯一**标题为「今天的主行动」的卡片，且它带唯一的主按钮「开始这一步」；下方是否有一个可折叠的「更多信息与入口（今日完整计划 · 推荐依据 · 学习状态）」 |
| **预期输出** | 主行动卡 **恰好 1 张**；其余（今日简报、今日学习计划、迁移复测、AI 洞察、快捷入口、完整计划）位于其下或被折叠在 CONTEXT 内 |
| **PASS** | 主行动卡唯一，且折叠区存在 |
| **FAIL** | 出现 2 张以上"主行动"或多处并列主按钮 → 报告（不阻断回滚判断，但属 G1 验收项） |
| **回滚** | 视严重程度；若仅为观感问题可不回滚，但需报告 |

### 步骤 4.3 — HOW：首次行为提供说明

| 项 | 内容 |
|---|---|
| **目的** | 首次进入某功能时出现一次性使用说明（不是弹窗轰炸） |
| **命令（UI）** | 新学生账号或清 localStorage 后：①登录后看是否出现「这套系统的 7 条使用约定」卡（可点「开始使用」）②进入题库训练首次答题看是否出现「先独立作答，再看解析」③进入错题本首次看是否出现「先记录自己为什么错，再复习」 |
| **预期输出** | 每处出现**一张**说明卡，含「为什么 / 怎么做才算做对（≥2 条）/ 做完系统得到什么」；点「知道了」后**当天不再重复出现** |
| **PASS** | 至少 2 处首次说明出现，且可关闭、不阻断任何流程 |
| **FAIL** | 无任何说明 → 报告；或说明卡阻断主流程 → 报告（非阻断是硬要求） |
| **回滚** | 不需要（纯前端呈现） |

### 步骤 4.4 — VERIFY：完成 ≠ 学会

| 项 | 内容 |
|---|---|
| **目的** | 完成动作后系统明说"完成标记不等于能力证据" |
| **命令（UI）** | ①首页任务列表**底部**应有 `完成 ≠ 学会：系统只承认它观测到的判分作答，完成标记本身不构成能力证据。` ②完成一个任务后，该任务行应出现证据 chip（`掌握度 ↑ / 已练习 / 已练·未见提升 / 完成·无作答证据`）③答完一题后展开「学习影响与推荐依据」，应出现「本次结果如何被验证」区块 |
| **预期输出** | 三处至少两处可见；无观测时文案为 `能力验证：尚未完成——还需要一次能观测到作答的练习。` |
| **PASS** | 至少 2 处按预期呈现 |
| **FAIL** | 出现"学习成功 / 你已经掌握"类措辞 → 报告 |
| **回滚** | 不需要 |

### 步骤 4.5 — NEXT：主要动作后有明确下一步

| 项 | 内容 |
|---|---|
| **目的** | 每个主要结果都带可点击的 NEXT + 理由，且**永不**出现"暂无操作" |
| **命令（UI）** | ①主行动卡底部有「下一步：<动作>」按钮 + 一行理由 ②今日任务列表底部有「下一步：<动作>」+ 理由 ③若探针可投递，复测结果页有 NEXT（答错→错题复盘；答对→阶段测评） |
| **预期输出** | 至少 ①② 可见；按钮点击后真的跳到对应区 |
| **PASS** | NEXT 可见且可达；无可靠建议时显示**显式原因**而非空白 |
| **FAIL** | 出现"暂无操作"或按钮无反应 → 报告 |
| **回滚** | 不需要 |

### 步骤 4.6 — examDate：可读可写、派生一致

| 项 | 内容 |
|---|---|
| **目的** | 考试日期可设置，且「距离考试 X 天」由 examDate 派生（不是手填 remainingDays） |
| **命令（UI）** | 报告页 → 「我的考试日期」卡：设置一个未来日期并保存 |
| **预期输出** | 保存后该卡显示 `已保存：距离考试 N 天`；同时「成绩锚点」卡的 `考试日期` 变为刚设置的日期 |
| **命令（API 校验）** | `curl -s -X POST -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{"examDate":"2020-01-01"}' http://43.128.30.191/api/coach/exam-date -o /dev/null -w '%{http_code}\n'` → 期望 `400`（过去日期被拒） |
| **PASS** | UI 保存成功且天数派生正确；过去日期返回 `400` |
| **FAIL** | 保存报错或天数与日期不符 → 报告 |
| **回滚** | 不需要 |

### 步骤 4.7 — 前端 bundle 已更新

| 项 | 内容 |
|---|---|
| **目的** | 确认浏览器拿到的是本次构建的前端（不是 nginx/浏览器缓存旧文件） |
| **命令** | `curl -s http://43.128.30.191/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1` |
| **预期输出** | 一个 `assets/index-<hash>.js` 名称。**记录该 hash**，与部署前记录的 hash 比较 |
| **PASS** | hash 与部署前不同（本次含 `apps/web` 改动） |
| **FAIL** | 完全相同 → 前端未重建；检查 `gateway` 镜像是否为全 CACHED（若 `apps/web` 确实有变更则应重新构建） |
| **回滚** | 浏览器侧先 `Ctrl+Shift+R` 强制刷新再判断 |

> 已知事实：本次发布区间**包含** `apps/web` 改动，因此 `gateway` 镜像**应当**重建。若构建日志显示 `gateway` 全 CACHED，需排查（此前 V12.1 出现过合法的全 CACHED，因为区间内 `apps/web` 无改动——本次不同）。

---

## 6. 回滚（§6）

### 触发条件

任一项成立即回滚：步骤 3.1 健康非 ok / 3.2 迁移异常 / 3.3 出现 `c1` / 3.5 出现 `true` / 4.1 出现 WHY 泄漏 / 页面整体不可用。

### 步骤 5.1 — 回滚到旧 commit

| 项 | 内容 |
|---|---|
| **目的** | 切回部署前记录的 commit 并重建 |
| **命令** | `cd ~/kaoyan-408-score-boost && sh deploy/tencent-ip/rollback.sh <步骤 0.1 记录的旧 SHA>` |
| **预期输出** | `Important: database migrations are not rolled back automatically.` → `Creating a database backup before rollback...` → 重建 → 健康等待 → 成功信息 |
| **PASS** | 脚本退出 0 且 `curl -fsS http://127.0.0.1/health` 返回 `status:"ok"` |
| **FAIL** | 脚本自带 `trap`（`rollback.sh:74-88`）会**自动恢复原 commit 并重建**；若自动恢复也无法确认健康，脚本会提示 `Inspect Docker Compose logs immediately` |
| **回滚** | 本步骤即回滚 |

**重要**：`rollback.sh:56-57` 要求**工作区干净**。当前处于 `git switch --detach`（干净），符合要求。若部署期间产生过临时文件需先清理。

**迁移**：本次部署**无新迁移**，因此"迁移不会自动回滚"这一限制**不影响本次回滚**。

### 步骤 5.2 — 回滚后确认

| 项 | 内容 |
|---|---|
| **目的** | 确认生产回到部署前状态 |
| **命令** | `cd ~/kaoyan-408-score-boost && git rev-parse HEAD && curl -fsS http://43.128.30.191/health` |
| **预期输出** | HEAD == 步骤 0.1 记录的旧 SHA；health `status:"ok"` |
| **PASS** | 两者均符合 |
| **FAIL** | 仍不健康 → 人工介入查 `docker compose logs --tail=200 app` |
| **回滚** | — |

---

## 6b. 部署前基线（代理已从外部实测，2026-09-12T11:15Z）

部署前生产实测（外部 HTTP，未经登录）：

```text
GET http://43.128.30.191/health
  → {"status":"ok","operational":{"database":"connected","aiProvider":"configured",
     "embeddingProvider":"configured","overall":"ok"},"service":"kaoyan-408-api",
     "version":"1.0.0","dataSource":"postgresql","uptimeSec":16240,
     "checks":{"database":"connected"},"timestamp":"2026-09-12T11:15:21.424Z"}

GET http://43.128.30.191/            → SPA bundle: assets/index-DlQrn1Hi.js
GET /api/coach/practice-patterns     → 404   ← G1 端点尚未部署（部署后必须变 401）
GET /api/coach/transfer-probes       → 401   ← S2 已部署
GET /api/coach/score-evidence        → 401   ← S1 已部署
```

**这三个状态码是最强的部署判别器**：

| 端点 | 部署前 | 部署后必须 |
|---|---|---|
| `/api/coach/practice-patterns` | **404** | **401** |
| `/api/coach/transfer-probes` | 401 | 401（不变） |
| `/api/coach/score-evidence` | 401 | 401（不变） |

`practice-patterns` 由 404 变 401 是本次部署**唯一**能纯外部确认 G1 代码已上线的信号（其余 G1 能力是行为变更，需登录才能验证）。若部署后仍为 404，说明镜像未真正重建。

前端 bundle 基线：`assets/index-DlQrn1Hi.js` — 部署后**必须不同**。

**回滚锚点**：账本记录的生产 revision 为 `b62903d`（S1+S2 部署），但**必须以步骤 0.1 在服务器上实测的 `git rev-parse HEAD` 为准**。

---

## 7. Failure Playbook

| 症状 | 最可能原因 | 处置 |
|---|---|---|
| `deploy.sh` 报 `PUBLIC_IP is invalid.` | `.env.production` 里 `PUBLIC_IP` 为空/私网地址 | 修正为 `43.128.30.191` 后重跑（脚本会重新备份） |
| `Existing PostgreSQL container is not running and healthy; refusing deployment` | postgres 挂了 | **不要绕过**；先 `docker compose ps postgres` + `logs postgres`，恢复健康后再部署 |
| `A PostgreSQL data volume exists without a discoverable PostgreSQL container` | 卷在但容器丢失 | **不要绕过**（脚本有意拒绝）；人工确认卷归属后再决定 |
| `Gateway health check did not succeed within 60 seconds` | app 未起来（迁移失败/配置错误） | `docker compose --env-file .env.production -f compose.production.yml logs --tail=200 app`；修因后重跑 |
| `gateway` 容器起不来 | `Dockerfile.web` 构建失败 | 本地已 `build:web` exit 0；服务器磁盘/网络问题可能性大 |
| health 返回 `dataSource:"memory-api"` | 容器内 `DATABASE_URL` 为空 | 说明 compose 环境未注入；检查 `--env-file .env.production` 是否被省略 |
| 页面 404 / 空 | nginx SPA 回退失效 | `nginx.conf` 有 `try_files $uri $uri/ /index.html`（`nginx.conf:27-28`）；查 gateway 日志 |
| 无法用 `https://43.128.30.191` | **预期行为**：nginx 只有 `listen 80`（`nginx.conf:2`），443 虽在 compose 发布但无 TLS server 块 | 用 **http**；HTTPS 需另配（`docs/deploy-to-tencent-ip.md` §9） |

---

## 8. 部署后必须报告的信息（供代理做外部核验）

请把以下 5 项贴回，代理会据此独立核验（外部可验证的部分）：

```text
1) git rev-parse HEAD                → 期望 066e4eac7b7786ed16de4b1f1be8d9017e83dded
2) 步骤 1.2 的三个结论                → TRANSFER_PROBE_ENABLED / MASTERY_ABSENT|PRESENT / C1_CLEAN|LEAK
3) 步骤 3.1 health JSON               → status / dataSource / checks.database / uptimeSec
4) 步骤 3.2 migrate status            → migrations found / up to date?
5) 步骤 3.3 Mastery semantics 行       → 是否含 legacy、是否含 c1
```

---

## 9. 边界声明

- 本 Runbook 由代理生成；**代理不执行任何服务器操作**（A4）。
- 本次部署**不启用** Transfer Probe（`TRANSFER_PROBE_ENABLED=false`，生产题池 = 0）。
- 本次部署**不启用** C1（`MASTERY_SEMANTICS` 不在生产白名单）。
- 本次部署**不影响** ROI / 排序 / Mastery / Score Engine（发布区间内这些文件无改动）。
- 部署完成后**不自动开始** G2 / S3；等待所有者决定。
