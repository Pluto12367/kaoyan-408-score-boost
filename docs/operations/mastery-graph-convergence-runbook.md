# 掌握度图谱统一闭环上线运行手册（阶段 0→5）

> 适用：`codex/deployment-ready` 分支（阶段 0-5 全部落地后）。目标是把“题库 → 节点归因 → 掌握度 → 图谱/报告/推荐”收敛为以 `UserKnowledgeMastery` 为唯一掌握度口径的闭环。

## 1. 前置确认

- 服务器仓库已 `git pull --ff-only origin codex/deployment-ready`。
- 服务器 `.env.production` 存在（`DATABASE_URL`、`JWT_SECRET`、`AI_API_KEY` 可选）。
- 容器健康：`docker compose --env-file .env.production -f compose.production.yml ps`。

## 2. 部署（含新迁移）

```sh
./deploy/tencent-ip/deploy.sh
```

`deploy.sh` 会自动：备份数据库 → 构建 app/gateway → 启动容器（app 容器 CMD 内 `prisma migrate deploy` 应用迁移）→ 幂等 seed 408 目录/映射 → 健康检查。阶段 4 新增迁移 `20260814120000_user_mastery_snapshot` 随容器启动自动应用（additive，可回滚=在 `prisma/migrations` 移除后重新部署）。

## 3. 数据脚本（按顺序、幂等、可重跑）

```sh
app=$(docker compose --env-file .env.production -f compose.production.yml ps -q app)

# 0a 题库清重（先 dry-run 看重复行，再 apply；归档 isCurrent=false，可回滚）
docker cp scripts/question-bank-dedupe.mjs "$app":/app/scripts/question-bank-dedupe.mjs
docker compose --env-file .env.production -f compose.production.yml exec -T app node scripts/question-bank-dedupe.mjs --dry-run
docker compose --env-file .env.production -f compose.production.yml exec -T app node scripts/question-bank-dedupe.mjs

# 0b 掌握度回填（全量用户；重建 UserKnowledgeMastery + UserMasterySnapshot 历史快照）
docker cp scripts/backfill-user-mastery.mjs "$app":/app/scripts/backfill-user-mastery.mjs
docker compose --env-file .env.production -f compose.production.yml exec -T app node scripts/backfill-user-mastery.mjs --dry-run
docker compose --env-file .env.production -f compose.production.yml exec -T app node scripts/backfill-user-mastery.mjs

# 3 题库图谱化（物化题目级节点标签；覆盖率 <70% 会阻断写入）
docker cp scripts/link-question-bank-to-nodes.mjs "$app":/app/scripts/link-question-bank-to-nodes.mjs
docker compose --env-file .env.production -f compose.production.yml exec -T app node scripts/link-question-bank-to-nodes.mjs --dry-run
docker compose --env-file .env.production -f compose.production.yml exec -T app node scripts/link-question-bank-to-nodes.mjs
```

说明：镜像重建后脚本已内置（`Dockerfile` 复制 `scripts/*.mjs` 与 `data/408`），首次部署若镜像未含新脚本可用 `docker cp` 兜底；`backfill`/`linker` 都幂等，可重复执行。

## 4. 开启灰度（方案 C 只读切换）

在 `.env.production` 增加：

```dotenv
USE_KNODE_MASTERY=true
```

重启 app 使开关生效：

```sh
docker compose --env-file .env.production -f compose.production.yml up -d --no-deps app
```

开启后：

- 掌握度地图、薄弱报告（weakPoints）、推荐题组改由 `UserKnowledgeMastery` 节点掌握度驱动；
- 启动日志出现 `legacy mastery read path frozen`（旧内存口径冻结）；
- 节点掌握度缓存 60 秒 TTL 自动刷新（多实例最终一致；单实例写后即时刷新）；
- 回滚 = 删除该变量并重启，读路径即时回到旧口径。

## 5. 验收

- `curl -fsS http://127.0.0.1/health`
- 登录学生账号（邀请码注册后）：首页/图谱/报告/题库训练/错题本正常；
- 知识图谱：节点按掌握度着色，详情抽屉有“我的掌握度 / 考点题库 / 真题命中 / 去练习 / 练习本题”；
- 报告“四科掌握度”：出现“掌握度趋势”面板（有快照后逐步累积曲线）；
- `GET /api/mastery-map`、`/api/mastery-trend` 返回 200 且含练习节点；
- 推荐题组按节点归因返回题目。

## 6. 已知边界（Phase 2b 与后续项）

- Onboarding 七天计划与 `StudyTask` 仍以粗粒度 `knowledgePointId` 语义运行（Phase 2b 单独评审，不随本路线自动切换）。
- 真题为版权受限的摘要/题号/分值/来源（无完整题干），“真题接入”= 证据可视化 + 来源链接，不提供真题直接作答。
- HTTPS 需正式域名：见 `docs/deploy-to-tencent-ip.md` 第 9 节与 `deploy/tencent-ip/nginx-https.conf.example`。
