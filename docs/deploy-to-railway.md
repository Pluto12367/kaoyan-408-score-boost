# Railway 可靠内测部署指南

## 部署结构

```text
学生浏览器
├── GitHub Pages 或 Vercel：React 前端
└── Railway：NestJS API
    └── Railway PostgreSQL：学习数据
```

GitHub Pages 未配置公网 API 时只运行带有明确标识的静态演示模式，不能用于可靠内测。

## 1. 创建 Railway 服务

1. 使用 GitHub 登录 [Railway](https://railway.app)。
2. 选择 `New Project` → `Deploy from GitHub repo`。
3. 选择 `Pluto12367/kaoyan-408-score-boost`。
4. 为项目添加 PostgreSQL 服务，并确认应用服务获得 `DATABASE_URL`。
5. 为 API 服务生成公网 HTTPS 域名。

仓库中的 Dockerfile 会构建 API，并在启动时执行 `prisma migrate deploy`。

## 2. 配置生产变量

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<至少 32 字符的随机密钥>
WEB_ORIGIN=https://pluto12367.github.io
ALLOW_DEMO_AUTH=false
AUDIT_LOG_RETENTION_DAYS=90
```

生产和预发布环境必须保持 `ALLOW_DEMO_AUTH=false`。可用下面的命令生成密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

部署前用 `.env.production.example` 创建本地未提交的环境文件，并运行：

```bash
npm run validate:env -- --file .env.production
```

## 3. 连接前端

在 GitHub 仓库的 `Settings` → `Secrets and variables` → `Actions` → `Variables` 中添加：

```text
VITE_API_BASE_URL=https://<你的-api-域名>.up.railway.app
```

重新运行 `Deploy GitHub Pages` 工作流。Railway 的 `WEB_ORIGIN` 必须与真实前端来源完全一致，不使用 `*`。

## 4. 验证部署

1. 访问 `https://<你的-api-域名>.up.railway.app/health`。
2. 确认返回 `status: ok` 和 `dataSource: postgresql`。
3. 用新学生账号走通“注册 → 诊断 → 今日任务 → 做题 → 错题 → 退出 → 重登 → 恢复”。
4. 在管理端确认核心内测指标有真实样本量，而不是演示数值。
5. 确认响应头带有 `x-request-id`，错误排查时保存该编号。

## 5. 备份与恢复演练

平台自动备份之外，邀请学生前至少生成一次可校验备份：

```bash
npm run db:backup -- --output backups/pre-beta.dump
npm run db:backup:verify -- --backup backups/pre-beta.dump
```

恢复演练只能对临时演练数据库执行。先把 `DATABASE_URL` 指向演练库，再显式确认库名：

```bash
CONFIRM_DATABASE_RESTORE=kaoyan408_restore_test npm run db:restore -- --backup backups/pre-beta.dump
```

恢复后启动 API，检查 `/health`，并使用测试账号核对学习记录、错题、任务和考试报告。备份文件与清单不得提交到 Git。

## 6. 上线监控

- 每 5 分钟监控一次 API `/health` 和前端首页。
- 告警时记录时间、HTTP 状态、部署版本和 `x-request-id`。
- 管理端每天查看接口失败率和会话恢复成功率。
- 首批只邀请 10–20 名学生，不开放大规模注册。
