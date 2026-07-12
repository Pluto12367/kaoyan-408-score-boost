# 部署指南：让链接可体验

## 架构

```
用户浏览器
    │
    ├─→ GitHub Pages (前端静态页面)
    │     https://pluto12367.github.io/kaoyan-408-score-boost/
    │
    └─→ Railway (后端 API + 数据库)
          https://your-app.railway.app
              │
              └─→ PostgreSQL (Railway 自动提供)
```

## 步骤 1：部署后端到 Railway（约 10 分钟）

### 1.1 注册 Railway
打开 https://railway.app → 用 GitHub 账号登录

### 1.2 创建项目
1. 点击 「New Project」→「Deploy from GitHub repo」
2. 选择 `Pluto12367/kaoyan-408-score-boost`
3. Railway 会自动检测 Dockerfile 并开始构建

### 1.3 添加 PostgreSQL 数据库
1. 在项目页面点击 「+ New」→「Database」→「Add PostgreSQL」
2. Railway 自动创建数据库并注入 `DATABASE_URL` 环境变量

### 1.4 配置环境变量
在项目的 「Variables」 标签页添加：

```
NODE_ENV=production
PORT=3000
JWT_SECRET=你生成的一个至少32位随机字符串
WEB_ORIGIN=https://pluto12367.github.io
ALLOW_DEMO_AUTH=true
```

生成 JWT_SECRET：在终端运行 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 1.5 等待部署完成
Railway 会自动：
1. 构建 Docker 镜像
2. 运行 Prisma 数据库迁移
3. 启动 API 服务器

完成后你会得到一个域名，如 `https://kaoyan-408-api.up.railway.app`

### 1.6 验证后端
浏览器打开 `https://你的域名.up.railway.app/health`
应返回 JSON：`{"status":"ok","service":"kaoyan-408-api",...}`

## 步骤 2：更新前端指向线上 API

### 2.1 设置 GitHub Actions 变量
1. 打开 GitHub 仓库 → Settings → Secrets and variables → Actions
2. 添加 Repository variable：
   - Name: `VITE_API_BASE_URL`
   - Value: `https://你的域名.up.railway.app`

### 2.2 更新部署工作流
替换 `.github/workflows/deploy-pages.yml` 中的 build 步骤，让 Vite 使用线上 API 地址。

## 步骤 3：体验功能

1. 打开 https://pluto12367.github.io/kaoyan-408-score-boost/
2. 注册账号（或使用演示身份）
3. 完成入学诊断 → 获得今日学习计划
4. 做题 → 查看错题 → AI 答疑 → 阶段测评

## 常见问题

**Q: 免费额度够用吗？**
Railway 免费额度每月 $5，够 10-20 人内测使用。

**Q: 数据库需要额外配置吗？**
不需要。Railway PostgreSQL 插件自动创建数据库并注入连接字符串。

**Q: 前端还是显示 Mock 数据？**
检查 VITE_API_BASE_URL 是否设置正确，重新触发 GitHub Actions 部署。

**Q: 如何查看后端日志？**
Railway 项目页面 → Deployments → 点击最近的部署 → 查看日志。
