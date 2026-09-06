# V7 Production Status

> 最后更新：2026-09-06。Certification commit：`1087a26`。

## Status

**PRODUCTION CERTIFIED**（2026-09-06，Owner Operations Gate 5/5 PASS）

> 认证范围：应用层认证（V7 Application Certified）+ 基础设施运维演练（备份/恢复/重启/回滚/资源）。

## Certified

| 维度 | 等级 |
|---|---|
| API (17 端点) | Integration PASS |
| Browser UI (6 页面) | Integration PASS |
| E2E User Journey | Integration PASS |
| Data Consistency | Integration PASS |
| Idempotency | Integration PASS |
| AI / RAG / Agent | Integration PASS |
| Real LLM Provider | **Real Provider PASS** (DeepSeek) |
| Real Embedding Provider | **Real Provider PASS** (Jina AI) |
| Security | Integration PASS |
| Failure Handling | Integration PASS |
| Application Performance | Integration PASS |
| Observability | Contract PASS |
| Evaluation | Contract PASS |

## Owner Operations Gate (VERIFIED 2026-09-06, Tencent Cloud 2C2G)

| 演练 | 结果 | 证据摘要 |
|---|---|---|
| B-1 Backup (pg_dump) | PASS | 备份文件生成成功 |
| B-2 Restore (pg_restore) | PASS | 恢复到验证库成功 |
| B-3 Restart Recovery | PASS | `docker compose restart` 后三容器健康，`/health` overall ok |
| B-4 Rollback Drill | PASS | `git checkout f2786df`（V5.5 认证版）重建 48.3s → 三容器健康 → `/health` ok；切回 `feature/v3-product-refactor` 重建 2.8s → 三容器健康 → `/health` ok |
| B-5 Resource Inspection | PASS | 内存 available 1.1Gi、swap 278Mi；容器占用 app 73MB/640MB、PG 26MB/320MB、gateway 3MB/32MB。`docker builder prune -f` 回收 17.21GB 构建缓存，`df -h /` 确认 40GB 盘使用率 31%（12G used / 27G avail） |

B-4 备注：旧版本（f2786df）health 显示 `embeddingProvider: "degraded"`，当前版本为 `"configured"`——`.env.production` 的 Jina 凭据是后续加入的，回滚需配套旧环境假设，已留痕。服务器尚未 fetch tags，回滚用 commit hash 定位；建议本地 `git push origin --tags` 后服务器即可用 tag 名回滚。

## Certification Commit

`1087a26`

## Final Production Certification

Owner SSH verification complete: B-1 至 B-5 全部 PASS，无遗留项。状态升级为 **PRODUCTION CERTIFIED**。创建 tag `v7.0.0-production-certified` 并 `git push origin feature/v3-product-refactor --tags` 后，服务器即可用 tag 名回滚。

## Owner SSH Checklist

Run `docs/v7-deployment-runbook.md` Step 9-10 to verify:

- [x] Backup (pg_dump)
- [x] Restore (pg_restore)
- [x] Restart (docker compose restart)
- [x] Rollback (git checkout previous tag + rebuild)
- [x] Resource inspection (docker stats / free -h / df -h) — 内存与容器占用 PASS；构建缓存 17.21GB 已清理，磁盘使用率 31%
