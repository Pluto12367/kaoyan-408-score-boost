# V7 Server Audit — Tencent Cloud CVM 2C2G

> 日期：2026-09-06。服务器：2 核 CPU / 2GB RAM / 40GB SSD。

## 1. 资源预算（2GB RAM 分配方案）

| 组件 | 内存预算 | 说明 |
|---|---|---|
| OS + 内核 | ~200MB | 不可压缩 |
| PostgreSQL 16 | ~256MB | shared_buffers=64MB, effective_cache_size=128MB, max_connections=20 |
| Node.js API | **512MB** | max-old-space-size=512（**从 1536 降到 512**） |
| Nginx (gateway) | ~16MB | 静态文件 + 反向代理 |
| 可用余量（page cache / spike） | ~1000MB | |

**关键变更**：`--max-old-space-size` 从 1536 降到 **512**。1536 在 2GB 机器上必然 OOM。

## 2. 磁盘预算（40GB）

| 用途 | 预估 |
|---|---|
| OS + Docker | ~8GB |
| Docker images (app + web + postgres + nginx) | ~2GB |
| PostgreSQL data | ~1GB（初始） |
| Node modules (builder 缓存) | ~1GB |
| Backups (14 days) | ~1GB |
| 日志 | ~1GB |
| 可用余量 | ~26GB |

## 3. 发现的问题

| 问题 | 严重度 | 修复 |
|---|---|---|
| Node 内存 1536MB 在 2GB 机器上必 OOM | **CRITICAL** | 降到 512MB |
| 无 memory limit / memswap_limit | HIGH | 添加 deploy.resources.limits |
| PostgreSQL 未调优（默认配置面向 ≥4GB） | MEDIUM | 添加 postgresql.conf 调优参数 |
| 无 swap 配置 | MEDIUM | 添加 1GB swap 作为 OOM 安全网 |
| 日志无大小限制（可能导致磁盘满） | LOW | 已有 max-size=10m max-file=3 |

## 4. 服务清单

| 服务 | 必要性 | 说明 |
|---|---|---|
| postgres | ✅ 必须 | 唯一持久化数据 |
| app (API) | ✅ 必须 | NestJS 后端 |
| gateway (nginx) | ✅ 必须 | 静态文件 + 反向代理 |
| backup | 可选 | pg_dump 定时备份 |
| ~~Redis~~ | ❌ 不需要 | 当前架构无 Redis 依赖（限流/指标均在内存） |

## 5. 网络安全

| 端口 | 暴露 | 说明 |
|---|---|---|
| 22 | ✅ 公网（SSH） | 限制 source IP |
| 80 | ✅ 公网（HTTP → HTTPS redirect） | nginx |
| 443 | ✅ 公网（HTTPS） | nginx + TLS |
| 3000 | ❌ 仅内部 | app 直连，通过 nginx 反代 |
| 5432 | ❌ 仅内部 | PostgreSQL |
| ~~6379~~ | ❌ 不存在 | 无 Redis |
