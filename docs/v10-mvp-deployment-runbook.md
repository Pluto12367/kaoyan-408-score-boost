# V10 MVP 生产部署手册（AI Learning Sprite）

> 适用：将 V10 MVP（V10-1 Sprite Core + V10-2 Sprite UI + V10-3 Companion Loop）部署到腾讯云生产服务器。
> 流程对齐 V9 部署实证路径（备份 → 显式 refspec 更新 → 重建 → 冒烟）与 `deploy/tencent-ip/deploy.sh` 门禁。
> 本侧已完成：提交与推送（见 §1 提交清单）；服务器侧由所有者人工执行（§2-§4）。

---

## 1. 本侧已完成（Agent 执行）

- 全量验证：`npm test` 1956/1954/0、`build:api`/`build:web` PASS（V10-3 final report §3）。
- 提交（精确 `git add`，不含 `.zcode/` 与任何受保护在途文件）：
  - `feat(sprite): V10 MVP AI Learning Sprite (core + UI + companion loop)` — 后端 5 文件、前端 5 文件、测试 2 文件、DESIGN.md
  - `docs(v10): sprite constitution, designs, final reports + sprint ledger` — 宪法/设计/报告 8 份 + 账本 + 本手册
- 已推送 `origin/feature/v3-product-refactor`。

## 2. 服务器侧：更新代码（人工 SSH）

```bash
ssh root@43.128.30.191        # 或所有者惯用入口
cd <生产检出目录>              # 现有 kaoyan408 checkout

# ⚠️ V6.3 教训：不要用 git pull（代理陈旧 ref），必须显式 refspec
git fetch origin feature/v3-product-refactor
git reset --hard FETCH_HEAD
git log --oneline -3           # 应看到上面两笔 V10 提交
```

## 3. 服务器侧：部署（deploy.sh 自带备份门禁）

```bash
sh deploy/tencent-ip/deploy.sh
```

脚本自动执行：PostgreSQL 健康检查 → **部署前数据库备份**（profile tools）→ `up -d --build --wait` → 网关健康门禁（60s）→ 幂等 seed（408 证据数据 + 知识点桥）→ app 重启使目录命名生效。任一门禁失败脚本即退出（不半部署）。

零迁移声明：V10 全线零 Schema 变更，`prisma migrate deploy` 无新迁移可执行（app 容器启动流程自含，无需手动跑）。

## 4. 冒烟清单（V10 增量 + 既有回归）

```bash
# 1) 网关健康（nginx）
curl -s http://localhost/health
# 预期 overall:"ok"

# 2) 精灵路由已注册（未认证应 401/403，绝不能 404）
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/sprite/state

# 3) 应用级冒烟（真实学生账号，经 nginx /api）
TOKEN=$(curl -s -X POST http://localhost/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<真实学生账号>","password":"<密码>"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
curl -s http://localhost/api/sprite/state -H "Authorization: Bearer $TOKEN"
# 预期：version "sprite-state-v1"，mood 与该账号真实事实一致，
#       每条 lines[].evidenceRefs 非空，source === "derived"

# 4) 遥测 allowlist（sprite.interact 已放行）
curl -s -X POST http://localhost/api/events -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"sprite.interact","payload":{"action":"panel_open"}}'
# 预期 2xx；再发一个未知类型应被拒（allowlist 仍封闭）

# 5) V9 既有端点回归（不回归才算过）
curl -s http://localhost/api/coach/daily-brief -H "Authorization: Bearer $TOKEN" -o /dev/null -w "%{http_code}\n"
curl -s http://localhost/api/coach/proactive  -H "Authorization: Bearer $TOKEN" -o /dev/null -w "%{http_code}\n"
```

前端验证（浏览器）：学生账号登录 → 首页右下出现精灵悬浮球 → 打开面板看台词与"依据"→ 移动端宽度检查 orb 不压底部导航。

## 5. 回滚

```bash
git log --oneline -5                     # 找 V10 前的上一提交
git reset --hard <previous_commit>
sh deploy/tencent-ip/deploy.sh
curl -s http://localhost/health
```

V10 为纯只读派生层 + 一行 telemetry allowlist 增量：回滚无数据迁移负担，任何时刻可安全回退。
