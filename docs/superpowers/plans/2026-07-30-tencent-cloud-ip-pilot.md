# 腾讯云公网 IP 体验版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 React、NestJS API 和 PostgreSQL 打包为一套可在腾讯云轻量服务器运行、通过公网 IPv4 地址访问、可备份和可回滚的 Docker Compose 体验环境。

**Architecture:** `gateway` 容器通过 80 端口提供 React 静态资源，并将 `/api/*` 和 `/health` 代理到不暴露公网端口的 `app` 容器；`app` 只通过 Docker 内部网络连接 `postgres`。生产安全校验默认继续强制 HTTPS，只有显式设置 `ALLOW_INSECURE_HTTP_IP=true` 时，才允许公网 IPv4 的 HTTP 来源和同源 `/api`。

**Tech Stack:** Node.js 22、React/Vite、NestJS 10、Prisma 5、PostgreSQL 16、Docker Compose、Nginx Alpine、Node Test Runner、Bash。

## Global Constraints

- 实施任何代码改动前，先按 `AGENTS.md` 搜索 2–4 个开源项目、官方示例或成熟文档，记录可借鉴模式，不直接复制代码。
- 公网只映射宿主机 80 端口；PostgreSQL 5432、NestJS 3000 和 Docker 管理接口不得映射公网。
- `ALLOW_DEMO_AUTH=false`。
- HTTP 例外只允许显式启用的公网 IPv4 地址；普通 HTTP 域名继续被拒绝。
- 真实密码、邀请码、令牌、数据库连接信息和云密钥不得进入 Git。
- PostgreSQL 数据卷不得因应用升级或普通回滚而删除。
- 自动备份保留 14 天；首次邀请真实用户前完成隔离恢复演练。
- 实施期间保留工作区内现有的无关未提交修改，只暂存每个任务明确列出的文件。

---

### Task 1: 公网 IP 临时 HTTP 安全策略

**Files:**
- Create: `apps/api/src/public-environment.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `scripts/validate-environment.mjs`
- Modify: `.env.production.example`
- Test: `test/environment.test.js`

**Interfaces:**
- Produces: `validatePublicEnvironment(values: NodeJS.ProcessEnv): string[]`
- Produces: `isAllowedIpPilotOrigin(value: string, allowInsecureHttpIp: boolean): boolean`
- Consumes: `ALLOW_INSECURE_HTTP_IP`, `WEB_ORIGIN`, `VITE_API_BASE_URL`

- [ ] **Step 1: 记录开源参考检查**

在 `docs/development/reference-notes/2026-07-30-tencent-ip-deployment.md` 记录 Docker Compose 官方生产建议、Nginx 反向代理、Docker 官方 PostgreSQL 镜像及 OWASP 传输安全建议。写明采用的健康检查、内部网络、环境变量和 HTTP 临时例外边界。

- [ ] **Step 2: 写失败的环境校验测试**

在 `test/environment.test.js` 增加：

```js
test('accepts an explicitly enabled HTTP IPv4 pilot with a same-origin API path', () => {
  const errors = validateEnvironment({
    ...production,
    WEB_ORIGIN: 'http://203.0.113.10',
    VITE_API_BASE_URL: '/api',
    ALLOW_INSECURE_HTTP_IP: 'true',
  });
  assert.deepEqual(errors, []);
});

test('does not let the pilot flag weaken ordinary HTTP domains', () => {
  const errors = validateEnvironment({
    ...production,
    WEB_ORIGIN: 'http://study.example.net',
    VITE_API_BASE_URL: '/api',
    ALLOW_INSECURE_HTTP_IP: 'true',
  });
  assert.ok(errors.some((error) => error.includes('WEB_ORIGIN')));
});

test('rejects HTTP IPv4 unless the temporary pilot flag is explicit', () => {
  const errors = validateEnvironment({
    ...production,
    WEB_ORIGIN: 'http://203.0.113.10',
    VITE_API_BASE_URL: '/api',
  });
  assert.ok(errors.some((error) => error.includes('WEB_ORIGIN')));
});
```

- [ ] **Step 3: 运行测试并确认失败**

Run: `node --test test/environment.test.js`

Expected: 新增的显式 IPv4 体验环境测试失败，因为当前校验无条件要求 HTTPS。

- [ ] **Step 4: 实现环境文件校验策略**

在 `scripts/validate-environment.mjs` 增加纯函数：

```js
function isIpv4Hostname(hostname) {
  const parts = hostname.split('.');
  return parts.length === 4
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isAllowedIpPilotOrigin(value, allowInsecureHttpIp) {
  if (!allowInsecureHttpIp) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && isIpv4Hostname(url.hostname)
      && url.pathname === '/'
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}
```

生产环境允许以下两种配置：

- `WEB_ORIGIN` 和绝对 `VITE_API_BASE_URL` 使用 HTTPS。
- `ALLOW_INSECURE_HTTP_IP=true`、`WEB_ORIGIN` 是 HTTP IPv4，且 `VITE_API_BASE_URL=/api`。

其他组合返回明确错误，且 `ALLOW_DEMO_AUTH=false` 规则保持不变。

- [ ] **Step 5: 提取并接入 API 启动校验**

创建 `apps/api/src/public-environment.ts`，把 `main.ts` 中的生产校验提取为可复用函数，并实现与脚本相同的 IPv4 限制。`main.ts` 调用：

```ts
const errors = validatePublicEnvironment(process.env);
```

不得允许 `ALLOW_INSECURE_HTTP_IP=true` 放行 HTTP 域名、路径、查询参数或片段。

- [ ] **Step 6: 更新生产环境示例**

`.env.production.example` 保留 HTTPS 正式配置，并增加注释说明公网 IP 体验版使用：

```dotenv
# Temporary closed pilot only:
# WEB_ORIGIN="http://203.0.113.10"
# VITE_API_BASE_URL="/api"
# ALLOW_INSECURE_HTTP_IP="true"
ALLOW_INSECURE_HTTP_IP="false"
```

- [ ] **Step 7: 验证测试和 API 构建**

Run: `node --test test/environment.test.js`

Expected: PASS。

Run: `npm run build:api`

Expected: NestJS TypeScript 构建成功。

- [ ] **Step 8: 提交**

```bash
git add apps/api/src/public-environment.ts apps/api/src/main.ts scripts/validate-environment.mjs .env.production.example test/environment.test.js docs/development/reference-notes/2026-07-30-tencent-ip-deployment.md
git commit -m "feat: allow explicit HTTP IP pilot configuration"
```

---

### Task 2: 前端生产镜像与统一入口

**Files:**
- Create: `Dockerfile.web`
- Create: `deploy/tencent-ip/nginx.conf`
- Modify: `.dockerignore`
- Modify: `test/deployment-config.test.js`

**Interfaces:**
- Consumes: NestJS 服务名 `app`、内部端口 `3000`
- Produces: Nginx 静态站点、`/api/*` 反向代理、`/health` 健康代理
- Produces: Web 镜像构建参数 `VITE_API_BASE_URL=/api`、`VITE_PUBLIC_BASE_PATH=/`

- [ ] **Step 1: 写失败的部署配置测试**

在 `test/deployment-config.test.js` 读取 `Dockerfile.web` 和 `deploy/tencent-ip/nginx.conf`，并断言：

```js
assert.match(webDockerfile, /^FROM node:22-alpine AS builder$/m);
assert.match(webDockerfile, /ARG VITE_API_BASE_URL=\/api/);
assert.match(webDockerfile, /^FROM nginx:1\.27-alpine$/m);
assert.match(gatewayConfig, /location \/api\//);
assert.match(gatewayConfig, /proxy_pass http:\/\/app:3000\//);
assert.match(gatewayConfig, /location = \/health/);
assert.match(gatewayConfig, /try_files \$uri \$uri\/ \/index\.html/);
assert.match(gatewayConfig, /client_max_body_size 10m/);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/deployment-config.test.js`

Expected: FAIL，因为 Web Dockerfile 和 Nginx 配置尚不存在。

- [ ] **Step 3: 创建多阶段 Web 镜像**

`Dockerfile.web` 构建阶段复制 workspace 清单，运行 `npm ci --ignore-scripts`，再复制 `packages/shared` 与 `apps/web`，使用构建参数：

```dockerfile
ARG VITE_API_BASE_URL=/api
ARG VITE_PUBLIC_BASE_PATH=/
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_PUBLIC_BASE_PATH=$VITE_PUBLIC_BASE_PATH
RUN npm run build:web
```

运行阶段固定使用 `nginx:1.27-alpine`，复制 `apps/web/dist` 到 `/usr/share/nginx/html`，复制 `deploy/tencent-ip/nginx.conf` 到 `/etc/nginx/conf.d/default.conf`。

- [ ] **Step 4: 创建 Nginx 入口配置**

配置包含：

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  client_max_body_size 10m;

  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;

  location /api/ {
    proxy_pass http://app:3000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location = /health {
    proxy_pass http://app:3000/health;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

- [ ] **Step 5: 校验镜像上下文**

更新 `.dockerignore`，排除 `.git`、日志、备份、工作树、测试输出和内容工作区中无需进入生产镜像的大文件，同时保留 workspace 清单、应用源码、Prisma 和部署配置。

- [ ] **Step 6: 运行配置测试与 Web 构建**

Run: `node --test test/deployment-config.test.js`

Expected: PASS。

Run: `docker build -f Dockerfile.web -t kaoyan408-web:test .`

Expected: Web 镜像构建成功。

- [ ] **Step 7: 提交**

```bash
git add Dockerfile.web deploy/tencent-ip/nginx.conf .dockerignore test/deployment-config.test.js
git commit -m "feat: add single-origin web gateway image"
```

---

### Task 3: 生产 Docker Compose 拓扑

**Files:**
- Create: `compose.production.yml`
- Create: `deploy/tencent-ip/.env.production.example`
- Modify: `test/deployment-config.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: Compose 服务 `gateway`, `app`, `postgres`, `backup`
- Produces: 命名卷 `postgres_data`, 宿主机目录 `./backups`
- Consumes: `PUBLIC_IP`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `JWT_SECRET`

- [ ] **Step 1: 写失败的 Compose 静态测试**

增加断言，确保：

```js
assert.match(productionCompose, /gateway:/);
assert.match(productionCompose, /"80:80"/);
assert.match(productionCompose, /app:/);
assert.match(productionCompose, /postgres:/);
assert.doesNotMatch(productionCompose, /"3000:3000"/);
assert.doesNotMatch(productionCompose, /"5432:5432"/);
assert.match(productionCompose, /postgres_data:\/var\/lib\/postgresql\/data/);
assert.match(productionCompose, /restart:\s+unless-stopped/g);
assert.match(productionCompose, /ALLOW_DEMO_AUTH:\s+"false"/);
assert.match(productionCompose, /ALLOW_INSECURE_HTTP_IP:\s+"true"/);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/deployment-config.test.js`

Expected: FAIL，因为 `compose.production.yml` 尚不存在。

- [ ] **Step 3: 创建生产 Compose**

`postgres` 使用 `postgres:16-alpine`、命名卷和 `pg_isready` 健康检查。`app` 从根目录 `Dockerfile` 构建，设置：

```yaml
environment:
  NODE_ENV: production
  DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public
  JWT_SECRET: ${JWT_SECRET}
  WEB_ORIGIN: http://${PUBLIC_IP}
  ALLOW_DEMO_AUTH: "false"
  ALLOW_INSECURE_HTTP_IP: "true"
  AUDIT_LOG_RETENTION_DAYS: "90"
```

`gateway` 从 `Dockerfile.web` 构建，只映射 `"80:80"`，等待 `app` 健康。`app` 和 `postgres` 不写 `ports`。三个常驻服务都配置 `restart: unless-stopped` 和日志轮转：

```yaml
logging:
  driver: json-file
  options:
    max-size: 10m
    max-file: "3"
```

- [ ] **Step 4: 添加部署环境模板**

`deploy/tencent-ip/.env.production.example` 只包含可替换示例：

```dotenv
PUBLIC_IP=203.0.113.10
POSTGRES_USER=kaoyan408
POSTGRES_PASSWORD=generate-a-base64url-password
POSTGRES_DB=kaoyan408
JWT_SECRET=generate-a-random-secret-with-at-least-32-characters
BACKUP_RETENTION_DAYS=14
```

注释要求密码使用只含 URL 安全字符的随机值，避免破坏 `DATABASE_URL`。

- [ ] **Step 5: 增加操作脚本入口**

在 `package.json` 增加：

```json
"prod:config": "docker compose --env-file .env.production -f compose.production.yml config",
"prod:up": "docker compose --env-file .env.production -f compose.production.yml up -d --build --wait",
"prod:status": "docker compose --env-file .env.production -f compose.production.yml ps",
"prod:logs": "docker compose --env-file .env.production -f compose.production.yml logs --tail=200"
```

- [ ] **Step 6: 验证 Compose 展开结果**

从环境模板复制一个未提交的 `.env.production`，使用测试专用随机值运行：

Run: `npm run prod:config`

Expected: 配置成功展开；只有 `gateway` 出现宿主机端口映射。

Run: `node --test test/deployment-config.test.js`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add compose.production.yml deploy/tencent-ip/.env.production.example test/deployment-config.test.js package.json
git commit -m "feat: add production compose topology"
```

---

### Task 4: 自动备份与隔离恢复演练

**Files:**
- Create: `deploy/tencent-ip/backup.sh`
- Create: `deploy/tencent-ip/install-backup-cron.sh`
- Create: `deploy/tencent-ip/verify-restore.sh`
- Modify: `compose.production.yml`
- Modify: `test/deployment-config.test.js`

**Interfaces:**
- Produces: `backup` Compose profile，输出 `backups/kaoyan408-<UTC timestamp>.dump` 和 SHA-256 文件
- Produces: 每天 03:15 执行的 `/etc/cron.d/kaoyan408-backup`
- Consumes: `BACKUP_RETENTION_DAYS`, PostgreSQL 服务凭据

- [ ] **Step 1: 写失败的备份配置测试**

断言 Compose 中的 `backup` 使用 `postgres:16-alpine`、只读脚本挂载、`./backups:/backups`，且备份脚本包含：

```js
assert.match(backupScript, /pg_dump/);
assert.match(backupScript, /sha256sum/);
assert.match(backupScript, /BACKUP_RETENTION_DAYS/);
assert.match(backupScript, /-delete/);
assert.match(restoreScript, /pg_restore/);
assert.match(restoreScript, /trap cleanup EXIT/);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/deployment-config.test.js`

Expected: FAIL，因为备份与恢复脚本尚不存在。

- [ ] **Step 3: 创建备份脚本和工具容器**

`backup.sh` 使用 `set -eu`，生成 custom-format dump，校验文件非空，生成 `.sha256`，再删除早于 `BACKUP_RETENTION_DAYS` 的 `.dump`、`.sha256`。任何一步失败都以非零状态退出。

Compose `backup` 服务：

```yaml
backup:
  image: postgres:16-alpine
  profiles: ["tools"]
  environment:
    PGHOST: postgres
    PGPORT: "5432"
    PGUSER: ${POSTGRES_USER}
    PGPASSWORD: ${POSTGRES_PASSWORD}
    PGDATABASE: ${POSTGRES_DB}
    BACKUP_RETENTION_DAYS: ${BACKUP_RETENTION_DAYS:-14}
  volumes:
    - ./deploy/tencent-ip/backup.sh:/usr/local/bin/backup.sh:ro
    - ./backups:/backups
  entrypoint: ["/bin/sh", "/usr/local/bin/backup.sh"]
```

- [ ] **Step 4: 创建定时任务安装器**

`install-backup-cron.sh` 验证当前目录存在 `compose.production.yml` 和 `.env.production`，将绝对工作目录写入 `/etc/cron.d/kaoyan408-backup`，每天 03:15 执行：

```sh
docker compose --env-file .env.production -f compose.production.yml --profile tools run --rm backup
```

日志追加到 `backups/backup.log`；cron 文件权限设为 `0644`。

- [ ] **Step 5: 创建隔离恢复验证脚本**

`verify-restore.sh <dump-path>` 使用唯一临时容器名启动 `postgres:16-alpine`，等待 `pg_isready`，复制 dump，运行 `pg_restore --exit-on-error`，再查询 Prisma 核心表是否可读。使用：

```sh
trap cleanup EXIT
```

无论成功或失败都删除临时容器，不连接或覆盖生产数据库。

- [ ] **Step 6: 本地验证备份和恢复**

Run: `docker compose --env-file .env.production -f compose.production.yml --profile tools run --rm backup`

Expected: 生成非空 `.dump` 与对应 `.sha256`。

Run: `sh -c 'latest_backup=$(ls -1t backups/*.dump | head -n 1); sh deploy/tencent-ip/verify-restore.sh "$latest_backup"'`

Expected: 临时 PostgreSQL 恢复成功，核心表可查询，临时容器被删除。

- [ ] **Step 7: 提交**

```bash
git add deploy/tencent-ip/backup.sh deploy/tencent-ip/install-backup-cron.sh deploy/tencent-ip/verify-restore.sh compose.production.yml test/deployment-config.test.js
git commit -m "feat: add production backup and restore drill"
```

---

### Task 5: 一键部署、升级和中文操作手册

**Files:**
- Create: `deploy/tencent-ip/deploy.sh`
- Create: `deploy/tencent-ip/rollback.sh`
- Create: `docs/deploy-to-tencent-ip.md`
- Modify: `README.md`
- Test: `test/deployment-config.test.js`

**Interfaces:**
- Produces: `deploy.sh` 预检、备份、构建、启动和健康检查流程
- Produces: `rollback.sh <git-commit>` 应用版本回滚流程，不回滚数据库迁移
- Consumes: `.env.production`, `compose.production.yml`, `/health`

- [ ] **Step 1: 写失败的运维脚本测试**

断言：

```js
assert.match(deployScript, /docker compose .* config/);
assert.match(deployScript, /--profile tools run --rm backup/);
assert.match(deployScript, /up -d --build --wait/);
assert.match(deployScript, /curl .*\/health/);
assert.doesNotMatch(deployScript, /down -v/);
assert.doesNotMatch(rollbackScript, /down -v/);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/deployment-config.test.js`

Expected: FAIL，因为部署和回滚脚本尚不存在。

- [ ] **Step 3: 创建部署脚本**

`deploy.sh` 使用 `set -eu`，依次执行：

1. 检查 Docker、Compose、`.env.production`。
2. 从 `.env.production` 加载 `PUBLIC_IP`，拒绝空值或非 IPv4。
3. 执行 Compose `config`。
4. 已存在健康数据库时先执行备份；首次部署跳过并明确输出。
5. `up -d --build --wait`。
6. 最多等待 60 秒访问 `http://127.0.0.1/health`。
7. 输出公网入口 `http://$PUBLIC_IP` 和 `docker compose ps`。

脚本不得执行 `down -v`、删除备份或打印密钥。

- [ ] **Step 4: 创建安全回滚脚本**

`rollback.sh <git-commit>` 要求工作区干净，先备份数据库，记录当前 commit，切换到指定已存在 commit，重新构建并健康检查。失败时恢复原 commit 和应用镜像。脚本明确提示：“数据库迁移不会自动回滚。”

- [ ] **Step 5: 编写中文部署手册**

`docs/deploy-to-tencent-ip.md` 包含：

- 腾讯云轻量服务器购买规格：Ubuntu LTS、2 核 2GB、40GB。
- 防火墙只开放 80；22 优先限制管理员 IP。
- 安装 Docker 的官方文档入口。
- 上传代码、复制环境模板、生成随机密码和 JWT 密钥。
- 执行 `deploy.sh`。
- 创建首个管理员账号。
- 生成邀请码并完成学生验收。
- 安装定时备份、手动备份和隔离恢复。
- 查看状态、日志、升级、回滚、服务器重启验证。
- HTTP 阶段不复用密码、仅限 10–20 人封闭测试的提醒。
- 未来域名备案、HTTPS 和关闭 `ALLOW_INSECURE_HTTP_IP` 的切换步骤。

README 的部署段落增加该手册入口，并明确它是当前推荐的小规模体验路径。

- [ ] **Step 6: 验证脚本和文档**

Run: `sh -n deploy/tencent-ip/deploy.sh deploy/tencent-ip/rollback.sh deploy/tencent-ip/backup.sh deploy/tencent-ip/install-backup-cron.sh deploy/tencent-ip/verify-restore.sh`

Expected: 所有 Bash 脚本语法通过。

Run: `node --test test/deployment-config.test.js`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add deploy/tencent-ip/deploy.sh deploy/tencent-ip/rollback.sh docs/deploy-to-tencent-ip.md README.md test/deployment-config.test.js
git commit -m "docs: add Tencent IP deployment workflow"
```

---

### Task 6: 生产栈端到端验收

**Files:**
- Create: `scripts/smoke-production-compose.mjs`
- Create: `docs/tencent-ip-acceptance-checklist.md`
- Modify: `package.json`
- Test: `test/deployment-config.test.js`

**Interfaces:**
- Produces: `npm run smoke:production-compose`
- Consumes: 生产 Compose、临时测试环境文件、HTTP 入口、邀请注册 API
- Reuses: `scripts/staging-smoke.mjs` 的无敏感信息结果摘要模式

- [ ] **Step 1: 写失败的冒烟入口测试**

在 `test/deployment-config.test.js` 断言 `package.json` 含：

```json
"smoke:production-compose": "node scripts/smoke-production-compose.mjs"
```

并断言脚本不会输出密码、完整邀请码、访问令牌或数据库 URL。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/deployment-config.test.js`

Expected: FAIL，因为冒烟脚本入口尚不存在。

- [ ] **Step 3: 创建生产 Compose 冒烟脚本**

脚本使用独立 Compose project 名称和测试专用随机凭据，执行：

1. `docker compose config`。
2. 构建并启动生产栈。
3. 等待 `http://127.0.0.1/health`。
4. 确认首页返回 200。
5. 确认无邀请码注册被拒绝。
6. 通过管理员流程创建单次邀请码。
7. 用全新学生账号注册、刷新会话、退出并重新登录。
8. 重启 Compose 服务并确认健康和账号数据仍存在。
9. 执行备份并隔离恢复。
10. 输出只含 PASS/FAIL、耗时和请求编号的摘要。

脚本在 `finally` 中只清理自己的测试 project 和测试卷，不触碰默认生产 project。

- [ ] **Step 4: 编写人工验收清单**

`docs/tencent-ip-acceptance-checklist.md` 使用复选框覆盖：

- 手机和桌面公网访问。
- 邀请码注册、自动登录、再次登录。
- 学习数据刷新后保留。
- 管理员停用/恢复账号。
- 容器与服务器重启恢复。
- 备份与隔离恢复。
- 防火墙端口复核。
- HTTP 风险告知。

- [ ] **Step 5: 运行全套验证**

Run: `npm test`

Expected: 全部 Node 测试通过。

Run: `npm run build:api`

Expected: PASS。

Run: `npm run build:web`

Expected: PASS。

Run: `npm run smoke:production-compose`

Expected: 所有生产栈检查项 PASS，结束后不残留测试容器或测试卷。

Run: `git diff --check`

Expected: 无空白错误。

- [ ] **Step 6: 提交**

```bash
git add scripts/smoke-production-compose.mjs docs/tencent-ip-acceptance-checklist.md package.json test/deployment-config.test.js
git commit -m "test: verify production compose deployment"
```

---

## Plan Self-Review

- 设计中的单一公网入口、内部数据库网络、重启恢复、HTTP IPv4 临时例外、14 天备份、隔离恢复和未来 HTTPS 切换均有对应任务。
- 题库网页导入保持为后续独立实施计划，不进入本部署计划。
- 每个任务都有先失败测试、最小实现、验证和独立提交。
- 所有生产数据操作都保留命名卷；部署与回滚脚本禁止 `down -v`。
- 类型和配置名统一使用 `ALLOW_INSECURE_HTTP_IP`、`PUBLIC_IP`、`VITE_API_BASE_URL=/api`。
