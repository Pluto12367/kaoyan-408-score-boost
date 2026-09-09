# V11 Final Production Release — 服务器执行手册（Step 1）

> 目标：把生产从当前版本升级到 **origin HEAD `34c4c86`**（tag `v11.0.0`），携带 V11 全部四件：
> M1 数据质量观测 / M2 学习证据投影 / M3 推荐候选诚实化 / M4 影响度量层（校准+效果+FSRS）。
> 所有 9 个提交已推送 origin；V11 增量**零数据库迁移**（deploy.sh 内 prisma migrate deploy 幂等，无风险）。

---

## Step 1 — 部署前记录（粘贴到服务器执行，输出留档）

```bash
cd ~/kaoyan-408-score-boost
git rev-parse HEAD                          # 当前生产 commit = 回滚点
git status --porcelain | head -5            # 应为空或仅本地噪声
docker ps --format "{{.Names}} {{.Status}}" # 三容器状态
docker exec kaoyan-408-score-boost-postgres-1 pg_dump -U <POSTGRES_USER> -d <POSTGRES_DB> -f /tmp/pre-v11.sql && echo backup-ok
```

## Step 2 — 拉取并部署

```bash
git fetch origin feature/v3-product-refactor
git reset --hard origin/feature/v3-product-refactor
git log --oneline -2        # 应见 34c4c86 / ac00e0a 或其后的 docs 提交
sh deploy/tencent-ip/deploy.sh
```

deploy.sh 自动执行：健康门禁 → 幂等 seed → app 重启（V11 增量**零迁移**，migrate deploy 幂等无风险）。

## Step 3 — 部署后冒烟（粘贴即用）

```bash
curl -s http://localhost/health | head -c 120; echo
for p in /api/coach/task-evidence /api/coach/mastery-calibration /api/coach/outcome-tracking /api/admin/data-quality /api/exam/diagnosis/sess-probe /api/coach/review-shadow; do
  printf "%s → %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000$p)"
done
```

**预期**：全部 **401**（未认证守卫生效 = 路由已上线；出现 404 = 部署不完整）。

## Step 4 — 应用级闭环冒烟（可选，需要测试账号）

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/auth/demo-login -H 'Content-Type: application/json' -d '{"role":"student"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
curl -s http://127.0.0.1:3000/coach/task-evidence -H "Authorization: Bearer $TOKEN" | head -c 200; echo
curl -s http://127.0.0.1:3000/coach/mastery-calibration -H "Authorization: Bearer $TOKEN" | head -c 200; echo
curl -s http://127.0.0.1:3000/coach/outcome-tracking -H "Authorization: Bearer $TOKEN" | head -c 200; echo
```

**预期**：三个端点均返回 `"source":"derived"` 的诚实数据（测试账号无真实练习时，entries/interventions 为空数组 = 诚实缺席，不是故障）。

## Rollback（如需）

```bash
git reset --hard <回滚点commit>   # 部署前记录的 HEAD
sh deploy/tencent-ip/deploy.sh
```

V11 增量零迁移，回滚无数据库负担。
