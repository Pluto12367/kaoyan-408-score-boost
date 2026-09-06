# V7 Tencent Cloud 2C2G Deployment Runbook

> 前提：腾讯云 CVM 已创建（2 核 / 2GB / 40GB SSD），安全组已开放 22/80/443。

## Step 1 — SSH 连接并初始化服务器

```bash
ssh root@<公网IP>

# 系统更新
apt update && apt upgrade -y

# 安装 Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# 安装 Docker Compose（v2 plugin 已内置在 get.docker.com 中）
docker compose version

# 创建 1GB swap（OOM 安全网）
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## Step 2 — 克隆项目

```bash
cd /opt
git clone https://github.com/<owner>/<repo>.git kaoyan408
cd kaoyan408
git checkout v5.5.0-production-certified  # 生产基线 tag
```

## Step 3 — 创建环境配置

```bash
cp .env.production.example .env.production
vim .env.production
```

必须填写的变量（**不要提交到 git**）：

| 变量 | 说明 |
|---|---|
| POSTGRES_USER | 数据库用户 |
| POSTGRES_PASSWORD | 数据库密码（强密码） |
| POSTGRES_DB | 数据库名 |
| JWT_SECRET | JWT 签名密钥（≥32 字符随机字符串） |
| AI_API_KEY | DeepSeek API key |
| EMBEDDING_API_KEY | Jina AI API key |
| EMBEDDING_BASE_URL | https://api.jina.ai/v1 |
| EMBEDDING_MODEL | jina-embeddings-v3 |
| PUBLIC_IP | 服务器公网 IP |

## Step 4 — 构建并启动

```bash
docker compose -f compose.production.yml --env-file .env.production up -d --build
```

## Step 5 — 运行 Database Migration

```bash
docker compose -f compose.production.yml exec app \
  npx prisma migrate deploy --schema ../../prisma/schema.prisma
```

## Step 6 — Health Check

```bash
# 内部检查
curl -s http://localhost:3000/health | head -5

# 通过 nginx
curl -s http://localhost/health | head -5
```

预期返回：`{"status":"ok","operational":{"database":"connected","aiProvider":"configured","embeddingProvider":"configured","overall":"ok"},...}`

## Step 7 — 运行 Seed（如果需要 408 知识库）

```bash
docker compose -f compose.production.yml exec app \
  node -e "
    const { seed } = require('./dist/scripts/seed-408-v2');
    seed();
  "
```

或从宿主机：
```bash
DATABASE_URL="postgresql://<user>:<pass>@localhost:5432/<db>?schema=public" \
  node scripts/seed-408-v2.mjs
```

## Step 8 — Smoke Test

```bash
# 注册
curl -X POST http://localhost/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@test.com","password":"Test123456!","invitationCode":"..."}'

# 登录
curl -X POST http://localhost/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@test.com","password":"Test123456!"}'

# Health
curl http://localhost/health
```

## Step 9 — Backup 验证

```bash
# 手动触发备份
docker compose -f compose.production.yml --profile tools run backup

# 检查备份文件
ls -la ./backups/

# 恢复验证（在测试数据库上）
docker compose -f compose.production.yml exec postgres \
  pg_restore -U <user> -d <test_db> /backups/<backup_file>
```

## Step 10 — 资源监控

```bash
# 内存使用
docker stats --no-stream

# 磁盘使用
df -h

# PostgreSQL 连接数
docker compose -f compose.production.yml exec postgres \
  psql -U <user> -d <db> -c "SELECT count(*) FROM pg_stat_activity;"
```

## Rollback

```bash
# 查看可用 image
docker images | grep kaoyan

# 回滚到上一个版本
docker compose -f compose.production.yml down
git checkout <previous_tag_or_commit>
docker compose -f compose.production.yml --env-file .env.production up -d --build

# 验证 health
curl http://localhost:3000/health
```

## 内存预算（2GB 总量）

| 组件 | 限制 | 预估 |
|---|---|---|
| OS + 内核 | — | ~200MB |
| PostgreSQL | 320M (compose limit) | ~256MB |
| Node.js API | 640M (compose limit) | ~512MB |
| Nginx | 32M (compose limit) | ~16MB |
| Swap | 1GB | OOM 安全网 |
| **合计** | **~1GB** | 余量 ~1GB |
