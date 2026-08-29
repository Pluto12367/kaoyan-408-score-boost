# 🚀 推送代码到 GitHub 完整指南

## 📋 概述

**目标**：将主题优化代码推送到 GitHub  
**状态**：✅ 代码已提交，等待推送  
**当前分支**：`codex/deployment-ready`  
**待推送提交**：1 个（`38ec1b4`）

---

## 🎯 推送流程

### 步骤 1：创建 GitHub 个人访问令牌 (PAT)

**时间**：约 3 分钟

1. **访问 GitHub 设置**
   - 登录：https://github.com
   - 点击右上角头像 → **Settings**

2. **进入开发者设置**
   - 左侧菜单滚动到底部
   - 点击 **Developer settings**

3. **创建个人访问令牌**
   - 左侧菜单：**Personal access tokens** → **Tokens (classic)**
   - 点击 **Generate new token** → **Generate new token (classic)**

4. **配置令牌**
   - **Note**：`kaoyan-408-deployment`
   - **Expiration**：`90 days`（推荐）
   - **Select scopes**：✅ **repo**（全部勾选）

5. **生成并保存**
   - 点击 **Generate token**
   - **立即复制**（只会显示一次）
   - 保存到安全位置

---

### 步骤 2：使用 PAT 推送代码

**时间**：约 1 分钟

#### 方法 1：直接推送（推荐）

```bash
# 推送代码
git push origin codex/deployment-ready

# 当提示输入凭据时：
# Username: Pluto12367
# Password: <粘贴您的 PAT>
```

#### 方法 2：配置凭证存储（推荐长期使用）

```bash
# 配置 Git 记住凭据
git config --global credential.helper store

# 推送代码
git push origin codex/deployment-ready

# 当提示输入凭据时：
# Username: Pluto12367
# Password: <粘贴您的 PAT>

# 之后推送将自动使用保存的凭据
```

#### 方法 3：使用 SSH（如果配置了 SSH 密钥）

```bash
# 切换到 SSH 协议
git remote set-url origin git@github.com:Pluto12367/kaoyan408-score-boost.git

# 推送代码
git push origin codex/deployment-ready
```

---

### 步骤 3：验证推送成功

**时间**：约 1 分钟

```bash
# 查看提交历史
git log --oneline -5

# 查看本地与远程的差异
git log --oneline origin/codex/deployment-ready..HEAD

# 查看远程分支状态
git branch -r
```

**预期结果**：
- ✅ 本地与远程同步
- ✅ 提交已推送到 GitHub
- ✅ 无待推送的提交

---

## 📊 GitHub Actions 自动化

推送成功后，GitHub Actions 会自动运行：

### 查看 Actions 状态

**访问**：https://github.com/Pluto12367/kaoyan408-score-boost/actions

### Actions 流程

1. **测试阶段**
   - 运行单元测试（`npm test`）
   - 运行 PostgreSQL 集成测试
   - 验证数据库备份
   - 构建 API 和 Web 应用

2. **构建阶段**
   - 构建 Docker 镜像
   - 构建 Web 应用

3. **部署阶段**
   - 部署到 GitHub Pages（静态演示）

### 检查点

- ✅ 所有测试通过
- ✅ 构建成功
- ✅ 部署成功

**预计时间**：5-10 分钟

---

## 🎨 验证 GitHub Pages

部署完成后，访问：
https://pluto12367.github.io/kaoyan408-score-boost/

### 验证内容

1. **网站加载**
   - ✅ 网站正常加载
   - ✅ 无错误信息

2. **主题切换**
   - ✅ 找到主题切换按钮
   - ✅ 切换到深色主题
   - ✅ 切换到极简主题
   - ✅ 切换到标准主题

3. **深色主题验证**
   - ✅ 文字清晰可读
   - ✅ 输入框边框可见
   - ✅ 卡片层次分明

4. **极简主题验证**
   - ✅ 侧边栏与内容区域有明显区分
   - ✅ 激活的导航项有左侧高亮条

5. **功能验证**
   - ✅ 登录功能正常（测试账号：1234@qq.com / qwertyuiop159）
   - ✅ 学习中控台正常显示
   - ✅ 练习功能正常
   - ✅ 错题本正常
   - ✅ 学习报告正常

---

## 🖥️ 腾讯云服务器部署（可选）

如果需要部署到腾讯云服务器：

### 步骤 1：SSH 连接到服务器

```bash
# 连接到腾讯云服务器
ssh root@43.128.30.191

# 或使用密钥文件
ssh -i ~/.ssh/your_key.pem root@43.128.30.191
```

### 步骤 2：拉取最新代码

```bash
# 进入项目目录
cd /path/to/kaoyan-408-score-boost

# 拉取最新代码
git pull origin codex/deployment-ready

# 验证最新提交
git log --oneline -3
```

### 步骤 3：运行部署脚本

```bash
# 确保脚本有执行权限
chmod +x deploy/tencent-ip/deploy.sh

# 运行部署脚本
./deploy/tencent-ip/deploy.sh
```

### 步骤 4：验证部署

```bash
# 检查容器状态
docker compose --env-file .env.production -f compose.production.yml ps

# 检查应用健康
curl -fsS http://127.0.0.1/health

# 查看应用日志
docker compose --env-file .env.production -f compose.production.yml logs -f app
```

### 步骤 5：访问网站

在浏览器中访问：http://43.128.30.191

**验证内容**：
- ✅ 网站正常加载
- ✅ 登录功能正常
- ✅ 三种主题切换正常
- ✅ 所有功能正常工作

---

## 🚨 常见问题

### 问题 1：PAT 无效

**错误信息**：
```
remote: Support for password authentication was removed on August 13, 2021.
remote: Please see https://docs.github.com/en/get-started/getting-started-with-git/about-remote-repositories#cloning-with-https-urls for information on currently recommended modes of authentication.
fatal: Authentication failed for 'https://github.com/Pluto12367/kaoyan408-score-boost.git/'
```

**解决方案**：
1. 确保 PAT 未过期
2. 确保 PAT 有 `repo` 权限
3. 重新生成 PAT

### 问题 2：权限不足

**错误信息**：
```
remote: Permission to Pluto12367/kaoyan408-score-boost.git denied to user.
fatal: unable to access 'https://github.com/Pluto12367/kaoyan408-score-boost.git/': The requested URL returned error: 403
```

**解决方案**：
1. 确保 PAT 有 `repo` 权限
2. 确保您是仓库的协作者或所有者
3. 检查仓库权限设置

### 问题 3：网络问题

**错误信息**：
```
fatal: unable to access 'https://github.com/Pluto12367/kaoyan408-score-boost.git/': Could not resolve host: github.com
```

**解决方案**：
1. 检查网络连接
2. 尝试使用 VPN
3. 使用 SSH 协议（如果配置了 SSH 密钥）

### 问题 4：GitHub Actions 失败

**检查步骤**：
1. 访问 https://github.com/Pluto12367/kaoyan408-score-boost/actions
2. 查看失败的 workflow
3. 检查错误日志

**常见原因**：
- 测试失败
- 构建错误
- 环境变量缺失

**解决方案**：
```bash
# 本地运行测试
npm test

# 本地构建验证
npm run build:web
npm run build:api

# 修复问题后重新提交
git add .
git commit -m "fix: resolve build/test issues"
git push origin codex/deployment-ready
```

---

## 📋 快速命令参考

### Git 操作

```bash
# 查看状态
git status

# 暂存更改
git add .

# 提交更改
git commit -m "feat: your commit message"

# 推送到 GitHub
git push origin codex/deployment-ready

# 拉取最新
git pull origin codex/deployment-ready

# 查看提交历史
git log --oneline -10
```

### 构建与测试

```bash
# 运行测试
npm test

# 构建 Web 应用
npm run build:web

# 构建 API
npm run build:api

# 启动本地服务器
npm run dev:migration
```

### 服务器操作

```bash
# SSH 连接
ssh root@43.128.30.191

# 拉取最新代码
git pull origin codex/deployment-ready

# 运行部署
./deploy/tencent-ip/deploy.sh

# 查看容器状态
docker compose --env-file .env.production -f compose.production.yml ps

# 健康检查
curl -fsS http://127.0.0.1/health
```

---

## 🎯 关键链接

| 资源 | 链接 |
|------|------|
| **GitHub 仓库** | https://github.com/Pluto12367/kaoyan408-score-boost |
| **GitHub Actions** | https://github.com/Pluto12367/kaoyan408-score-boost/actions |
| **GitHub Pages** | https://pluto12367.github.io/kaoyan408-score-boost/ |
| **腾讯云服务器** | http://43.128.30.191 |
| **健康检查** | http://43.128.30.191/health |
| **GitHub PAT 设置** | https://github.com/settings/tokens |

---

## ✅ 完成清单

### 推送前检查

- [ ] 代码已提交
- [ ] 本地测试通过：`npm test`
- [ ] 构建成功：`npm run build:web` 和 `npm run build:api`

### 推送操作

- [ ] 创建 GitHub PAT
- [ ] 使用 PAT 推送代码：`git push origin codex/deployment-ready`
- [ ] 验证推送成功：`git log --oneline origin/codex/deployment-ready..HEAD`

### GitHub Actions

- [ ] 查看 Actions 状态：https://github.com/Pluto12367/kaoyan408-score-boost/actions
- [ ] 确认所有测试通过
- [ ] 确认构建成功
- [ ] 确认部署成功

### GitHub Pages

- [ ] 访问 GitHub Pages：https://pluto12367.github.io/kaoyan408-score-boost/
- [ ] 验证网站正常加载
- [ ] 测试三种主题切换
- [ ] 验证深色主题文字清晰
- [ ] 验证极简主题侧边栏区分明显

### 腾讯云部署（可选）

- [ ] SSH 连接服务器：`ssh root@43.128.30.191`
- [ ] 拉取最新代码：`git pull origin codex/deployment-ready`
- [ ] 运行部署脚本：`./deploy/tencent-ip/deploy.sh`
- [ ] 验证部署：`curl -fsS http://127.0.0.1/health`
- [ ] 访问网站：http://43.128.30.191

---

## 📚 相关文档

| 文档 | 说明 |
|------|------|
| `GITHUB_PAT_GUIDE.md` | GitHub PAT 创建指南 |
| `PAT_QUICK_REFERENCE.md` | PAT 快速参考卡 |
| `GIT_DEPLOY_GUIDE.md` | 完整部署指南 |
| `QUICK_DEPLOY_REFERENCE.md` | 部署快速参考卡 |
| `DEPLOYMENT_STEPS.md` | 部署执行步骤 |
| `README_THEME_OPTIMIZATION.md` | 主题优化指南 |

---

## 🎉 总结

完成以上步骤后，您将能够：

✅ **创建 GitHub 个人访问令牌**  
✅ **使用 PAT 推送代码到 GitHub**  
✅ **GitHub Actions 自动测试和部署**  
✅ **验证 GitHub Pages 部署**  
✅ **（可选）部署到腾讯云服务器**

**下一步**：创建 PAT 并推送代码

---

**最后更新：** 2026-08-15  
**作者：** MiMo (AI Assistant)  
**版本：** 1.0.0
