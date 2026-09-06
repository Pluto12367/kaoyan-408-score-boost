# V5.3 Deployment Audit

> 日期：2026-09-06。审计范围：Frontend / Backend / PostgreSQL / Redis / AI provider / Embedding provider。

## 1. 基础设施现状

| 组件 | 配置位置 | 状态 |
|---|---|---|
| Frontend | `Dockerfile.web` + `gateway` service (nginx :80) | ✅ 就绪 |
| Backend | `Dockerfile` + `app` service (:3000) | ✅ 就绪（nest build + dist 产物） |
| PostgreSQL | `postgres:16-alpine` + healthcheck + volume | ✅ 就绪 |
| Backup | `deploy/tencent-ip/backup.sh` + `backups/` volume | ✅ 就绪（pg_dump + retention） |
| Redis | **未配置**（compose 中无 redis service） | ⚠️ 当前架构无 Redis 依赖（ThrottlerGuard 内存限流 + 内存 metrics），不阻塞 |
| AI provider | `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` 已进 compose env | ⚠️ **BLOCKED BY BILLING**（402 实证） |
| Embedding provider | compose env 未配置 `EMBEDDING_API_KEY`/`EMBEDDING_BASE_URL` | ⚠️ **BLOCKED BY CREDENTIALS/PROVIDER** |

## 2. 环境配置

| 环境 | 配置文件 | 秘钥管理 |
|---|---|---|
| development | `.env.development`（本地，gitignored） | 本地持有 |
| staging | `.env.staging.example` + Railway（`staging-smoke.yml` workflow_dispatch） | Railway secrets |
| production | `.env.production`（gitignored） + `compose.production.yml` env 注入 | Docker secrets / 服务器环境变量 |
| CI | GitHub Actions secrets | deploy-pages.yml（test→build→deploy） |

## 3. Health Check

- `/health`：DB 连接 + startup 配置 + operational（aiProvider/embeddingProvider DEGRADED/BLOCKED 如实报告）——V5.3 扩展后。
- Compose healthcheck：app 每 10s 探测 `/health`，5 次失败标记 unhealthy。
- **不伪造**：AI/embedding 未配置时 `operational.aiProvider=degraded` / `embeddingProvider=degraded`，不冒充 HEALTHY。

## 4. AI Fallback（已验证）

| 场景 | 行为 |
|---|---|
| AI_API_KEY 缺失 | Coach → template（source 标识）；Agent → deterministic workflow；RAG → 本地确定性嵌入 |
| LLM timeout/429/5xx | ChatCompletionError 分类 → workflow 降级 → fallbackReason 显式 |
| LLM billing 402 | 同上——不 crash，不伪造 |
| Embedding 缺失 | 本地确定性嵌入（local-deterministic-v1） |

## 5. Rate Limit

- 全局 ThrottlerGuard 60 req/min（既有）。
- Agent 步数闸（6 步）+ 输入界（2000 字符）+ tool 结果截断（4000 字符）。
- generateDailyPlanFromState generationKey 幂等。

## 6. Observability

- 结构化日志：study_agent.completed / knowledge_search.completed / exam_analyzed / supervisor.routed / tutor_session.started。
- `GET /ai/metrics`（admin）：agent/rag/coach/risk/adaptive/plan/review/outcome 全维度。
- OperationLog 中间件记录请求。
- 日志无密钥（V5.3-ops 测试审计）。

## 7. Backup / Recovery

- `backup.sh`：pg_dump → `backups/` + retention（默认 14 天）。
- 恢复程序：`pg_restore` → 验证 → 重启 app。
- Schema 变更：Prisma migrations（精确 SQL，向前兼容）。

## 8. Rollback

- 版本化部署：Docker image tag per commit。
- 回滚程序：`docker compose pull` 旧 tag → `docker compose up -d` → health check 确认。
- DB 回滚策略：Prisma migration 向前兼容（新增列/表），回滚应用版本不要求 DB 回滚。

## 9. CI/CD

| 流程 | 触发 | 步骤 |
|---|---|---|
| deploy-pages.yml | push codex/deployment-ready | test（PG service）→ build → deploy pages |
| staging-smoke.yml | workflow_dispatch | Railway API authenticated smoke |
| 建议补充 | PR | test → build（不 deploy） |

## 10. Deployment Gap（如实标注）

- Redis：当前架构不依赖，暂不需要。
- Staging 实际部署：Railway 配置已存在，实际部署需所有者操作。
- 生产部署实际执行：需所有者在目标服务器操作（compose 文件已就绪）。
