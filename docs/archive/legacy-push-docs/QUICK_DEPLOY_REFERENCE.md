# ⚡ 408 提分系统 - 快速部署参考卡

## 🚀 一键部署流程

### 本地 → GitHub → 腾讯云

```bash
# 1. 暂存并提交
git add .
git commit -m "feat: your commit message"

# 2. 推送到 GitHub
git push origin codex/deployment-ready

# 3. SSH 到服务器
ssh root@43.128.30.191

# 4. 拉取并部署
git pull origin codex/deployment-ready
./deploy/tencent-ip/deploy.sh

# 5. 验证
curl -fsS http://43.128.30.191/health
```

---

## 📋 常用命令速查

### Git 操作

```bash
# 查看状态
git status

# 暂存所有更改
git add .

# 提交更改
git commit -m "feat: your message"

# 推送到远程
git push origin codex/deployment-ready

# 拉取最新
git pull origin codex/deployment-ready

# 查看提交历史
git log --oneline -10

# 查看远程分支
git branch -r
```

### 构建与测试

```bash
# 运行所有测试
npm test

# 构建 Web 应用
npm run build:web

# 构建 API
npm run build:api

# 构建共享包
npm run build:shared

# 启动本地开发服务器
npm run dev:migration

# 验证环境
npm run validate:env:development
```

### 服务器操作

```bash
# SSH 连接
ssh root@43.128.30.191

# 进入项目目录
cd /path/to/kaoyan-408-score-boost

# 拉取最新代码
git pull origin codex/deployment-ready

# 运行部署
./deploy/tencent-ip/deploy.sh

# 查看容器状态
docker compose --env-file .env.production -f compose.production.yml ps

# 查看应用日志
docker compose --env-file .env.production -f compose.production.yml logs -f app

# 健康检查
curl -fsS http://127.0.0.1/health

# 重启应用
docker compose --env-file .env.production -f compose.production.yml restart app

# 查看数据库
docker compose --env-file .env.production -f compose.production.yml exec postgres psql -U kaoyan408 -d kaoyan408
```

---

## 🎯 部署检查清单

### ✅ 提交前检查

- [ ] 代码修改完成
- [ ] 本地测试通过：`npm test`
- [ ] 构建成功：`npm run build:web` 和 `npm run build:api`
- [ ] 本地验证：`npm run dev:migration`

### ✅ 推送后检查

- [ ] GitHub Actions 通过：https://github.com/Pluto12367/kaoyan408-score-boost/actions
- [ ] 所有测试通过
- [ ] 构建成功
- [ ] GitHub Pages 部署成功

### ✅ 服务器部署检查

- [ ] SSH 连接成功
- [ ] 代码已拉取：`git pull origin codex/deployment-ready`
- [ ] 部署脚本运行成功：`./deploy/tencent-ip/deploy.sh`
- [ ] 容器状态正常：`docker compose ps`
- [ ] 健康检查通过：`curl http://127.0.0.1/health`

### ✅ 最终验证

- [ ] 网站可访问：http://43.128.30.191
- [ ] 登录功能正常
- [ ] 深色主题文字清晰
- [ ] 极简主题侧边栏区分明显
- [ ] 所有功能正常工作

---

## 🔧 常见问题快速解决

### Git 推送失败

```bash
# 检查凭据
git config --global credential.helper

# 更新凭据
git config --global credential.helper store

# 或使用 SSH
git remote set-url origin git@github.com:Pluto12367/kaoyan408-score-boost.git

# 重新推送
git push origin codex/deployment-ready
```

### 测试失败

```bash
# 本地运行测试
npm test

# 查看详细错误
npm test 2>&1 | tail -50

# 修复后重新提交
git add .
git commit -m "fix: resolve test issues"
git push origin codex/deployment-ready
```

### 构建失败

```bash
# 清除缓存
rm -rf node_modules/.cache
rm -rf apps/web/dist

# 重新安装依赖
npm install

# 重新构建
npm run build:shared
npm run build:web
npm run build:api
```

### 服务器部署失败

```bash
# SSH 到服务器
ssh root@43.128.30.191

# 查看容器状态
docker compose --env-file .env.production -f compose.production.yml ps

# 查看容器日志
docker compose --env-file .env.production -f compose.production.yml logs

# 重启容器
docker compose --env-file .env.production -f compose.production.yml restart

# 重新构建
docker compose --env-file .env.production -f compose.production.yml up -d --build
```

### 主题优化未生效

```bash
# 检查文件是否存在
ls -la apps/web/src/theme-optimizations.css

# 检查导入语句
head -5 apps/web/src/styles.css

# 添加导入语句（如果缺少）
sed -i '1i @import "./theme-optimizations.css";' apps/web/src/styles.css

# 重新构建
npm run build:web

# 重新部署
./deploy/tencent-ip/deploy.sh
```

---

## 📊 关键链接

| 资源 | 链接 |
|------|------|
| **GitHub 仓库** | https://github.com/Pluto12367/kaoyan408-score-boost |
| **GitHub Actions** | https://github.com/Pluto12367/kaoyan408-score-boost/actions |
| **GitHub Pages** | https://pluto12367.github.io/kaoyan408-score-boost/ |
| **腾讯云服务器** | http://43.128.30.191 |
| **健康检查** | http://43.128.30.191/health |

---

## 🎨 主题优化快速应用

### 查看预览

```bash
# Windows
start theme-preview.html

# macOS
open theme-preview.html

# Linux
xdg-open theme-preview.html
```

### 应用优化

```css
/* 在 apps/web/src/styles.css 顶部添加 */
@import './theme-optimizations.css';
```

### 验证效果

```bash
# 构建
npm run build:web

# 本地测试
npm run dev:migration

# 浏览器访问
# http://localhost:5173
```

---

## 📈 验证命令

### 本地验证

```bash
# 运行测试
npm test

# 构建验证
npm run build:web
npm run build:api

# 本地服务器
npm run dev:migration
```

### 服务器验证

```bash
# 健康检查
curl -fsS http://43.128.30.191/health

# 容器状态
docker compose --env-file .env.production -f compose.production.yml ps

# 应用日志
docker compose --env-file .env.production -f compose.production.yml logs -f app
```

### 浏览器验证

访问 http://43.128.30.191，验证：

1. **登录功能**
   - 测试账号：1234@qq.com / qwertyuiop159
   - 登录成功

2. **主题切换**
   - 深色主题：文字清晰，边框可见
   - 极简主题：侧边栏区分明显
   - 标准主题：保持原有设计

3. **功能验证**
   - 学习中控台
   - 练习功能
   - 错题本
   - 学习报告

---

## 🚨 紧急回滚

### 回滚到上一个版本

```bash
# 本地回滚
git revert HEAD
git push origin codex/deployment-ready

# 服务器回滚
ssh root@43.128.30.191
cd /path/to/kaoyan-408-score-boost
git pull origin codex/deployment-ready
./deploy/tencent-ip/deploy.sh
```

### 回滚数据库

```bash
# SSH 到服务器
ssh root@43.128.30.191

# 停止应用
docker compose --env-file .env.production -f compose.production.yml down

# 恢复数据库备份
# （需要找到最近的备份文件）
docker compose --env-file .env.production -f compose.production.yml exec postgres pg_restore ...

# 重新启动
docker compose --env-file .env.production -f compose.production.yml up -d
```

---

## 📞 获取帮助

### 查看日志

```bash
# 服务器日志
docker compose --env-file .env.production -f compose.production.yml logs -f

# GitHub Actions 日志
# 访问 https://github.com/Pluto12367/kaoyan408-score-boost/actions
```

### 检查状态

```bash
# Git 状态
git status

# Docker 状态
docker compose --env-file .env.production -f compose.production.yml ps

# 应用健康
curl -fsS http://43.128.30.191/health
```

### 反馈问题

在项目 Issue 中反馈，附上：
- 错误信息
- 复现步骤
- 环境信息

---

## 📚 相关文档

| 文档 | 说明 |
|------|------|
| `GIT_DEPLOY_GUIDE.md` | 完整部署指南 |
| `README_THEME_OPTIMIZATION.md` | 主题优化指南 |
| `THEME_OPTIMIZATION_GUIDE.md` | 主题优化详细指南 |
| `docs/deploy-to-tencent-ip.md` | 腾讯云部署文档 |
| `.env.development.example` | 环境配置示例 |

---

## ✅ 完成清单

- [ ] 代码已修改并测试
- [ ] Git 提交完成
- [ ] 推送到 GitHub
- [ ] GitHub Actions 通过
- [ ] 服务器部署成功
- [ ] 网站可访问
- [ ] 主题优化生效
- [ ] 所有功能正常

---

**最后更新：** 2026-08-15  
**作者：** MiMo (AI Assistant)  
**版本：** 1.0.0
