# 腾讯云单入口生产部署 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 React、NestJS 和 PostgreSQL 迁移为腾讯云中国大陆轻量服务器上的单域名生产部署，并提供自动发布、回滚、备份、监控和中文运维手册。

**Architecture:** Caddy 作为唯一公网入口并自动管理 HTTPS；单个 NestJS 应用在 `/api` 提供 API，同时托管 React SPA，PostgreSQL 只在 Docker 私有网络中开放。GitHub Actions 通过受限 SSH 密钥调用服务器发布脚本，数据库备份由 systemd timer 上传腾讯云 COS。

**Tech Stack:** Tencent Cloud Lighthouse、Docker Compose、Caddy 2、Node 22、NestJS 10、React/Vite、PostgreSQL 16、GitHub Actions、腾讯云 COSCLI、systemd。

## Global Constraints

- 初始服务器规格为中国大陆 2 核 2GB、40GB 系统盘，面向 10–20 名学生内测。
- 学生只访问一个已备案独立域名；备案完成前不得公开向学生提供服务。
- 公网只开放 80/443，SSH 仅允许管理员固定来源；PostgreSQL 不映射宿主机端口。
- 生产环境 `ALLOW_DEMO_AUTH=false`，`JWT_SECRET` 至少 32 字符。
- 所有 API 统一位于 `/api`，React SPA 位于 `/`。
- 应用发布失败必须恢复上一应用版本；数据库迁移只允许向后兼容，不自动逆向回滚。
- 每日 PostgreSQL 自定义格式备份上传 COS，保留 30 天；每周创建服务器快照。
- COS 备份桶必须启用服务端加密，访问密钥只允许写入、读取和列出指定备份前缀。
- 恢复生产数据库前必须生成当前安全备份并显式确认数据库名。
- 域名购买、实名认证、ICP 备案、云资源购买和生产部署需要用户单独授权及其腾讯云账号操作。
- 本计划在邀请码与题库导入两个应用计划验收通过后执行。

---

## File Structure

- `apps/api/src/app.module.ts`：注册 SPA 静态托管。
- `apps/api/src/main.ts`：设置 `/api` 全局前缀和同源生产配置。
- `apps/web/src/api/client.ts`：生产使用 `/api`，开发使用本地 API。
- `Dockerfile`：同时构建并复制前端、API 和 Prisma 产物。
- `compose.production.yml`：Caddy、应用、PostgreSQL 和私有网络。
- `deploy/tencent-cloud/Caddyfile`：域名、HTTPS 和安全响应头。
- `deploy/tencent-cloud/bootstrap-server.sh`：安装 Docker、COSCLI、目录和防火墙。
- `deploy/tencent-cloud/release.sh`：受控发布、健康检查和应用回滚。
- `deploy/tencent-cloud/backup-postgres.sh`：备份、校验、上传和状态标记。
- `deploy/tencent-cloud/restore-postgres.sh`：显式确认后的安全恢复。
- `deploy/tencent-cloud/systemd/*`：每日备份定时器。
- `.github/workflows/deploy-tencent.yml`：测试通过后 SSH 发布。
- `apps/api/src/operations/system-status.service.ts`、`system-status.controller.ts`：管理员系统状态 API。
- `apps/web/src/features/admin/SystemStatusPanel.tsx`：只读状态页面。
- `docs/operations/tencent-cloud-launch.md`：购买、备案、上线和回滚。
- `docs/operations/backup-and-restore.md`：备份、恢复和演练。
- `docs/admin/production-operations.md`：非技术管理员日常操作。
- `test/tencent-deployment-config.test.js`、`test/system-status-ui.test.js`：部署契约与 UI 契约。

### Task 1: 单域名应用与生产镜像

**Files:**
- Create: `test/single-origin-production.test.js`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `Dockerfile`
- Modify: `.env.production.example`
- Modify: `package-lock.json`
- Test: `test/single-origin-production.test.js`
- Test: `test/deployment-config.test.js`

**Interfaces:**
- Produces: SPA at `/`
- Produces: API at `/api/*`
- Produces: health endpoint `GET /api/health`
- Produces: production image containing `/app/apps/web/dist`

- [ ] **Step 1: 安装 Nest 静态托管模块**

Run: `npm install @nestjs/serve-static -w apps/api`

Expected: package files update，exit 0。

- [ ] **Step 2: 写失败的单入口契约测试**

```js
test('production serves SPA and prefixes every API route with /api', async () => {
  const main = await readFile(new URL('../apps/api/src/main.ts', import.meta.url), 'utf8');
  const module = await readFile(new URL('../apps/api/src/app.module.ts', import.meta.url), 'utf8');
  const client = await readFile(new URL('../apps/web/src/api/client.ts', import.meta.url), 'utf8');
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(main, /app\.setGlobalPrefix\('api'\)/);
  assert.match(module, /ServeStaticModule\.forRoot/);
  assert.match(client, /import\.meta\.env\.PROD\s*\?\s*'\/api'/);
  assert.match(dockerfile, /RUN npm run build:web/);
  assert.match(dockerfile, /apps\/web\/dist/);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test test/single-origin-production.test.js`

Expected: FAIL。

- [ ] **Step 4: 配置 SPA 与 `/api`**

```ts
// apps/api/src/app.module.ts
ServeStaticModule.forRoot({
  rootPath: join(__dirname, '..', '..', 'web', 'dist'),
  exclude: ['/api*'],
})
```

```ts
// apps/api/src/main.ts
app.setGlobalPrefix('api');
```

```ts
// apps/web/src/api/client.ts
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL
  ?? (import.meta.env.PROD ? '/api' : 'http://127.0.0.1:3000/api');
```

`vite.config.ts` 生产 `base` 固定为 `/`。同源生产模式下 `WEB_ORIGIN=https://<domain>`，CORS 仍只允许正式域名。

- [ ] **Step 5: 扩展 Dockerfile**

构建阶段复制 `apps/web` 并运行：

```dockerfile
RUN npm run build:shared
RUN cd apps/api && npx prisma generate --schema ../../prisma/schema.prisma
RUN npm run build -w apps/api
RUN npm run build -w apps/web
```

生产阶段复制：

```dockerfile
COPY --from=builder /app/apps/web/dist apps/web/dist/
```

容器健康检查使用 `http://127.0.0.1:3000/api/health`。

- [ ] **Step 6: 更新测试和示例环境**

`.env.production.example`：

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://kaoyan408:${POSTGRES_PASSWORD}@postgres:5432/kaoyan408?schema=public
WEB_ORIGIN=https://your-filed-domain.example
JWT_SECRET=replace-with-at-least-32-random-characters
ALLOW_DEMO_AUTH=false
AUDIT_LOG_RETENTION_DAYS=90
RELEASE_SHA=local
BACKUP_STATUS_FILE=/var/run/kaoyan408/last-backup.json
```

更新所有部署测试和 staging 脚本，将健康路径改为 `/api/health`。

- [ ] **Step 7: 运行验证**

Run: `node --test test/single-origin-production.test.js test/deployment-config.test.js test/staging-smoke.test.js`

Expected: PASS。

Run: `npm run build:api`

Expected: exit 0。

Run: `npm run build:web`

Expected: exit 0。

Run: `docker build --tag kaoyan408:single-origin .`

Expected: image 构建成功且包含前端产物。

- [ ] **Step 8: 提交**

```bash
git add apps/api/package.json apps/api/src/app.module.ts apps/api/src/main.ts apps/web/src/api/client.ts apps/web/vite.config.ts Dockerfile .env.production.example package-lock.json test/single-origin-production.test.js test/deployment-config.test.js scripts/staging-smoke.mjs test/staging-smoke.test.js
git commit -m "feat: serve production app from one origin"
```

### Task 2: Docker Compose、Caddy 和服务器加固

**Files:**
- Create: `compose.production.yml`
- Create: `deploy/tencent-cloud/Caddyfile`
- Create: `deploy/tencent-cloud/bootstrap-server.sh`
- Create: `deploy/tencent-cloud/production.env.example`
- Create: `test/tencent-deployment-config.test.js`
- Modify: `.gitignore`
- Test: `test/tencent-deployment-config.test.js`

**Interfaces:**
- Produces: Compose services `caddy`, `app`, `postgres`
- Produces: Docker network `backend`
- Produces: persistent volumes `postgres_data`, `caddy_data`, `caddy_config`
- Produces: server directories `/opt/kaoyan408`, `/var/backups/kaoyan408`, `/var/run/kaoyan408`

- [ ] **Step 1: 写失败的部署契约测试**

```js
test('production compose exposes only Caddy and keeps PostgreSQL private', async () => {
  const compose = await readFile(new URL('../compose.production.yml', import.meta.url), 'utf8');
  assert.match(compose, /caddy:\s*[\s\S]*"80:80"[\s\S]*"443:443"/);
  assert.doesNotMatch(compose, /postgres:\s*[\s\S]*ports:/);
  assert.match(compose, /postgres_data:/);
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /restart:\s+unless-stopped/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/tencent-deployment-config.test.js`

Expected: FAIL。

- [ ] **Step 3: 编写生产 Compose**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    env_file: deploy/tencent-cloud/production.env
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks: [backend]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 10s
      timeout: 5s
      retries: 10

  app:
    build: .
    restart: unless-stopped
    env_file: deploy/tencent-cloud/production.env
    depends_on:
      postgres:
        condition: service_healthy
    networks: [backend]
    volumes:
      - /var/run/kaoyan408:/var/run/kaoyan408:ro
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 5

  caddy:
    image: caddy:2.8-alpine
    restart: unless-stopped
    env_file: deploy/tencent-cloud/production.env
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./deploy/tencent-cloud/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [backend]
```

- [ ] **Step 4: 配置 Caddy**

```caddyfile
{$APP_DOMAIN} {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    -Server
  }
  reverse_proxy app:3000
}
```

- [ ] **Step 5: 编写幂等服务器初始化脚本**

脚本必须要求 root、Ubuntu 24.04、`ADMIN_CIDR` 和 `DEPLOY_PUBLIC_KEY`，任何变量为空立即退出。核心操作：

```sh
install -d -m 0750 -o deploy -g deploy /opt/kaoyan408
install -d -m 0750 -o deploy -g deploy /var/backups/kaoyan408
install -d -m 0755 -o root -g deploy /var/run/kaoyan408
ufw default deny incoming
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw allow from "$ADMIN_CIDR" to any port 22 proto tcp
ufw --force enable
```

安装 Docker 官方仓库、Compose plugin 和 COSCLI；关闭 SSH 密码登录前先验证 deploy 用户公钥存在。

- [ ] **Step 6: 保护密钥文件**

`.gitignore` 增加：

```gitignore
deploy/tencent-cloud/production.env
deploy/tencent-cloud/*.pem
deploy/tencent-cloud/*.key
```

`production.env.example` 只含占位值和变量说明，不包含可用密钥。

- [ ] **Step 7: 运行验证**

Run: `node --test test/tencent-deployment-config.test.js`

Expected: PASS。

Run: `docker compose -f compose.production.yml --env-file deploy/tencent-cloud/production.env.example config`

Expected: Compose 结构合法；若示例占位域名触发校验，只运行 `config --no-interpolate` 并在测试中验证变量清单。

- [ ] **Step 8: 提交**

```bash
git add compose.production.yml deploy/tencent-cloud/Caddyfile deploy/tencent-cloud/bootstrap-server.sh deploy/tencent-cloud/production.env.example .gitignore test/tencent-deployment-config.test.js
git commit -m "feat: add hardened Tencent production stack"
```

### Task 3: 自动发布、健康检查和应用回滚

**Files:**
- Create: `deploy/tencent-cloud/release.sh`
- Create: `.github/workflows/deploy-tencent.yml`
- Create: `test/tencent-release-contract.test.js`
- Modify: `package.json`
- Test: `test/tencent-release-contract.test.js`

**Interfaces:**
- Produces: `deploy/tencent-cloud/release.sh <git-sha>`
- Consumes GitHub secrets: `TENCENT_DEPLOY_HOST`, `TENCENT_DEPLOY_USER`, `TENCENT_DEPLOY_SSH_KEY`, `TENCENT_DEPLOY_KNOWN_HOSTS`
- Produces: release marker `/var/run/kaoyan408/release.json`

- [ ] **Step 1: 写失败的发布契约测试**

```js
test('release script records previous SHA, checks health and rolls back application code', async () => {
  const release = await readFile(new URL('../deploy/tencent-cloud/release.sh', import.meta.url), 'utf8');
  assert.match(release, /PREVIOUS_SHA=/);
  assert.match(release, /docker compose .* up -d --build/);
  assert.match(release, /\/api\/health/);
  assert.match(release, /git checkout --detach "\$PREVIOUS_SHA"/);
  assert.match(release, /RELEASE_SHA/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/tencent-release-contract.test.js`

Expected: FAIL。

- [ ] **Step 3: 实现发布脚本**

```sh
#!/bin/sh
set -eu
RELEASE_SHA="${1:?usage: release.sh <git-sha>}"
cd /opt/kaoyan408
PREVIOUS_SHA="$(git rev-parse HEAD)"
git fetch --depth=1 origin "$RELEASE_SHA"
git checkout --detach "$RELEASE_SHA"
export RELEASE_SHA
docker compose -f compose.production.yml --env-file deploy/tencent-cloud/production.env up -d --build

if ! timeout 180 sh -c 'until curl -fsS "https://$APP_DOMAIN/api/health" >/dev/null; do sleep 5; done'; then
  git checkout --detach "$PREVIOUS_SHA"
  export RELEASE_SHA="$PREVIOUS_SHA"
  docker compose -f compose.production.yml --env-file deploy/tencent-cloud/production.env up -d --build
  exit 1
fi
```

成功后原子写入 `release.json`，包含 SHA、前一 SHA、时间和健康状态。日志不得打印环境文件。

- [ ] **Step 4: 实现 GitHub Actions**

工作流顺序：

1. `npm ci`
2. `npm test`
3. `npm run build:api`
4. `npm run build:web`
5. `docker build`
6. 写入临时 SSH 私钥（权限 600）和 `known_hosts`
7. 调用 `ssh user@host "/opt/kaoyan408/deploy/tencent-cloud/release.sh $GITHUB_SHA"`

只允许默认分支 push 和人工 `workflow_dispatch` 触发；Pull Request 不触发生产发布。设置 `concurrency: production` 和 `cancel-in-progress: false`。

- [ ] **Step 5: 运行验证**

Run: `node --test test/tencent-release-contract.test.js test/deployment-config.test.js`

Expected: PASS。

Run: `npm run check:release`

Expected: tests、前后端构建和迁移冒烟全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add deploy/tencent-cloud/release.sh .github/workflows/deploy-tencent.yml test/tencent-release-contract.test.js package.json
git commit -m "feat: add verified Tencent release pipeline"
```

### Task 4: COS 数据库备份、安全恢复和定时器

**Files:**
- Create: `deploy/tencent-cloud/backup-postgres.sh`
- Create: `deploy/tencent-cloud/restore-postgres.sh`
- Create: `deploy/tencent-cloud/systemd/kaoyan408-backup.service`
- Create: `deploy/tencent-cloud/systemd/kaoyan408-backup.timer`
- Create: `test/tencent-backup-contract.test.js`
- Modify: `deploy/tencent-cloud/bootstrap-server.sh`
- Modify: `package.json`
- Test: `test/tencent-backup-contract.test.js`

**Interfaces:**
- Produces: local dump `/var/backups/kaoyan408/kaoyan408-<UTC>.dump`
- Produces: manifest with SHA-256 and size
- Produces: COS object `cos://<bucket>/postgres/YYYY/MM/DD/...`
- Produces: `/var/run/kaoyan408/last-backup.json`
- Produces: `restore-postgres.sh --backup <file> --confirm kaoyan408`

- [ ] **Step 1: 写失败的备份契约测试**

```js
test('backup uploads verified dumps and restore requires explicit confirmation', async () => {
  const backup = await readFile(new URL('../deploy/tencent-cloud/backup-postgres.sh', import.meta.url), 'utf8');
  const restore = await readFile(new URL('../deploy/tencent-cloud/restore-postgres.sh', import.meta.url), 'utf8');
  assert.match(backup, /pg_dump/);
  assert.match(backup, /sha256sum/);
  assert.match(backup, /coscli cp/);
  assert.match(backup, /last-backup\.json/);
  assert.match(restore, /--confirm/);
  assert.match(restore, /pre-restore/);
  assert.match(restore, /pg_restore/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/tencent-backup-contract.test.js`

Expected: FAIL。

- [ ] **Step 3: 实现每日备份**

```sh
docker compose -f compose.production.yml --env-file deploy/tencent-cloud/production.env \
  exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --no-owner --no-acl > "$TMP_DUMP"
pg_restore --list "$TMP_DUMP" >/dev/null
SHA256="$(sha256sum "$TMP_DUMP" | awk '{print $1}')"
coscli cp "$TMP_DUMP" "cos://$COS_BUCKET/postgres/$DATE_PATH/"
```

先写临时文件，校验成功后再原子移动到正式文件。成功后写备份状态；失败时写 `status=failed` 并返回非零。删除 7 天以前的本地 dump；COS 30 天生命周期和默认服务端加密由上线清单配置。

- [ ] **Step 4: 实现安全恢复**

恢复脚本步骤：

1. 参数必须包含 `--backup` 和 `--confirm kaoyan408`。
2. 校验 dump 可读和 manifest SHA-256。
3. 先调用备份脚本生成 `pre-restore` 安全备份。
4. 要求环境变量 `ALLOW_PRODUCTION_RESTORE=yes`。
5. 暂停 app 容器。
6. 使用 `pg_restore --clean --if-exists --exit-on-error`。
7. 启动 app 并检查 `/api/health`。
8. 写审计日志文件。

- [ ] **Step 5: 配置 systemd timer**

```ini
[Timer]
OnCalendar=*-*-* 03:20:00 Asia/Shanghai
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
```

Service 以 `deploy` 用户执行，`WorkingDirectory=/opt/kaoyan408`，失败由腾讯云主机监控/日志告警捕获。

- [ ] **Step 6: 运行验证**

Run: `node --test test/tencent-backup-contract.test.js`

Expected: PASS。

Run: `npm run db:backup:verify -- --backup <local-test-dump>`

Expected: 测试环境 dump 校验通过；不得连接生产数据库。

- [ ] **Step 7: 提交**

```bash
git add deploy/tencent-cloud/backup-postgres.sh deploy/tencent-cloud/restore-postgres.sh deploy/tencent-cloud/systemd/kaoyan408-backup.service deploy/tencent-cloud/systemd/kaoyan408-backup.timer deploy/tencent-cloud/bootstrap-server.sh test/tencent-backup-contract.test.js package.json
git commit -m "feat: automate verified Tencent database backups"
```

### Task 5: 管理员系统状态与告警信号

**Files:**
- Create: `apps/api/src/operations/system-status.service.ts`
- Create: `apps/api/src/operations/system-status.controller.ts`
- Create: `apps/web/src/features/admin/SystemStatusPanel.tsx`
- Create: `test/system-status-ui.test.js`
- Modify: `apps/api/src/operations/operations.module.ts`
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/api/endpoints/dashboard.ts`
- Modify: `apps/web/src/hooks/useRoleWorkspaceData.ts`
- Modify: `apps/web/src/features/admin/AdminWorkspace.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `test/system-status-ui.test.js`

**Interfaces:**
- Produces: `GET /api/admin/system-status`
- Produces: `SystemStatus { application; database; backup; release; disk }`
- Consumes: `BACKUP_STATUS_FILE`, `RELEASE_SHA`

- [ ] **Step 1: 写失败的状态 UI 契约测试**

```js
test('admin system status shows database, backup, release and disk without secrets', async () => {
  const panel = await readFile(new URL('../apps/web/src/features/admin/SystemStatusPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /数据库/);
  assert.match(panel, /最近备份/);
  assert.match(panel, /发布版本/);
  assert.match(panel, /磁盘/);
  assert.doesNotMatch(panel, /DATABASE_URL|JWT_SECRET|POSTGRES_PASSWORD/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/system-status-ui.test.js`

Expected: FAIL。

- [ ] **Step 3: 实现只读状态服务**

```ts
export interface SystemStatus {
  application: { status: 'ok'; uptimeSec: number };
  database: { status: 'connected' | 'disconnected'; checkedAt: string };
  backup: { status: 'ok' | 'stale' | 'failed' | 'unknown'; completedAt?: string; ageHours?: number };
  release: { sha: string; deployedAt?: string };
  disk: { status: 'ok' | 'warning' | 'critical'; usedPercent?: number };
}
```

数据库执行 `SELECT 1`。备份超过 30 小时为 `stale`。磁盘使用率由宿主机监控脚本写入状态 JSON，API 不执行任意 shell。Controller 使用 `RoleGuard` + `@Roles('admin')`。

- [ ] **Step 4: 接入管理员界面**

`SystemStatusPanel` 使用绿/黄/红状态，不显示凭据、内部主机名或错误堆栈。备份异常提示“请联系维护人员并提供请求编号”，不要求管理员运行命令。

- [ ] **Step 5: 运行验证**

Run: `node --test test/system-status-ui.test.js`

Expected: PASS。

Run: `npm run build:api`

Expected: exit 0。

Run: `npm run build:web`

Expected: exit 0。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/operations/system-status.service.ts apps/api/src/operations/system-status.controller.ts apps/api/src/operations/operations.module.ts apps/web/src/features/admin/SystemStatusPanel.tsx apps/web/src/api/types.ts apps/web/src/api/endpoints/dashboard.ts apps/web/src/hooks/useRoleWorkspaceData.ts apps/web/src/features/admin/AdminWorkspace.tsx apps/web/src/App.tsx apps/web/src/styles.css test/system-status-ui.test.js
git commit -m "feat: show production system health to admins"
```

### Task 6: 备案、首次上线、监控和恢复演练手册

**Files:**
- Create: `docs/operations/tencent-cloud-launch.md`
- Create: `docs/operations/backup-and-restore.md`
- Create: `docs/admin/production-operations.md`
- Modify: `docs/deployment-checklist.md`
- Modify: `README.md`
- Modify: `scripts/staging-smoke.mjs`
- Modify: `test/staging-smoke.test.js`
- Test: `test/staging-smoke.test.js`

**Interfaces:**
- Consumes: Tasks 1–5 and前两份应用计划
- Produces: 用户可逐项勾选的购买、备案、上线、监控和恢复流程

- [ ] **Step 1: 写上线手册验收清单**

`docs/operations/tencent-cloud-launch.md` 必须逐项覆盖：

```markdown
- [ ] 域名已实名认证，持有者与备案主体一致
- [ ] ICP 备案已通过，备案号按要求展示
- [ ] 腾讯云轻量服务器已购买并启用快照策略
- [ ] DNS A/AAAA 记录指向服务器，HTTPS 证书有效
- [ ] 80/443 之外无业务端口公网开放
- [ ] GitHub 生产密钥已配置且部署密钥不能登录 root
- [ ] /api/health 返回 postgresql/connected
- [ ] 演示登录返回 403
- [ ] 邀请码注册、登录、学习和题库导入完成
- [ ] COS 30 天生命周期策略已启用
- [ ] COS 默认服务端加密已启用，备份密钥权限仅限指定前缀
- [ ] 第一次备份恢复演练已通过
```

- [ ] **Step 2: 更新冒烟脚本**

生产冒烟使用单一 `PRODUCTION_ORIGIN`，自动拼接 `/api`。验证：

1. 首页返回 HTML。
2. `/api/health` 为 PostgreSQL。
3. 演示登录关闭。
4. 邀请注册、登录和 onboarding。
5. 管理员题库预览/确认。
6. 登出重登后数据仍在。
7. 所有响应都有请求编号。

任何冒烟账号和邀请码必须从 secrets 读取，不写入仓库。

- [ ] **Step 3: 写备份与恢复演练**

手册包含真实命令：

```bash
sudo -u deploy /opt/kaoyan408/deploy/tencent-cloud/backup-postgres.sh
systemctl status kaoyan408-backup.timer
coscli ls "cos://<bucket>/postgres/"
ALLOW_PRODUCTION_RESTORE=no ./deploy/tencent-cloud/restore-postgres.sh --backup /path/to/drill.dump --confirm kaoyan408_restore_drill
```

恢复演练必须使用隔离数据库 `kaoyan408_restore_drill`；生产恢复命令单独加红色警告，要求两人复核。

- [ ] **Step 4: 配置腾讯云控制台告警（人工检查点）**

在腾讯云控制台建立：

- 网站可用性探测：`https://<domain>/api/health`，每 5 分钟。
- CPU 连续 10 分钟超过 80%。
- 内存连续 10 分钟超过 85%。
- 磁盘超过 75% 预警、超过 90% 严重。
- 月费用达到 80 元预警。
- systemd 备份失败日志告警。

告警发送至管理员邮箱和腾讯云消息中心。此步骤需要用户登录腾讯云并明确授权后执行。

- [ ] **Step 5: 执行非生产完整验证**

Run: `npm test`

Expected: 所有测试 PASS。

Run: `npm run check:release`

Expected: tests、构建和迁移冒烟全部 PASS。

Run: `docker compose -f compose.production.yml --env-file <non-production-env> up -d --build`

Expected: `curl -fsS http://127.0.0.1/api/health` 返回 `status=ok`、`dataSource=postgresql`。

Run: `npm run smoke:staging`

Expected: 单入口注册、学习、导入和持久化检查全部 PASS。

- [ ] **Step 6: 生产上线人工门禁**

在用户确认域名、备案和服务器已准备好之后：

1. 先运行备份。
2. 执行首次发布。
3. 运行生产冒烟。
4. 创建 1 个一次性邀请码。
5. 用全新学生账号在手机和桌面完成关键流程。
6. 验证 COS 备份和隔离恢复。
7. 用户明确批准后才向学生发送域名。

- [ ] **Step 7: 提交**

```bash
git add docs/operations/tencent-cloud-launch.md docs/operations/backup-and-restore.md docs/admin/production-operations.md docs/deployment-checklist.md README.md scripts/staging-smoke.mjs test/staging-smoke.test.js
git commit -m "docs: add Tencent production launch runbook"
```
