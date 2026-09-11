# V12.1 M3 人工生产部署 Runbook

> **本文件由只读审计当前仓库生成**（基线 `HEAD c7d9093`，分支 `feature/v3-product-refactor`）。
> 所有命令均标注仓库证据；**仓库无法证明的条目一律标记 `UNVERIFIED`，不得当作已知事实。**
> 本 Runbook **不执行**任何部署；由人工操作员逐条复制执行。

## 证据图例

| 标记 | 含义 |
|---|---|
| **【已验证】** | 已在当前仓库文件中找到直接证据（附 `file:line` 或文件名） |
| **UNVERIFIED** | 仓库无法证明（服务器上的真实路径/真实值/真实状态），必须由操作员现场确认 |
| **【已作废】** | 仓库中存在的旧文档步骤，经核对与当前配置**不一致**，**不要照抄** |

---

## 0. 当前版本

### 0.1 版本身份【已验证】

| 项 | 值 | 证据 |
|---|---|---|
| Deployment target branch | `feature/v3-product-refactor` | `git branch --show-current`；`origin/feature/v3-product-refactor` = `c7d9093` |
| Deployment target commit | **`c7d9093685ed82070b312a575e2ac5eac49d0f3a`**（短 `c7d9093`） | `git rev-parse HEAD` 与 `git rev-parse origin/feature/v3-product-refactor` 一致，分叉 `0 0` |
| Previous production commit | **UNVERIFIED** —— 仓库无权威记录 | 见下方 0.3 说明 |
| Release / tag | **⚠️ 没有指向本版本的 tag** | 见下方 0.2 警告 |

### 0.2 ⚠️ 两个必须知道的分支/tag 陷阱【已验证】

**陷阱 1：现有 tag 不含本次发布内容。**

```
v12.0.0-score-improvement-engine  →  d1bf071（2026-09-11）
HEAD                              →  c7d9093（比 tag 领先 10 个提交）
```

已用仓库对象证明该 tag **确实缺少本次发布内容**：

```bash
git ls-tree -r --name-only v12.0.0-score-improvement-engine -- prisma/migrations | grep 20260912000000
# 无输出（该迁移不存在于 tag 中）
git ls-tree -r --name-only v12.0.0-score-improvement-engine -- apps/api/src/study/review-mastery-integration.service.ts
# 无输出（M3 集成服务不存在于 tag 中）
```

> **绝对不要用 `v12.0.0-score-improvement-engine` 作为本次部署目标。**
> 用它部署等于**部署一个没有 M3 Review → Mastery 的旧版本**。

tag 与 HEAD 之间被漏掉的 10 个提交（节选最关键的 3 个）：

```
c7d9093 feat(v12): wire Review -> Mastery into the authoritative path (M3 PRODUCTION INTEGRATION = READY)
b318f50 feat(v12): review-to-mastery shadow pipeline (M3 REVIEW-MASTERY SHADOW = READY)
205708c feat(v12): make the approved C1 mastery semantics a switchable migration candidate
```

**陷阱 2：默认分支不是部署分支。**

```bash
git remote show origin | grep 'HEAD branch'
# → origin/HEAD -> origin/codex/deployment-ready
```

已证明 HEAD **不在** 默认分支上：`git merge-base --is-ancestor HEAD origin/codex/deployment-ready` 返回**非 0**。

> **绝对不要执行裸 `git pull`。** 裸 pull 会拉 `codex/deployment-ready`，**同样不含 M3**，且会把工作区切到错误分支。

### 0.3 关于 `Previous production commit`【UNVERIFIED】

仓库内两份文档互相冲突，且都自注"以实际路径/情况为准"：

| 文档 | 说法 |
|---|---|
| `docs/v11-final-release-server-steps.md:12` | `cd ~/kaoyan-408-score-boost`，上一版为 `34c4c86`（tag `v11.0.0`） |
| `docs/v12-release-package.md:35` | `cd /srv/kaoyan408  # 以实际部署路径为准`，上一版写"`43b715e` 前后" |
| `docs/v12-final-release-report.md` | 生产部署状态 **DEFERRED**（无 SSH 凭据，未执行） |

> **结论：当前生产实际跑的是哪个 commit，仓库无法证明。** 必须由操作员在 §3 现场读取并**手工记录**，这就是本次的回滚点。

### 0.4 本次发布内容【已验证】

| 项 | 值 |
|---|---|
| 迁移 | **+2**（自 `32ab233` 起算）：`20260911000000_question_rubric`（V12 F4，新增 `Question.rubric`）+ `20260912000000_review_attempt_schedule_metadata`（M3-B）。迁移总数 **34 → 36** |
| 迁移类型 | 纯 `ADD COLUMN` ×4，**全部可空、无默认值、无回填** |
| 新增列 | `ReviewAttempt.isReview` / `scheduleDriven` / `source` / `dueAt` |
| 行为变更 | **有**：复习结果现在会写入权威掌握度（M3-C，所有者已批准） |
| C1 开关 | **必须保持 OFF**（`MASTERY_SEMANTICS` 不设置） |
| 部署脚本 | `deploy/tencent-ip/deploy.sh`（183 行，仓库内） |
| 运行时 | **Docker Compose only**（3 个服务：`postgres` / `app` / `gateway`） |
| 主机依赖 | 仅 `docker` + `docker compose` + `curl` + `git`（`deploy.sh:66-79` 硬性检查） |

**本次发布不存在以下组件**（避免按通用教程瞎查）：**Redis 全仓零引用**；**主机 Nginx 不需要**（nginx 1.27-alpine 跑在 `gateway` 容器内，见 `Dockerfile.web`）；**主机不需要 Node/npm/Prisma**（构建与迁移都在镜像/容器内完成）。

---

## 1. 部署前准备

### 1.1 人工本地验证已完成（**不等于**服务器状态）

以下**已在开发机验证完毕**，服务器上**不要**重复当成部署门禁，只需知道它是绿的：

| 项 | 结果 |
|---|---|
| `npm test` | 2321 / 2319 通过 / 0 失败 / 2 跳过 |
| `npm run build:api` | PASS |
| `npm run build:web` | PASS |
| 7 个集成套件 | 全部 exit 0 |
| 真实 PostgreSQL + HTTP E2E（六案例） | PASS |
| NEW REGRESSION | 0 |
| 工作区 | clean（仅剩未跟踪 `.zcode/`，与本次无关） |
| origin 同步 | 0 / 0 |

> **服务器是另一回事**：服务器上的 build 是 `docker compose ... up -d --build` 在容器里重建的（§7）。两者不可混淆。

### 1.2 需要准备的信息

| 项 | 说明 |
|---|---|
| 服务器 SSH 访问 | **UNVERIFIED**（仓库无凭据；`docs/v12-final-release-report.md` 记录"无 SSH 凭据"是当时 Agent 的处境） |
| 生产 IP | 仓库引用过 `43.128.30.191`（`docs/archive/legacy-push-docs/DEPLOYMENT_STEPS.md`、`scripts/verify-deployed.mjs` 默认值），**须现场确认** |
| 仓库在服务器上的路径 | **UNVERIFIED** —— 必须在 §3 用 `pwd` 确认，不要照抄任何文档里的路径 |
| 测试账号 | 需要一个**真实的学生测试账号**（邮箱 + 密码）。生产**禁用 demo 登录**（见 §1.3），没有测试账号则 §12 无法执行 |
| 一个教师/管理员测试账号 | §10 的 `teacher/admin` 端点与 §12 的 `review-mastery-shadow` 需要 |
| 维护窗口 | M3 会改变掌握度，建议低峰执行（见 §12 风险提示） |

### 1.3 ⚠️ 生产禁用 demo 登录【已验证】

```bash
# apps/api/src/auth/auth.service.ts:75
if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_AUTH !== 'true') { ... }
```
且 `compose.production.yml:69,74` 固定 `NODE_ENV: production` 与 `ALLOW_DEMO_AUTH: "false"`。

> `POST /auth/demo-login` 在**生产会失败**。`docs/v11-final-release-server-steps.md:44` 的 demo-login 步骤 **【已作废】**，不要照抄。

---

## 2. SSH 登录

**目的**：获得服务器 shell，并在**正确的仓库目录**下工作。

```bash
ssh <你的服务器用户名>@<生产IP>
```

**预期输出**：登录成功，出现 shell 提示符。

**失败时怎么办**：
- `Permission denied (publickey)` → 你的密钥未加进服务器，先解决访问权限；不要尝试用密码绕过或有其他旁路。
- 连不上 → 确认安全组 / 防火墙放通 22。

### CHECKPOINT 2 — 定位仓库目录（**不要猜路径**）

```bash
# 找出这个 compose 项目真正的目录（按 compose 文件定位，不靠记忆）
docker ps --format '{{.Names}}' | head
ls -d /srv/* /opt/* ~/* 2>/dev/null | head -20
# 逐个人工确认哪一个目录里同时存在这两个文件：
#   compose.production.yml  .env.production
```

```bash
cd <你确认的仓库目录>
pwd
ls compose.production.yml .env.production deploy/tencent-ip/deploy.sh
```

**预期输出**：`pwd` 打印绝对路径；三个文件都存在。

**失败时怎么办**：
- 缺 `compose.production.yml` 或 `.env.production` → **停止**。`deploy.sh:81-89` 会直接拒绝运行；先把目录找对。
- 找不到任何目录 → **停止**，不要新建目录、不要重新 clone 到别处（会造出第二套 stack）。

> **记录你确认的路径**：`REPO_DIR = ____________________`（后续所有命令都在此目录执行）

---

## 3. Git 版本确认

**目的**：证明服务器上的代码**就是**被批准的那个提交。

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git remote -v
```

**预期输出**：
- `git status --short`：**空**（或仅有你已知的本地噪声；见下）
- `git rev-parse HEAD`：**部署开始时是旧提交**（这就是回滚点）

**失败时怎么办**：
- `git status --short` **有未提交/未跟踪改动** → **立即停止**。不要用 `git reset --hard` 覆盖未知改动（AGENTS.md §9 + 本 Runbook §17）。先弄清这些改动是什么、是否有人手工改过生产。
- 不在 git 仓库内 → 目录找错了，回到 §2。

### CHECKPOINT 3a — 记录回滚点

```bash
git rev-parse HEAD | tee /tmp/m3-pre-deploy-commit.txt
```

> **把这一行抄到 §19 部署记录里。** 这是唯一的回滚锚点。

### CHECKPOINT 3b — 确认远端目标提交

> ⚠️ **生产实测教训（V12.1）**：在这台服务器上，`git fetch origin <branch>` **只更新了 `FETCH_HEAD`，没有更新 `origin/<branch>`**（fetch 输出里只有 `* branch ... -> FETCH_HEAD`，缺少 `a0de9ee..c7d9093 ... -> origin/feature/v3-product-refactor` 那一行）。实测 `origin/feature/v3-product-refactor` 读出来是 **`a0de9ee`** —— 一个 2026-08-31 的提交，**落后 161 个提交**、且**不含本次任何内容**。
>
> **因此：不要用 `origin/<branch>` 作为部署目标，用 `FETCH_HEAD` 或字面 SHA。**

```bash
git fetch origin feature/v3-product-refactor
git rev-parse FETCH_HEAD                          # ← 这次 fetch 真正写下的值
git ls-remote origin feature/v3-product-refactor  # ← 权威：直接问远端
```

**预期输出**：两者一致，且等于被批准的提交（例如 `c7d9093685ed82070b312a575e2ac5eac49d0f3a`）。

**失败时怎么办**：
- 与批准提交不一致 → **停止**。远端可能已前进或你在错误分支；不要部署未经批准的提交。
- `git fetch` 报代理/引用错误 → 用**显式 refspec**（§6 的做法），不要改用裸 `git pull`。
- 想顺手修掉这个陈旧 ref（**建议部署验证通过后再做**）：
  ```bash
  git config --get-all remote.origin.fetch     # 若只有单分支 refspec，就是根因
  git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
  git fetch origin --prune
  ```

### CHECKPOINT 3c — 查看本次将要引入的改动

```bash
git log --oneline "$(cat /tmp/m3-pre-deploy-commit.txt)..FETCH_HEAD"
git show --stat FETCH_HEAD
```

**预期输出**：应能看到被批准的那个提交（例如 `c7d9093 feat(v12): wire Review -> Mastery into the authoritative path`），且 `--stat` 中应包含：

```
prisma/migrations/20260912000000_review_attempt_schedule_metadata/migration.sql
apps/api/src/study/review-mastery-integration.service.ts
apps/api/src/score-center/service.ts
```

**失败时怎么办**：
- 看不到上面三个文件 → **停止**。你手上的 ref 不是被批准的版本。

---

## 4. 环境变量检查

**目的**：确认 **C1 关闭**，并确认关键变量存在。**绝不打印任何 secret。**

### 4.1 结构性事实（先理解，再检查）【已验证】

`compose.production.yml` 的 `app.environment` 是一份**显式白名单**（第 68-96 行），其中**没有** `MASTERY_SEMANTICS`。全仓检索也证明该变量**只出现在测试脚本与文档里**，**不存在于任何部署配置或 `.env.production.example`**。

> 含义：即使主机 shell 里 `export MASTERY_SEMANTICS=c1`，它**也不会**进入 app 容器——除非有人**手工**把它加进 `compose.production.yml`。**这才是 C1 保持 OFF 的结构性保证。**

### 4.2 检查 `.env.production` 是否含该变量（只报存在性，不打印值）

```bash
grep -c '^[[:space:]]*MASTERY_SEMANTICS[[:space:]]*=' .env.production || true
grep -n '^[[:space:]]*MASTERY_SEMANTICS[[:space:]]*=' .env.production | sed 's/=.*/=<redacted>/' || true
```

**预期输出**：
- 第一条：`0`
- 第二条：无输出

**失败时怎么办**：
- 若打印出 `MASTERY_SEMANTICS=<redacted>` **且值不是 `legacy`** → **立即停止部署**，进入 §11 的 C1 处置流程。绝不允许带着 `c1` 继续。

### 4.3 检查主机 shell 环境

```bash
printenv MASTERY_SEMANTICS || echo 'MASTERY_SEMANTICS = unset'
```

**预期输出**：`MASTERY_SEMANTICS = unset`
（**必须**是 unset；不要"为了安全"主动设成 `legacy`，那会改变容器的显式白名单语义之外的假设，保持 unset 即可。）

### 4.4 检查 compose 渲染结果中该变量不存在

```bash
docker compose --env-file .env.production -f compose.production.yml config | grep -i MASTERY_SEMANTICS || echo 'not present in rendered config (expected)'
```

**预期输出**：`not present in rendered config (expected)`

**失败时怎么办**：若出现该键 → **停止**，有人改过 compose 文件；先查 `git diff compose.production.yml`。

### 4.5 关键变量存在性（只报"是否非空"）

```bash
for v in PUBLIC_IP POSTGRES_USER POSTGRES_DB JWT_SECRET BACKUP_RETENTION_DAYS; do
  if grep -q "^[[:space:]]*$v[[:space:]]*=[[:space:]]*[^[:space:]#]" .env.production; then echo "$v = present"; else echo "$v = MISSING"; fi
done
```

**预期输出**：五项全部 `present`。

**失败时怎么办**：任一项 `MISSING` → `deploy.sh:98-135` 会拒绝部署；按 `deploy/tencent-ip/.env.production.example` 补齐。

### CHECKPOINT 4

```
PASS → C1 不在 .env.production、不在 shell、不在渲染后的 compose 中，且五项关键变量齐备 → 进入 §5
FAIL → 出现 c1 → 停止；MISSING → 补齐后再来
```

---

## 5. 数据库 migration

### 5.1 先理解迁移的执行方式【已验证】

**迁移不需要你手工执行**：`Dockerfile:49` 的 CMD 是

```
sh -c "cd apps/api && npx prisma migrate deploy --schema ../../prisma/schema.prisma && exec node dist/main.js"
```

即**每次容器启动自动 `migrate deploy`**，且 `migrate deploy` 幂等。`deploy.sh` 通过 `up -d --build --wait` 触发它。

> 因此本节的职责是：**部署前看清将要发生什么**，**部署后验证它确实发生了**。

### 5.2 定义只读 SQL 执行函数（**只需在本次 shell 会话里定义一次**）

本 Runbook 所有 SQL 都是只读的。为了**不把数据库密码写进命令行**、也不依赖主机侧变量（`$POSTGRES_USER` 在服务器 shell 里**通常未设置**，直接 `psql -U "$POSTGRES_USER"` 会失败），统一使用下面这个函数：它把 SQL 通过 stdin 送进 **postgres 容器内部**，容器内 `POSTGRES_USER` / `POSTGRES_DB` 由 compose 注入，无需任何秘密出现在命令行。

```bash
cd <REPO_DIR>   # §2 确认的路径
psql_ro() {
  docker compose --env-file .env.production -f compose.production.yml exec -T postgres \
    sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off'
}
# 自检：能列出当前库
psql_ro <<'SQL'
SELECT current_database() AS db, current_user AS role;
SQL
```

**预期输出**：一行，`db` 与 `role` 均为非空（通常是 `kaoyan408` / `kaoyan408`）。

**失败时怎么办**：
- `service "postgres" is not running` → 当前 stack 未运行，先回到 §8。
- `password authentication failed` → 不该发生（容器内本地 socket）；若发生，说明有人改了 postgres 鉴权配置 → 停止并排查。
- 函数定义报错 → 你不在 `REPO_DIR` 或不在 bash 中；确认 shell 与目录。

> 后续所有 `psql_ro <<'SQL' ... SQL` 都假设这个函数已在**同一 shell 会话**中定义。若你换了新 shell，请重新定义。
> `-v ON_ERROR_STOP=1` 保证 SQL 出错时**不会**静默继续；`-P pager=off` 保证在非交互环境下输出完整。

### 5.3 部署前：查看当前迁移状态

```bash
docker compose --env-file .env.production -f compose.production.yml exec -T app \
  npx prisma migrate status --schema prisma/schema.prisma
```

**预期输出**：显示已应用迁移数**少于** 36，并列出待应用迁移，其中包含：

```
20260912000000_review_attempt_schedule_metadata
```

**失败时怎么办**：
- `service "app" is not running` → 用 `--profile tools` 或先确认当前 stack 在跑（`docker compose ... ps`）；若生产当前**没有**在跑 app 容器，改用一次性容器：
  ```bash
  docker compose --env-file .env.production -f compose.production.yml run --rm --entrypoint sh app \
    -c 'npx prisma migrate status --schema prisma/schema.prisma'
  ```
  （**UNVERIFIED**：需要基于镜像已构建；首次部署前可能还没镜像。）
- 报告 "drift detected" / "failed migration" → **停止**，不要用 `migrate reset`（§17 禁止）。

### 5.4 确认迁移性质（**只读**检查迁移文件本身）

```bash
git show origin/feature/v3-product-refactor:prisma/migrations/20260912000000_review_attempt_schedule_metadata/migration.sql
```

**预期输出**（全文，共 4 条 ADD COLUMN，**没有** DROP / ALTER TYPE / UPDATE / DELETE）：

```sql
ALTER TABLE "ReviewAttempt"
  ADD COLUMN "isReview" BOOLEAN,
  ADD COLUMN "scheduleDriven" BOOLEAN,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "dueAt" TIMESTAMP(3);
```

**必须人工确认的五件事**：additive ✅ / nullable ✅ / 无破坏性语句 ✅ / 无历史改写 ✅ / 无数据重置 ✅

**失败时怎么办**：若看到任何 `DROP`、`TRUNCATE`、`DELETE`、`UPDATE`、`SET NOT NULL`、`DEFAULT` → **立即停止**，这不是被批准的迁移。

### 5.5 正式执行

**不需要单独执行。** 由 §6 的代码更新 + §7 的 `deploy.sh`（→ `up -d --build --wait`）触发容器启动流程自动 `migrate deploy`。

> 若你想**手工**执行（例如 §7 的脚本路径不可用），可用：
> ```bash
> docker compose --env-file .env.production -f compose.production.yml run --rm --entrypoint sh app \
>   -c 'npx prisma migrate deploy --schema prisma/schema.prisma'
> ```
> **UNVERIFIED**：此路径未经本仓库脚本验证；优先使用 `deploy.sh`。

### 5.6 部署后：再次查看状态 + 验证列存在

```bash
docker compose --env-file .env.production -f compose.production.yml exec -T app \
  npx prisma migrate status --schema prisma/schema.prisma
```

**预期输出**：`Database schema is up to date!`，迁移数 **36**。

```bash
psql_ro <<'SQL'
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'ReviewAttempt'
  AND column_name IN ('isReview', 'scheduleDriven', 'source', 'dueAt')
ORDER BY column_name;
SQL
```

**预期输出**（4 行；`is_nullable` 必须全为 `YES`，`column_default` 必须全为空）：

```
 dueAt          | timestamp(3) without time zone | YES | 
 isReview       | boolean                        | YES | 
 scheduleDriven | boolean                        | YES | 
 source         | text                           | YES | 
```

**失败时怎么办**：
- 行数 < 4 → app 容器没跑起来或迁移失败 → 看 `docker compose ... logs app`，**不要**进入 §9 之后。
- `is_nullable = NO` 或 `column_default` 非空 → 迁移文件被改过 → **停止并回滚**。

### 5.7 历史行必须仍是 NULL（**不得回填**）

```bash
psql_ro <<'SQL'
SELECT count(*) AS total,
       count(*) FILTER (WHERE "isReview" IS NULL) AS null_meta
FROM "ReviewAttempt";
SQL
```

**预期输出**：`null_meta` **等于** `total`（迁移刚做完时所有历史行都是 NULL = 未知）。

**失败时怎么办**：若 `null_meta < total` → 有人**回填伪造了历史** → **P0，停止**。NULL 表示"当时没记录"，不是"false"。

### CHECKPOINT 5

```
PASS → 迁移 status 36、4 列存在且 nullable 无默认、历史行 metadata 全 NULL → 进入 §6
FAIL → 停止；drift/失败迁移 → 不回滚数据库，先看日志与 §16
```

---

## 6. 代码更新

**目的**：把服务器 checkout 切到 `c7d9093`。

### 6.1 再次确认工作区干净（**这一步是强制的**）

```bash
git status --short
```

**预期输出**：**空**。

**失败时怎么办**：**停止**。存在未知改动时禁止 `reset --hard`（会静默销毁生产上的未知修改）。先人工判断这些改动来源。

### 6.2 更新（**显式 refspec**）

```bash
git fetch origin feature/v3-product-refactor
git switch --detach FETCH_HEAD
git rev-parse HEAD
```

**或（对任何 ref 陈旧都免疫，最稳）用字面 SHA**：

```bash
git switch --detach <被批准的完整SHA>
git rev-parse HEAD
```

**预期输出**：`HEAD` 等于被批准的提交（例如 `c7d9093685ed82070b312a575e2ac5eac49d0f3a`）。

> 为什么用 `fetch` + `switch --detach` 而不是 `git pull`：
> ① 裸 `pull` 会走默认分支 `codex/deployment-ready`，**不含 M3**（§0.2 已证明）；
> ② 服务器 git 曾命中代理陈旧 ref（记录于 `docs/v12-release-package.md:59` 与 `docs/v63-...md:76`），显式 refspec 才可靠；**V12.1 生产实测已再次证实**：该服务器的 `origin/feature/v3-product-refactor` 陈旧了 **161 个提交**（§CHECKPOINT 3b）；
> ③ `switch --detach` 不创建分支、不产生"本地分支与远端分叉"的隐患，`deploy/tencent-ip/rollback.sh:90` 也使用同一模式。

**失败时怎么办**：
- `git switch` 报 "local changes would be overwritten" → 回到 §6.1，**停止**。
- `HEAD` 不是被批准的提交 → **停止**。

> **WARNING**
> - 不要 reset/switch 到错误 branch（尤其不要 `codex/deployment-ready`、不要 `v12.0.0-score-improvement-engine`）。
> - 不要用 `origin/feature/v3-product-refactor` 作为目标 —— 在这台服务器上它是陈旧的（§CHECKPOINT 3b）。
> - 不要覆盖生产服务器上的未知修改。
> - 你现在处于 **detached HEAD**，这是正常的；后续回滚也要用 `--detach` 回到旧提交。

### 6.3 落地检查（切换后、部署前）

```bash
ls apps/api/src/study/review-mastery-integration.service.ts
ls prisma/migrations/20260912000000_review_attempt_schedule_metadata/migration.sql
```

**预期输出**：两个文件都存在。**任一缺失 → 停，不要部署**（说明切到了旧提交）。

### CHECKPOINT 6

```
PASS → git status 空、HEAD 是被批准的提交（或目标 SHA）、工作树在 detached HEAD（正常）、落地检查两个文件存在 → 进入 §7
FAIL → 停止，不要强推/强覆盖
```

---

## 7. Build

### 7.1 服务器实际 build = Docker 镜像重建【已验证】

**服务器上不需要** `npm ci` / `npm run build:api` / `npm run build:web`。构建发生在镜像内：

- `Dockerfile`（builder stage）→ `npm run build:shared` → `prisma generate` → `npm run build -w apps/api`
- `Dockerfile.web` → `npm run build:web` → 产物装进 nginx 镜像

**推荐：直接用仓库脚本（内含备份门禁 + 网关健康等待 + 幂等 seed + app 重启）**

```bash
sh deploy/tencent-ip/deploy.sh
```

**该脚本会做什么**（`deploy/tencent-ip/deploy.sh`，183 行）：
1. 检查 `docker` / `docker compose` / `curl` / `.env.production` / `compose.production.yml` 存在
2. 校验 `PUBLIC_IP`（必须是全球可达 IPv4）、`POSTGRES_USER`、`POSTGRES_PASSWORD`（≥24 且仅 URL-safe）、`POSTGRES_DB`、`JWT_SECRET`（≥32）、`BACKUP_RETENTION_DAYS`（1–365）
3. 若既有 postgres 容器**不健康** → **拒绝部署**（不会在没备份的情况下硬上）
4. 既有 postgres 健康 → **先做数据库备份**（`--profile tools run --rm backup`）
5. `docker compose ... up -d --build --wait --wait-timeout 60`（容器启动时自动 `migrate deploy`）
6. 等待网关 `http://127.0.0.1/health` 成功（最多 60 秒）
7. 幂等 seed：`scripts/seed-408-v2.mjs`、`scripts/seed-knowledge-point-map.mjs`
8. `restart app`（让 catalog 显示名生效）
9. 打印 `docker compose ps` 与 `http://$PUBLIC_IP`

**预期输出结尾**：
```
Creating a database backup before deployment...
...
Created backup archive: /backups/kaoyan408-<UTC时间戳>.dump
...
Deployment succeeded. Open: http://<PUBLIC_IP>
NAME ... STATUS
```

**失败时怎么办**：
- `Missing .env.production` / `Missing compose.production.yml` → 目录不对（回 §2）。
- `PUBLIC_IP is invalid.` 等 `invalid_env` → 按 §4.5 修 `.env.production`（**不要**把 secret 贴到聊天/工单里）。
- `Existing PostgreSQL container is not running and healthy; refusing deployment before a verified backup.` → 先把 postgres 恢复健康；**不要**绕过这个门禁。
- `Gateway health check did not succeed within 60 seconds.` → 进入 §9 失败处置（看 app 日志），并按 §16 评估回滚。
- 构建 OOM（2C2G 机器）→ 见 §18。

### 7.2 服务器上的最小验证（可选，但推荐）

部署脚本跑完后，若你想在服务器上额外跑一次测试，**不建议**（`npm test` 需要完整 devDependencies + 数分钟 CPU，2C2G 机器上会挤占生产）。仓库的 `predeploy` 脚本（`npm test && npm run verify:api-build-layout`）是给**构建机**用的，**UNVERIFIED** 其在生产服务器上的可行性。

> **明确区分**：*部署前本地已完整验证*（§1.1）与 *服务器实际 build*（本节，由 Docker 完成）。两者不是同一件事，都做了才叫覆盖。

### CHECKPOINT 7

```
PASS → deploy.sh 退出码 0，输出 "Deployment succeeded"，ps 显示 postgres/app/gateway 均 running(healthy)
FAIL → 停止，进入 §9 失败处置；不要反复盲目重跑
```

---

## 8. Service Restart

**运行时 = Docker Compose**【已验证，`compose.production.yml`】。**没有 systemd / pm2**（全仓无相关配置）。

可用仓库脚本别名（`package.json`）：

| 操作 | 命令 |
|---|---|
| 配置校验 | `npm run prod:config` |
| 启动/更新 | `npm run prod:up` |
| 状态 | `npm run prod:status` |
| 日志（尾 200 行） | `npm run prod:logs` |

### 8.1 status（**什么时候**：部署后立即；以及任何怀疑时）

```bash
docker compose --env-file .env.production -f compose.production.yml ps
```

**预期结果**：`postgres`、`app`、`gateway` 三个容器 `running`；`postgres` 与 `app` 显示 `healthy`。

**异常处理**：app 反复 `Restarting` → `logs app`（§15）。postgres 不 healthy → **不要**继续，先恢复数据库。

### 8.2 restart（**什么时候**：只在需要让 app 重新读启动期配置时，例如手工改了环境变量）

```bash
docker compose --env-file .env.production -f compose.production.yml restart app
```

**预期结果**：app 重建后 healthy；网关 `/health` 恢复 200。注意 `deploy.sh` 自己已执行过一次 `restart app`（第 180 行），**通常无需再手动重启**。

**异常处理**：重启不健康 → 看 §15 日志。

### 8.3 stop（**什么时候**：仅用于回滚前置、或需要完全停机的维护）

```bash
docker compose --env-file .env.production -f compose.production.yml stop app
```

**预期结果**：app 停止，网关对 `/api/*` 与 `/health` 返回 **502/504**（这是预期，不是新故障）。

**异常处理**：`stop` 后**不要**把网关也停掉再对外暴露——保持要么全停、要么全起。

### 8.4 start（**什么时候**：`stop` 之后恢复）

```bash
docker compose --env-file .env.production -f compose.production.yml start app
```

**预期结果**：app 恢复正常（**注意**：`start` 不重建镜像、不改代码；改代码必须走 §6+§7）。

### 8.5 logs（**什么时候**：任何异常的第一站）

```bash
docker compose --env-file .env.production -f compose.production.yml logs --tail=200 app
docker compose --env-file .env.production -f compose.production.yml logs --tail=100 gateway
docker compose --env-file .env.production -f compose.production.yml logs --tail=100 postgres
```

**预期结果**：见 §15 的"正常日志示例"。

### CHECKPOINT 8

```
PASS → ps 三容器 running、postgres/app healthy → 进入 §9
FAIL → 先看日志；数据库不健康时禁止继续任何写操作
```

---

## 9. Health Check

**目的**：从最基础的一层开始。**health 不过，不要进入业务 E2E。**

```bash
curl -sS -o /tmp/m3-health.json -w 'HTTP %{http_code}\n' http://127.0.0.1/health
cat /tmp/m3-health.json; echo
```

**预期输出**：HTTP **200**，且 JSON 形如【已验证，`apps/api/src/health.controller.ts:48-57`】：

```json
{
  "status": "ok",
  "operational": { "database": "connected", "aiProvider": "...", "embeddingProvider": "..." },
  "service": "kaoyan-408-api",
  "version": "1.0.0",
  "dataSource": "postgresql",
  "uptimeSec": 12,
  "checks": { "database": "connected" },
  "timestamp": "..."
}
```

**关键断言**：`status == "ok"` 且 `checks.database == "connected"` 且 `dataSource == "postgresql"`。

**失败时怎么办**：
- HTTP **503** 且 `status: "degraded"` → 数据库不通（`health.controller.ts:28-37`）。看 `logs postgres`、确认卷与凭据；**不要**进入 §10。
- 连不上 / 502 → 网关没起来或 app 不健康 → 看 `logs gateway`、`logs app`。
- **不要**在 health 未通过时继续；也**不要**用 `curl -k` 之类绕过 TLS 校验来"让它过"。

### CHECKPOINT 9

```
PASS → 200 + status ok + database connected + dataSource postgresql → 进入 §10
FAIL → 停止，先修 health
```

---

## 10. Endpoint Smoke

**目的**：证明 V12/M3 路由**已注册**（401 ≠ 404）。

### 10.1 ⚠️ 端口与路径的坑【已验证】

- `app` 服务**没有**发布主机端口（`compose.production.yml` 中只有 `gateway` 有 `ports: 80:80 / 443:443`）。
- 因此 **`http://127.0.0.1:3000/...` 在主机上不可达**。
- 正确入口是网关：**`http://127.0.0.1/api/...`**（nginx `location /api/ { proxy_pass http://app:3000/; }`，`deploy/tencent-ip/nginx.conf:14-21`）。

> `docs/v11-final-release-server-steps.md:35` 用 `http://127.0.0.1:3000$p` **【已作废】** —— 在 `compose.production.yml` 下会全部失败。不要照抄。

### 10.2 未认证探测（期望 401，**不是** 404）

```bash
for p in \
  /api/coach/task-evidence \
  /api/coach/mastery-calibration \
  /api/coach/outcome-tracking \
  /api/coach/review-mastery-shadow \
  /api/admin/data-quality \
  /api/coach/learning-evidence \
  /api/coach/recommendation-funnel \
  /api/coach/review-semantics-shadow \
  /api/coach/score-opportunity \
  /api/coach/score-calibration \
  /api/coach/shadow-decision-chain
do
  printf '%-45s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1$p)"
done
```

**预期输出**：**全部 401**（路由已注册且被 `RoleGuard` 守卫）。

**失败时怎么办**：
- 出现 **404** → 该路由**未注册** = 部署不完整（很可能你部署了错误提交，见 §0.2）→ 按 §16 评估回滚。
- 出现 **200** → 守卫被绕过（严重）→ **P0 停止**。
- 出现 5xx → 看日志。

### 10.3 认证后的安全探测（用真实测试账号，**不绕过 auth guard**）

```bash
read -r -p '教师/管理员测试账号邮箱: ' T_EMAIL
read -r -s -p '密码（不回显）: ' T_PASS; echo
ADMIN_TOKEN=$(curl -s -X POST http://127.0.0.1/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$T_EMAIL\",\"password\":\"$T_PASS\"}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
test -n "$ADMIN_TOKEN" && echo 'token acquired' || echo 'LOGIN FAILED'
```

**预期输出**：`token acquired`

**失败时怎么办**：
- 401 `Email or password is incorrect` → 凭据错（**注意**：登录会对邮箱做小写化归一，务必用账号**实际存储**的邮箱）。
- 429 → 生产登录节流（**10 次 / 60 秒**，`apps/api/src/auth/auth.controller.ts:22`）。**等待 60 秒**再试，**不要**为了测试放宽节流。

```bash
# teacher/admin 端点
curl -s -o /dev/null -w 'review-mastery-shadow HTTP %{http_code}\n' \
  "http://127.0.0.1/api/coach/review-mastery-shadow?userId=<某个学生userId>&windowDays=60" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# student/teacher/admin 端点（用学生 token 更贴近真实；此处用同一 token 验证可达性）
for p in /api/coach/task-evidence /api/coach/mastery-calibration /api/coach/outcome-tracking; do
  printf '%-38s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1$p -H "Authorization: Bearer $ADMIN_TOKEN")"
done
```

**预期输出**：全部 **200**。

**失败时怎么办**：
- **403** → 该账号角色不足（`review-mastery-shadow` 与 `data-quality` 仅 `teacher/admin`/`admin`；见 §10.4 角色表）。换正确角色的账号，**不要**改代码放宽角色。
- **401** → token 失效（access token 15 分钟）；重新登录。

### 10.4 端点角色表【已验证】

| 端点 | 允许角色 | 证据 |
|---|---|---|
| `GET /coach/task-evidence` | student / teacher / admin | `daily-brief.controller.ts:184-186` |
| `GET /coach/mastery-calibration` | student / teacher / admin | `daily-brief.controller.ts:436-438` |
| `GET /coach/outcome-tracking` | student / teacher / admin | `daily-brief.controller.ts:451-453` |
| `GET /coach/review-mastery-shadow` | **teacher / admin** | `daily-brief.controller.ts:410-412` |
| `GET /admin/data-quality` | **admin** | `study.controller.ts:749-751` |
| `POST /wrong-questions/:questionId/reason` | student / teacher / admin | `study.controller.ts:581-583` |

### CHECKPOINT 10

```
PASS → 11 个端点全部 401（未认证）+ 认证后 200 → 进入 §11
FAIL → 404 = 部署不完整（评估回滚）；200 = 守卫失效（P0）；403 = 换正确角色账号
```

---

## 11. C1 OFF Verification

**目的**：证明 M3 的复习接线**没有**顺带打开 C1。

### 11.1 容器内该变量必须不存在【已验证：结构性白名单】

```bash
docker compose --env-file .env.production -f compose.production.yml exec -T app \
  sh -c 'if [ -n "${MASTERY_SEMANTICS:-}" ]; then echo "MASTERY_SEMANTICS = $MASTERY_SEMANTICS  <-- NOT EXPECTED"; else echo "MASTERY_SEMANTICS = unset"; fi'
```

**预期输出**：`MASTERY_SEMANTICS = unset`

### 11.2 启动日志必须自证 legacy【已验证，`apps/api/src/main.ts:75` 同风格】

```bash
docker compose --env-file .env.production -f compose.production.yml logs app | grep -i 'Mastery semantics' | tail -3
```

**预期输出**（形如）：

```
[<timestamp>] LOG [Bootstrap] Mastery semantics: legacy — legacy（现行生产语义）（未设置，使用默认）
```

**必须看到 `legacy`。** 若日志显示 `c1`（或任何非 legacy 语义）→ **立即停止业务 smoke**。

**失败时怎么办**：
- 日志里**找不到**这一行 → 该提交可能未部署（旧版本没有这条启动日志）→ 回到 §3 核对提交。
- 显示 `c1` → **P0**：立即执行 §16 rollback 流程中的**配置回滚**（从 `compose.production.yml` 移除该键或将其清空），重启 app，再复验本节。**不要**继续 §12。

### 11.3 数据面交叉验证：认领事件必须记录 legacy

```bash
psql_ro <<'SQL'
SELECT payload->>'semantics' AS semantics, count(*)
FROM "UserEvent"
WHERE type = 'REVIEW_MASTERY_APPLIED'
GROUP BY 1;
SQL
```

**预期输出**：要么**无行**（还没有任何复习投影，正常），要么**只有** `legacy | N`。

**失败时怎么办**：出现 `c1` → P0，按 §11.2 处置。

### CHECKPOINT 11

```
PASS → 容器内 unset + 启动日志 legacy + 认领事件只出现 legacy（或为空） → 进入 §12
FAIL → 任何 c1 迹象 → 立即停止业务 smoke，先做配置回滚
```

---

## 12. Review → Evidence → Mastery Smoke

> **这是本 Runbook 最重要的部分。**

### 12.1 ⚠️ 执行前必读的风险

- 这一步会**真实写入**：`ReviewAttempt` + 证据回执 + `REVIEW_MASTERY_APPLIED` 认领 + **权威掌握度**（M3-C 已接线）。
- 因此**必须**使用**专用测试学生账号**，且该账号在一个**明确的测试知识点**上。
- **不要**用真实学生的账号做本次 smoke（会真的改变他的掌握度与推荐排序）。
- 请把测试节点/题目 id 记录到 §19。

### 12.2 准备：学生 token【已验证：生产禁用 demo 登录】

```bash
read -r -p '学生测试账号邮箱: ' S_EMAIL
read -r -s -p '密码（不回显）: ' S_PASS; echo
STUDENT_TOKEN=$(curl -s -X POST http://127.0.0.1/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$S_EMAIL\",\"password\":\"$S_PASS\"}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
test -n "$STUDENT_TOKEN" && echo 'student token acquired' || echo 'LOGIN FAILED'
```

**预期输出**：`student token acquired`

### 12.3 选一个安全测试题目（**必须是该账号有练习历史的错题**）

```bash
curl -s http://127.0.0.1/api/wrong-questions -H "Authorization: Bearer $STUDENT_TOKEN" \
  | head -c 1200; echo
```

**预期输出**：JSON 数组，元素含 `questionId`。

> **重要**：复习端点要求该题**存在该用户的练习记录**，否则返回 400（`Question ... has no practice history for this user`，`study.service.ts:2271-2273`）。若数组为空，先用该测试账号做一次练习（或换一个有错题的测试账号）。

```bash
read -r -p '选定 questionId（必须是上面列表里的）: ' QID
```

**失败时怎么办**：列表为空 → 该账号不能用；换账号或先造练习历史。

### 12.4 读取"前值"（mastery / priority / opportunity / rank）

```bash
# 该题映射到的知识节点 + 当前掌握度（只读）
# 注意：heredoc 分隔符不加引号，因此主机 shell 会把 $QID 展开进 SQL —— 这正是我们要的。
psql_ro <<SQL
SELECT m."knowledgeNodeId", m.mastery, m.version
FROM "UserKnowledgeMastery" m
JOIN "ReviewSchedule" s ON s."userId" = m."userId"
JOIN "QuestionKnowledgeNodeTag" t ON t."knowledgeNodeId" = m."knowledgeNodeId"
WHERE s."questionId" = '$QID'
LIMIT 5;
SQL
```

**预期输出**：1–5 行；`mastery` 在 0–1 之间；`version` 为整数。

**失败时怎么办**：0 行 → 该题没有节点标签或该用户没有该节点的掌握度行（换题，或先在 API 侧确认 `/api/wrong-questions/$QID/detail`）。

**记录到 §19**：`mastery_before = ______`，`version_before = ______`，`knowledgeNodeId = ______`

### 12.5 执行一次真实 review

```bash
curl -s -X POST "http://127.0.0.1/api/wrong-questions/$QID/reason" \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"selfReportedReason":"m3 production smoke","redoCorrect":true,"timeSpentSec":45,"isReview":true,"idempotencyKey":"m3-smoke-'"$(date -u +%Y%m%dT%H%M%SZ)"'"}' \
  | head -c 800; echo
```

**预期输出**：HTTP 200/201，JSON 含 `nextReviewInDays` 与 `message`。

**失败时怎么办**：
- 400 `has no practice history` → 回到 §12.3 换题。
- 401 → token 过期，重新登录。
- 500 → 看 app 日志（§15）；重点看是否有 `Review mastery projection` 与事务错误。

### 12.6 验证六环：Review → Evidence → Mastery → Priority → Opportunity → Recommendation

**① Review + Evidence + 认领（一条 SQL 串起来，只读）**

```bash
psql_ro <<'SQL'
SELECT a.id AS attempt_id,
       a."isReview", a."scheduleDriven", a.source, a."dueAt",
       e."eventKey" AS evidence_receipt,
       e.payload->>'occurrence' AS receipt_occurrence,
       (e.payload->>'occurrence') = a.id AS id_matches_attempt,
       m."eventKey" AS mastery_claim,
       m.payload->>'semantics' AS semantics
FROM "ReviewAttempt" a
LEFT JOIN "UserEvent" e
  ON e.type = 'EVIDENCE_RECORDED' AND e.payload->>'occurrence' = a.id
LEFT JOIN "UserEvent" m
  ON m.type = 'REVIEW_MASTERY_APPLIED' AND m.payload->>'evidenceEventKey' = e."eventKey"
WHERE a."reviewedAt" > now() - interval '15 minutes'
ORDER BY a."reviewedAt" DESC
LIMIT 5;
SQL
```

**预期输出**（每一次刚做的复习一行）：`isReview = t`、`source = wrong_question`、`receipt_occurrence` 非空、**`id_matches_attempt = t`**（M3-A 逐次身份）、`mastery_claim` 非空、`semantics = legacy`。

**失败时怎么办**：
- `evidence_receipt` 为 NULL → **P0**：新复习没有证据回执，M3 边界被破坏 → 立即 §16 rollback + 上报。
- **`mastery_claim` 为空（`semantics` 也为空）→ M3 未生效**。这是 **V12.1 生产实测真实发生过的故障形态**：
  ```
  evidence_receipt 有值 · id_matches_attempt = t · mastery_claim 为空
  日志：Review mastery projection no_knowledge_node (evidence LEARNING_EVIDENCE:...)
  ```
  含义：证据层正常，但**投影层无法把题目解析到知识节点**，于是按设计拒绝（**安全降级，不写错数据**）。
  **定性**：不是 P0（无数据损坏、无重复、无污染），但 **M3 功能目标未达成** → 该次部署判 **NOT VERIFIED**。
  **处置**：① 确认部署的提交是否已包含 V12.1 的节点解析修复（`apps/api/src/study/question-node-resolution.ts` 是否存在）；② 若不存在 → 部署的仍是旧提交，按 §6 重新部署；③ 若存在 → 用第 ③ 步的 SQL 查该题的直接标注与 legacy 桥接情况，并把日志行与查询结果留档上报。
- `id_matches_attempt = f` → M3-A 身份未生效（很可能部署了旧提交）。
- `semantics != legacy` → 回到 §11。

> **关于节点解析（V12.1 背景）**：生产库里 `QuestionKnowledgeNodeTag` **可能是空的**（实测 332 题 0 行），此时节点只能通过 legacy 桥接解析：`QuestionKnowledgePoint` → `KnowledgePointNodeMap`。V12.1 起，生产投影与两个影子服务**统一复用**生产的 `resolveKnowledgeNodesForQuestion`（三层：可信直接标注 → 桥接标注 → 桥接回退链），因此上述两种数据形状都能工作。若仍出现 `no_knowledge_node`，先查这两张桥接表：
> ```bash
> psql_ro <<'SQL'
> SELECT
>   (SELECT count(*) FROM "QuestionKnowledgeNodeTag" WHERE "questionId" = '<该题id>') AS direct_tags,
>   (SELECT count(*) FROM "QuestionKnowledgePoint"  WHERE "questionId" = '<该题id>') AS legacy_links,
>   (SELECT count(*) FROM "QuestionKnowledgeNodeTag") AS tag_rows_total,
>   (SELECT count(*) FROM "Question") AS questions_total;
> SQL
> ```
> 两者都为 0 → 该题**确实**没有任何节点关联（既无直接标注也无桥接），此时拒绝是**正确行为**，需要补内容而不是改代码。

**② Mastery 变化（后值）**

```bash
psql_ro <<'SQL'
SELECT "knowledgeNodeId", mastery, version, "lastLearnedAt", "lastReviewedAt"
FROM "UserKnowledgeMastery"
WHERE "lastLearnedAt" > now() - interval '15 minutes'
ORDER BY "lastLearnedAt" DESC
LIMIT 10;
SQL
```

**预期输出**：至少一行；`mastery` **与 §12.4 记录的前值不同**；`version` **比前值 +1**（OCC 生效）。

**失败时怎么办**：
- 无行 / `mastery` 未变 / `version` 未变 → **M3 未生效** → 核对 §3 提交、§11 语义、日志中的 `Review mastery projection applied`。

**③ Priority / Opportunity / Recommendation（下游）**

```bash
# 用 teacher/admin token（该端点仅 teacher/admin）
curl -s "http://127.0.0.1/api/coach/shadow-decision-chain?userId=<该学生userId>&windowDays=7" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | head -c 1500; echo
```

**预期输出**：`rows[]` 中该节点出现，含 `observedMastery`（应等于 ② 的新掌握度，4 位小数）、`observedPriority`、`observedOpportunity`、`observedRank`、`attribution`。

> 说明：下游链路（mastery → priority → opportunity → rank）的**写路径**在 V12 中并未改变；这本步验证的是**新的权威掌握度已被下游读取**（`observedMastery` 必须反映 ② 的值）。真实端到端 Δpriority/Δopportunity/Δrank 已在构建机的真实 E2E 中量化（见 `docs/v12-m3-review-mastery-production-report.md` §5）。

**失败时怎么办**：`observedMastery` 与 ② 不一致 → 下游读到了旧值（缓存/事务未提交）→ 看日志与 §14。

### 12.7 日志侧确认【已验证的日志文案】

```bash
docker compose --env-file .env.production -f compose.production.yml logs app | grep 'Review mastery projection' | tail -3
```

**预期输出**（形如）：

```
[StudyService] Review mastery projection applied (evidence LEARNING_EVIDENCE:<userId>:review.recalled:<questionId>:<日期>:<attemptId>)
```

若为 `evidence_not_persisted` / `not_eligible` / `no_knowledge_node` / `already_applied` → 见 §15.2。

### CHECKPOINT 12

```
PASS → ① attempt+receipt+claim 齐全且 id 匹配；② mastery 与 version 都变了；③ observedMastery 与新值一致；日志 applied
FAIL → evidence 缺失 = P0；mastery 未变 = M3 未生效，评估回滚
```

---

## 13. Idempotency Smoke

**目的**：同一 review event 重复投递**不得**二次改变掌握度。

API contract【已验证】：`POST /wrong-questions/:questionId/reason` 的 body 支持 `idempotencyKey`（`study.controller.ts:587-594`），底层唯一约束为 `ReviewAttempt @@unique([scheduleId, idempotencyKey])`（`prisma/schema.prisma:779`）。

```bash
KEY="m3-idem-$(date -u +%Y%m%dT%H%M%SZ)"
BODY='{"selfReportedReason":"m3 idempotency smoke","redoCorrect":true,"timeSpentSec":45,"isReview":true,"idempotencyKey":"'"$KEY"'"}'

curl -s -o /dev/null -w 'request #1 HTTP %{http_code}\n' -X POST "http://127.0.0.1/api/wrong-questions/$QID/reason" \
  -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: application/json' -d "$BODY"
curl -s -o /dev/null -w 'request #2 HTTP %{http_code}\n' -X POST "http://127.0.0.1/api/wrong-questions/$QID/reason" \
  -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: application/json' -d "$BODY"
```

**预期输出**：两次都是 2xx。

```bash
# heredoc 不加引号 → 主机 shell 会展开 $KEY
psql_ro <<SQL
SELECT
  (SELECT count(*) FROM "ReviewAttempt" WHERE "idempotencyKey" = '$KEY') AS attempts,
  (SELECT count(*) FROM "UserEvent" e
     WHERE e.type = 'EVIDENCE_RECORDED'
       AND e.payload->>'occurrence' IN (SELECT id FROM "ReviewAttempt" WHERE "idempotencyKey" = '$KEY')) AS receipts,
  (SELECT count(*) FROM "UserEvent" m
     WHERE m.type = 'REVIEW_MASTERY_APPLIED'
       AND m.payload->>'evidenceEventKey' IN (
         SELECT e."eventKey" FROM "UserEvent" e
         WHERE e.type = 'EVIDENCE_RECORDED'
           AND e.payload->>'occurrence' IN (SELECT id FROM "ReviewAttempt" WHERE "idempotencyKey" = '$KEY'))) AS claims;
SQL
```

**预期输出**：`attempts = 1`，`receipts = 1`，`claims = 1`。

**失败时怎么办**：
- `attempts > 1` → 幂等键未生效 → **P1**：暂停进一步流量，记录并评估。
- `claims > 1` → **P0：掌握度可能被重复应用** → 立即 §16 rollback 并上报。
- 两次请求间 mastery 明显二次变化 → **P0**（同上报）。

> **已知限制（不要伪造参数掩盖）**：**不带** `idempotencyKey` 的重复请求在服务端与"学生真的又复习了一次"**不可区分**，因此**无法去重**。这是记录在案的设计边界（`docs/v12-m3-review-mastery-production-report.md` §4），不是本次可修的问题。若生产客户端当前不发送该键，本节仍可执行（手工指定键），但要同时记录"真实客户端尚未使用该字段"。

### CHECKPOINT 13

```
PASS → attempts=1, receipts=1, claims=1，mastery 只变一次 → 进入 §14
FAIL → claims>1 或 mastery 二次变化 → P0 回滚
```

---

## 14. Data Integrity Check

全部为**只读**查询。**禁止** `DELETE` / `UPDATE` / `TRUNCATE` / `DROP`。

### 14.1 五张关键表的存在性与近期活动

```bash
psql_ro <<'SQL'
SELECT 'ReviewAttempt' AS t, count(*) FROM "ReviewAttempt"
UNION ALL SELECT 'ReviewSchedule', count(*) FROM "ReviewSchedule"
UNION ALL SELECT 'UserKnowledgeMastery', count(*) FROM "UserKnowledgeMastery"
UNION ALL SELECT 'UserEvent:EVIDENCE_RECORDED', count(*) FROM "UserEvent" WHERE type = 'EVIDENCE_RECORDED'
UNION ALL SELECT 'UserEvent:REVIEW_MASTERY_APPLIED', count(*) FROM "UserEvent" WHERE type = 'REVIEW_MASTERY_APPLIED'
UNION ALL SELECT 'RecommendationAction', count(*) FROM "RecommendationAction";
SQL
```

**预期**：均返回合法计数（0 也可，但 `ReviewAttempt` 与 `UserEvent` 在 §12/§13 之后必须 > 0）。

### 14.2 新 review 是否"有证据 + 有掌握度迁移"（**缺口闭合证明**）

```bash
psql_ro <<'SQL'
SELECT count(*) AS recent_attempts,
       count(e.id) AS with_receipt,
       count(m.id) AS with_claim
FROM "ReviewAttempt" a
LEFT JOIN "UserEvent" e ON e.type = 'EVIDENCE_RECORDED' AND e.payload->>'occurrence' = a.id
LEFT JOIN "UserEvent" m ON m.type = 'REVIEW_MASTERY_APPLIED' AND m.payload->>'evidenceEventKey' = e."eventKey"
WHERE a."reviewedAt" > now() - interval '1 day';
SQL
```

**预期**：`recent_attempts = with_receipt = with_claim`（三者相等）。这正是修复前 31:15 的问题所在，现在必须 1:1。

### 14.3 无重复应用（认领事件唯一）

```bash
psql_ro <<'SQL'
SELECT count(*) AS total_claims, count(DISTINCT "eventKey") AS distinct_keys
FROM "UserEvent" WHERE type = 'REVIEW_MASTERY_APPLIED';
SQL
```

**预期**：`total_claims = distinct_keys`（唯一约束保证）。

### 14.4 无跨学生串数据

```bash
psql_ro <<'SQL'
SELECT count(*) AS cross_student
FROM "UserEvent" e
JOIN "ReviewAttempt" a ON e.payload->>'occurrence' = a.id
JOIN "ReviewSchedule" s ON s.id = a."scheduleId"
WHERE e."userId" <> s."userId";
SQL
```

**预期**：`cross_student = 0`。**任何非 0 → P0。**

### 14.5 无异常 version（OCC 健康）

```bash
psql_ro <<'SQL'
SELECT min(version) AS min_v, max(version) AS max_v,
       count(*) FILTER (WHERE version < 0) AS negative
FROM "UserKnowledgeMastery";
SQL
```

**预期**：`negative = 0`；`min_v >= 0`；`max_v` 随使用增长（不应出现异常巨大的跳变，例如远超该节点的复习次数）。

### 14.6 历史行未被改写（**关键**）

```bash
psql_ro <<'SQL'
SELECT count(*) AS total,
       count(*) FILTER (WHERE "isReview" IS NULL
                          AND "scheduleDriven" IS NULL
                          AND source IS NULL
                          AND "dueAt" IS NULL) AS all_meta_null
FROM "ReviewAttempt";
SQL
```

**预期**：`all_meta_null` ≥ 部署前该表的总行数（即**部署前**的所有行都保持 NULL）。部署**之后**新增的行可以非 NULL —— 这是正确行为（新事实被记录），不是回填。

**失败时怎么办**：若部署前的老行被写入了值 → **P0：历史被伪造** → 停止并上报。

### 14.7 没有 backfill 的旁证（迁移不含 UPDATE）

```bash
git show origin/feature/v3-product-refactor:prisma/migrations/20260912000000_review_attempt_schedule_metadata/migration.sql | grep -Ei 'update|insert|delete|backfill' || echo 'no data-rewriting statement (expected)'
```

**预期**：`no data-rewriting statement (expected)`

### CHECKPOINT 14

```
PASS → 14.2 三数相等、14.3 唯一、14.4 = 0、14.5 negative = 0、14.6 老行全 NULL、14.7 无 UPDATE
FAIL → 14.4 非 0 或 14.3 重复 → P0 回滚
```

---

## 15. Log Check

### 15.1 命令

```bash
docker compose --env-file .env.production -f compose.production.yml logs --tail=300 app
docker compose --env-file .env.production -f compose.production.yml logs --tail=150 gateway
docker compose --env-file .env.production -f compose.production.yml logs --tail=150 postgres
```

【已验证】容器日志为 `json-file` 驱动，`max-size: 10m`，`max-file: 3`（`compose.production.yml:30-34,112-116,133-137`）。

### 15.2 日志分级

**正常日志示例**

| 类别 | 文案 |
|---|---|
| 启动 | `Nest application successfully started`、`API running on http://localhost:3000` |
| 环境 | `Environment: production` |
| 演示登录 | `Demo auth: disabled`（生产必须 disabled） |
| **C1 自证** | `Mastery semantics: legacy — legacy（现行生产语义）（未设置，使用默认）` |
| 数据库 | Prisma 无 P1001/P1012/P1017 报错；`checks.database = connected` |
| 复习投影 | `Review mastery projection applied (evidence LEARNING_EVIDENCE:...)` |
| 请求 | `POST /wrong-questions/<qid>/reason 200/201` |
| 迁移 | 启动阶段 `migrate deploy` 无错误 |

**需要警惕的日志（P1：暂停进一步流量并排查）**

| 文案 | 含义 |
|---|---|
| `Review mastery projection evidence_not_persisted` | 证据台账写失败 → 该观测**未**进入掌握度（边界正确，但要查存储） |
| `Review mastery projection no_knowledge_node` | 题目缺节点标签 → 观测记录但不影响掌握度 |
| `Review mastery projection already_applied` | 重复投递被正确拦截（正常，但若频繁出现说明客户端在重试） |
| `Duplicate review request ... lost the race` | 并发重复被唯一约束拦下（正常且安全） |
| `MasteryOptimisticLockConflictError` 偶发 | OCC 冲突（≤3 次重试后仍失败才抛出）；偶发可接受，持续需查并发 |
| transaction / rollback 相关错误 | 事务未提交，需确认是否伴随数据不一致 |
| Prisma `P2002` | 唯一约束冲突（多数是幂等路径的正常结果） |

**必须回滚的日志（P0）**

| 文案 / 现象 | 含义 |
|---|---|
| `Mastery semantics: c1` | **C1 被意外启用** |
| `checks.database = disconnected` / 持续 503 | 数据库不可用 |
| 大量 5xx（比例失控） | 服务不可用 |
| 任何 `DROP`/`TRUNCATE`/数据重置痕迹 | 破坏性行为 |
| 跨学生数据迹象 | 隔离失效 |
| 证据大面积缺失（`evidence_not_persisted` 成片） | 台账故障 |

```bash
# 5xx 快速统计
docker compose --env-file .env.production -f compose.production.yml logs --tail=2000 app | grep -cE '\b5[0-9]{2}\b' || true
# 事务/约束异常
docker compose --env-file .env.production -f compose.production.yml logs --tail=2000 app | grep -Ei 'rollback|transaction|P2002|P1001|P1012|OptimisticLock' | tail -20
```

### CHECKPOINT 15

```
PASS → 启动日志含 legacy、无 P1001/P1012、无 5xx 潮、无 P0 关键词 → 进入 §17
FAIL → P0 关键词 → 立即 §16
```

---

## 16. Rollback

### 16.1 关键前提：**不要因为回滚代码就删字段**

本次迁移是 **additive + nullable + 无默认 + 无回填**，因此：

- **旧代码完全不引用这 4 列** → 保留 schema 与旧代码**完全兼容**。
- 删列会**永久丢失**新写入的排程元数据，且**不会**回退已写入的掌握度（历史事实不应被回滚改写）。
- 因此**默认不删列**。

### 16.2 安全顺序（推荐：只回滚代码，**保留 schema**）

```bash
cd <REPO_DIR>

# ① 记录当前（失败版本）状态，便于事后分析
docker compose --env-file .env.production -f compose.production.yml logs --tail=200 app > /tmp/m3-failed-app.log 2>&1 || true

# ② 回到部署前记录的提交
cat /tmp/m3-pre-deploy-commit.txt           # 确认这个值是 §3 记录的
git switch --detach "$(cat /tmp/m3-pre-deploy-commit.txt)"
git rev-parse HEAD

# ③ 重建并等待健康（保留新列，旧代码忽略它们）
docker compose --env-file .env.production -f compose.production.yml up -d --build --wait --wait-timeout 60

# ④ 验证
curl -sS -o /dev/null -w 'health HTTP %{http_code}\n' http://127.0.0.1/health
```

**或者使用仓库自带的回滚脚本（更省事，且带自动恢复）**

```bash
sh deploy/tencent-ip/rollback.sh "$(cat /tmp/m3-pre-deploy-commit.txt)"
```

`deploy/tencent-ip/rollback.sh` 会：校验目标 commit 存在 → 要求工作树干净 → **先备份数据库** → `git switch --detach <commit>` → `up -d --build --wait` → 网关健康检查；若失败，`trap` 会**自动**切回原提交并重建（第 69-88 行）。它还会明确打印"**数据库迁移不会自动回滚**"。

**预期输出**：`Rollback succeeded at commit <commit>.` + `docker compose ps`

**失败时怎么办**：
- `Working tree is not clean` → 先处理改动（**不要** `--hard` 强覆盖）。
- `Target is not an existing commit` → 你抄错了 commit；回查 `/tmp/m3-pre-deploy-commit.txt`。
- 回滚后仍不健康 → 看日志；必要时考虑配置回滚（§16.3）。**注意**：此时脚本已切到 detached HEAD，事后要人工确认 `git rev-parse HEAD` 是**稳定版**。

### 16.3 配置回滚（仅当怀疑环境变量引入问题时）

```bash
# 确认 app 容器内该变量不存在（C1 应为 unset）
docker compose --env-file .env.production -f compose.production.yml exec -T app sh -c 'echo "${MASTERY_SEMANTICS:-unset}"'
# 若确实存在，且不在 compose 文件中：说明有人改了 compose；查看差异后人工修正
git diff compose.production.yml
docker compose --env-file .env.production -f compose.production.yml up -d --force-recreate app
```

### 16.4 数据库回滚（**最后手段，需所有者批准**）

按 `docs/v12-m3-review-mastery-production-report.md` §14，SQL 为：

```sql
ALTER TABLE "ReviewAttempt"
  DROP COLUMN "isReview",
  DROP COLUMN "scheduleDriven",
  DROP COLUMN "source",
  DROP COLUMN "dueAt";
```

**执行前提（缺一不可）**：① 代码已回滚到不依赖这些列的版本；② 所有者明确批准；③ 已确认不再需要这些元数据；④ 先做过备份。

**回滚会丢什么 / 不会丢什么**：
- **会丢**：仅新 attempt 的排程元数据。
- **不会丢**：`ReviewAttempt` / `ReviewSchedule` / `UserKnowledgeMastery` / 证据台账 / 认领事件全部保留；**已写入的掌握度不回退**。

### 16.5 数据恢复（**危险，默认不做**）

`deploy.sh` 与 `rollback.sh` 的备份位于仓库目录下的 `backups/`（`compose.production.yml:54` 把 `./backups` 挂成 `/backups`；`backup.sh:18` 命名为 `kaoyan408-<UTC>.dump`，含 `.sha256`；保留天数由 `BACKUP_RETENTION_DAYS` 控制）。

列出可用备份：

```bash
ls -lh --time-style=long-iso backups/kaoyan408-*.dump | tail -10
```

> 恢复会**丢弃部署后的新数据**（真实学生的复习与掌握度变化）。**默认不执行**；仅在所有者为数据一致性明确要求时，由所有者决策。

### CHECKPOINT 16

```
PASS → 回滚到记录的提交、health 200、ps 三容器健康、日志无 P0
FAIL → 保持停机 + 上报；不要在未备份的情况下做数据库操作
```

---

## 17. Final Acceptance Checklist

全部满足才可判定 **`M3 PRODUCTION DEPLOYMENT = VERIFIED`**；否则 **`DEPLOYMENT = NOT VERIFIED`**。

```
[ ] commit 正确                       → git rev-parse HEAD == c7d9093685ed82070b312a575e2ac5eac49d0f3a
[ ] branch 正确                       → 部署来源 = origin/feature/v3-product-refactor（detached HEAD 属预期）
[ ] worktree clean                    → git status --short 为空
[ ] migration status PASS             → 36 个迁移，Database schema is up to date
[ ] 4 列存在且 nullable 无默认         → §5.5 四行全 YES / default 空
[ ] 历史行 metadata 全 NULL            → §5.6 / §14.6
[ ] build PASS                        → deploy.sh "Deployment succeeded"，三镜像重建成功
[ ] service running                   → ps 三容器 running，postgres/app healthy
[ ] health 200                        → status ok + database connected + dataSource postgresql
[ ] endpoint routes exist             → §10.2 全部 401（无 404）
[ ] auth guard PASS                   → 未认证 401；认证后 200；学生访问 teacher/admin 端点 403
[ ] C1 OFF                            → 容器内 unset + 启动日志 legacy + 认领事件只出现 legacy
[ ] review PASS                       → §12.5 复习请求 2xx
[ ] evidence PASS                     → §12.6① receipt 非空且 occurrence == attempt.id
[ ] mastery_claim PASS                → §12.6① REVIEW_MASTERY_APPLIED 存在且 semantics=legacy（为空 = M3 未生效 → NOT VERIFIED）
[ ] mastery PASS                      → §12.6② mastery 与 version 都变化
[ ] idempotency PASS                  → §13 attempts=1 / receipts=1 / claims=1
[ ] student isolation PASS            → §14.4 cross_student = 0
[ ] priority PASS                     → §12.6③ observedPriority 可读
[ ] opportunity PASS                  → §12.6③ observedOpportunity 可读
[ ] recommendation PASS               → §12.6③ observedRank / attribution 可读，observedMastery == 新值
[ ] logs clean                        → 无 P0 关键词，无 5xx 潮
[ ] no P0                             → §18 的 P0 清单全部未触发
[ ] no new regression                 → 构建机基线：npm test 2321/2319/0/2，NEW REGRESSION = 0（服务器不复跑）
```

### P0 — 立即停止 / rollback

- 跨学生数据污染（§14.4 非 0）
- **掌握度重复应用**（§13 `claims > 1`，或 mastery 二次变化）
- 破坏性数据库行为（任何 DROP/TRUNCATE/DELETE 痕迹）
- **C1 意外启用**（日志 `c1` / 认领事件 `semantics=c1`）
- 大规模 5xx（服务不可用）
- 证据大面积丢失（`evidence_not_persisted` 成片）
- 数据库损坏 / 不可连接

### P1 — 暂停进一步流量

- 推荐排序异常churn（短时间内大量排名翻转）
- **mastery delta 明显偏离 cohort**（构建机队列实测量级：单步 |Δmastery| 约 0.004–0.30；若生产出现远超此量级或方向反直觉的成片变化，暂停）
- review / evidence 数量不匹配（§14.2 三数不等）
- 持续事务错误
- schedule / evidence 异常丢失

---

## 18. Troubleshooting

| 症状 | 可能原因 | 处置 |
|---|---|---|
| `Missing .env.production` | 目录不对 | 回 §2 定位；**不要**新建第二套 |
| `PUBLIC_IP is invalid.` | 私网/保留地址或占位符 | 改为全球可达 IPv4（`deploy.sh:17-40` 的判定） |
| `POSTGRES_PASSWORD is invalid.` | 长度 < 24 或含非 URL-safe 字符 | 用 base64url 字符集，≥24 位 |
| `JWT_SECRET is invalid.` | 长度 < 32 或仍是占位符 | 生成 ≥32 位随机值 |
| `Existing PostgreSQL container is not running and healthy; refusing deployment...` | postgres 不健康 | 先修数据库；**不要**绕过备份门禁 |
| `Gateway health check did not succeed within 60 seconds.` | app 未起来 | `logs app`；常见：迁移失败、`DATABASE_URL` 错、OOM |
| 构建 OOM（2C2G） | `NODE_OPTIONS` 过大 | compose 已设 `--max-old-space-size=512`（`:90`）；确认未被覆盖；必要时临时增加 swap |
| 端点全部 404 | 部署了错误提交（tag 或默认分支） | 回 §0.2；`git rev-parse HEAD` 核实 |
| `GET /api/...` 502/504 | app 不健康或未起 | `logs app`、`ps` |
| 主机 `curl 127.0.0.1:3000` 失败 | **预期**：app 未发布主机端口 | 用 `http://127.0.0.1/api/...`（§10.1） |
| `demo-login` 失败 | **预期**：生产禁用 | 用真实测试账号（§1.3） |
| 登录 429 | 生产节流 10 次/60 秒 | 等 60 秒；**不要**放宽节流 |
| 登录 401 但密码确定正确 | 邮箱大小写归一 | 使用账号**实际存储**的邮箱（登录会小写化） |
| 复习 400 `has no practice history` | 该题该用户无练习记录 | 换有错题的测试账号（§12.3） |
| `mastery_claim` 为空（`no_knowledge_node`） | 题目解析不到知识节点 → 投影安全拒绝，M3 未生效 | 查 `question-node-resolution.ts` 是否在部署提交里；再查该题的直接标注/桥接（§12.6 ①）。**不是 P0，但判 NOT VERIFIED** |
| `evidence_receipt` 为 NULL | M3 边界破坏 | **P0** → §16 |
| `mastery` 未变 | 旧提交 / 迁移未应用 / 语义不对 | 核 §3、§5、§11 |
| `migrate status` 报 drift | 有人手工改过库 | **停止**；**禁止** `migrate reset`（§19 禁止项） |
| 服务器 checkout 在 detached HEAD | 正常（`switch --detach` / `rollback.sh` 的结果） | 无操作；回滚目标用 commit 而非分支名 |

---

## 19. Deployment Completion Record

> 人工填写并存档（本文件不改动，另存副本）。

```
== 部署标识 ==
部署执行人:                       ____________________
部署开始时间(UTC):                ____________________
部署结束时间(UTC):                ____________________
REPO_DIR（§2 确认）:              ____________________
生产 IP:                          ____________________

== 版本 ==
回滚点 commit（§3a 记录）:        ____________________
部署后 commit:                    c7d9093685ed82070b312a575e2ac5eac49d0f3a
分支来源:                         origin/feature/v3-product-refactor
使用的 tag:                       无（现有 v12.0.0 tag 落后 10 提交，未使用）
detached HEAD（预期为 yes）:      ____________________

== 迁移 ==
部署前迁移数:                     ____________________
部署后迁移数:                     36
4 列验证（§5.5）:                 PASS / FAIL
历史行 metadata 全 NULL（§5.6）:  PASS / FAIL

== C1 ==
容器内 MASTERY_SEMANTICS（§11.1）: unset / <其他>
启动日志语义（§11.2）:            legacy / <其他>
认领事件语义（§11.3）:            legacy / 无行 / <其他>

== Smoke（§12/§13）==
测试学生账号:                     ____________________
测试 questionId:                  ____________________
测试 knowledgeNodeId:             ____________________
mastery_before / version_before:  ____________________ / ____________________
mastery_after  / version_after:   ____________________ / ____________________
evidence receipt（occurrence 匹配 attempt）: PASS / FAIL
mastery claim（semantics）:       ____________________
observedPriority / Opportunity / Rank（§12.6③）: ____________________
日志 "Review mastery projection applied": PASS / FAIL
幂等 attempts / receipts / claims: ______ / ______ / ______

== 备份 ==
部署前备份文件:                   backups/kaoyan408-____________________.dump
备份校验文件存在:                 PASS / FAIL

== 判定 ==
P0 事件:                          无 / ____________________
P1 事件:                          无 / ____________________
最终判定:                         M3 PRODUCTION DEPLOYMENT = VERIFIED
                                  / DEPLOYMENT = NOT VERIFIED
```

### 人工执行时的"绝对禁止事项"

```
[禁止] 不要 git reset 到错误 branch（尤其 codex/deployment-ready）
[禁止] 不要 git push --force
[禁止] 不要 prisma migrate reset
[禁止] 不要删除 production DB
[禁止] 不要修改历史 mastery
[禁止] 不要手动 UPDATE "UserKnowledgeMastery"
[禁止] 不要直接改 evidence 数据（UserEvent）
[禁止] 不要关闭 auth / 不要绕过 RoleGuard
[禁止] 不要启用 C1（MASTERY_SEMANTICS=c1）
[禁止] 不要输出 secrets（.env.production / API key / token / 密码）
[禁止] 不要复制测试数据到 production
[禁止] 不要用 v12.0.0-score-improvement-engine tag 部署本次版本（落后 10 提交，不含 M3）
[禁止] 不要用裸 git pull（默认分支不含 M3）
[禁止] 不要为了"让 smoke 变绿"而放宽断言、跳过步骤或伪造幂等键语义
```

---

## 附录 A — 本 Runbook 的命令证据来源

| 内容 | 仓库证据 |
|---|---|
| 部署入口脚本及其全部行为 | `deploy/tencent-ip/deploy.sh`（183 行） |
| 回滚脚本及其自动恢复逻辑 | `deploy/tencent-ip/rollback.sh`（102 行） |
| 备份命名/校验/保留策略 | `deploy/tencent-ip/backup.sh`（50 行） |
| 备份 cron 安装 | `deploy/tencent-ip/install-backup-cron.sh` |
| 备份可恢复性校验 | `deploy/tencent-ip/verify-restore.sh` |
| 三服务、卷、健康检查、资源上限 | `compose.production.yml`（141 行） |
| 迁移自动执行（容器 CMD） | `Dockerfile:49` |
| nginx 路由（`/api/`、`/health`、SPA fallback） | `deploy/tencent-ip/nginx.conf`（30 行） |
| 网关镜像（nginx 在容器内） | `Dockerfile.web` |
| 生产环境变量模板与校验规则 | `deploy/tencent-ip/.env.production.example`；`deploy.sh:98-135` |
| `/health` 响应结构与 503 语义 | `apps/api/src/health.controller.ts:11-58` |
| 演示登录的生产禁用 | `apps/api/src/auth/auth.service.ts:75`；`compose.production.yml:69,74` |
| 登录节流 10 次/60 秒 | `apps/api/src/auth/auth.controller.ts:22` |
| 端点角色矩阵 | `apps/api/src/study/daily-brief.controller.ts:184,410,436,451`；`study.controller.ts:581,749` |
| 复习请求体契约（含 `idempotencyKey`） | `apps/api/src/study/study.controller.ts:587-594` |
| 幂等唯一约束 | `prisma/schema.prisma:779` |
| 新增 4 列 | `prisma/schema.prisma:779-782` |
| 迁移内容 | `prisma/migrations/20260912000000_review_attempt_schedule_metadata/migration.sql` |
| 证据/认领事件类型与载荷键 | `apps/api/src/study/review-mastery-integration.service.ts`；`learning-evidence.service.ts` |
| 迁移数 34 → 36 | 生产实测：服务器原 HEAD `32ab233` 落后 38 提交，本次落地 2 个迁移（`question_rubric` + `review_attempt_schedule_metadata`） |
| 生产语义影响与回滚说明 | `docs/v12-m3-review-mastery-production-report.md`（§13/§14） |
| 上一版发布流程（部分已作废） | `docs/v12-release-package.md`；`docs/v11-final-release-server-steps.md` |

## 附录 B — 本 Runbook 明确标注为 UNVERIFIED 的条目

1. **服务器仓库路径**（文档冲突：`~/kaoyan-408-score-boost` vs `/srv/kaoyan408`，且都自注"以实际为准"）→ §2 现场确认。
2. **当前生产 commit（回滚点）**（文档冲突且 V12 部署状态为 DEFERRED）→ §3a 现场记录。
3. **生产 IP / SSH 凭据**（仓库仅有历史归档文档与脚本默认值引用 `43.128.30.191`）→ §1.2 现场确认。
4. **服务器是否已装 Docker / Compose 插件版本**（`deploy.sh` 只检查存在性）→ §1 现场确认。
5. **`docker compose run --rm --entrypoint sh app` 手工迁移路径**（未经仓库脚本验证）→ §5.5 标注。
6. **`npm test` 在生产服务器上的可行性**（2C2G 资源约束，仓库将其定为构建机 `predeploy`）→ §7.2 标注。

> 已在本轮修正、**不再**列为 UNVERIFIED 的一项：初稿的 SQL 曾依赖主机侧 `$POSTGRES_USER` 且使用多层引号转义（复制粘贴会失败）。现已统一为 §5.2 的 `psql_ro` 函数（容器内环境变量 + heredoc），全文档 14 处 SQL 均使用该形式，且 SQL 内容不再需要任何引号转义。

## 附录 C — 【已作废】不要照抄的旧文档步骤

| 旧步骤 | 出处 | 为什么作废 |
|---|---|---|
| `curl http://127.0.0.1:3000$p` | `docs/v11-final-release-server-steps.md:35` | `app` 服务未发布主机端口；必须走 `/api`（§10.1） |
| `POST /auth/demo-login` 取 token | `docs/v11-final-release-server-steps.md:44` | 生产 `NODE_ENV=production` + `ALLOW_DEMO_AUTH=false` 硬禁用（§1.3） |
| `cd ~/kaoyan-408-score-boost` | `docs/v11-final-release-server-steps.md:12` | 路径未验证，且与另一文档冲突（附录 B.1） |
| 用 tag 部署 | `docs/v12-release-package.md` §6 命名习惯 | 现有 tag 落后 10 提交、不含 M3（§0.2） |
| `git reset --hard <branch>` 直接拉取 | `docs/v12-release-package.md:60-61` | 可行但会丢弃未知改动；本 Runbook 改为先验 `git status` 再用 `switch --detach` 显式提交（§6） |
