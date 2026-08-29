# 🔑 GitHub 个人访问令牌 (PAT) 创建指南

## 📋 概述

**目的**：创建 GitHub 个人访问令牌用于推送代码  
**时间**：约 5 分钟  
**状态：** ✅ 准备就绪

---

## 🎯 创建 PAT 步骤

### 步骤 1：访问 GitHub 设置

1. 登录 GitHub：https://github.com
2. 点击右上角头像
3. 选择 **Settings**

### 步骤 2：进入开发者设置

1. 在左侧菜单中，滚动到底部
2. 点击 **Developer settings**

### 步骤 3：创建个人访问令牌

1. 在左侧菜单中，点击 **Personal access tokens**
2. 选择 **Tokens (classic)**
3. 点击 **Generate new token**
4. 选择 **Generate new token (classic)**

### 步骤 4：配置令牌

**Note（备注）**：
```
kaoyan-408-deployment
```

**Expiration（过期时间）**：
- 选择 **90 days**（推荐）
- 或选择 **No expiration**（不推荐）

**Select scopes（选择权限）**：
- ✅ **repo**（完整仓库访问权限）
  - ✅ repo:status
  - ✅ repo_deployment
  - ✅ public_repo
  - ✅ repo:invite
  - ✅ security_events

### 步骤 5：生成令牌

1. 点击 **Generate token**
2. **立即复制令牌**（只会显示一次）
3. 保存到安全位置

---

## 🚀 使用 PAT 推送代码

### 方法 1：直接推送（推荐）

```bash
# 推送到 GitHub
git push origin codex/deployment-ready

# 当提示输入用户名时：
# Username: Pluto12367
# Password: <粘贴您的 PAT>
```

### 方法 2：配置 Git 凭证存储

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

### 方法 3：使用 Git Credential Manager

```bash
# 安装 Git Credential Manager（Windows）
# 下载地址：https://github.com/git-ecosystem/git-credential-manager/releases

# 配置 Git 使用 Credential Manager
git config --global credential.helper manager

# 推送代码
git push origin codex/deployment-ready

# 将弹出浏览器窗口进行 GitHub 登录
```

---

## 🔧 验证推送

### 推送成功后验证

```bash
# 查看提交历史
git log --oneline -5

# 查看本地与远程的差异
git log --oneline origin/codex/deployment-ready..HEAD

# 查看远程分支状态
git branch -r
```

### 预期结果

- ✅ 本地与远程同步
- ✅ 提交已推送到 GitHub
- ✅ GitHub Actions 开始运行

---

## 📊 查看 GitHub Actions

推送成功后，GitHub Actions 会自动运行：

**访问**：https://github.com/Pluto12367/kaoyan408-score-boost/actions

**检查点**：
- ✅ 测试阶段：所有测试通过
- ✅ 构建阶段：API 和 Web 构建成功
- ✅ 部署阶段：GitHub Pages 部署成功

**预计时间**：5-10 分钟

---

## 🎨 验证 GitHub Pages

部署完成后，访问：
https://pluto12367.github.io/kaoyan408-score-boost/

**验证内容**：
- ✅ 网站正常加载
- ✅ 三种主题切换正常
- ✅ 深色主题文字清晰
- ✅ 极简主题侧边栏区分明显

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

---

## 🔐 安全建议

### PAT 安全最佳实践

1. **定期轮换**：每 90 天更换一次 PAT
2. **最小权限**：只授予必要的权限
3. **安全存储**：不要将 PAT 提交到代码仓库
4. **使用环境变量**：在 CI/CD 中使用环境变量存储 PAT

### 撤销 PAT

如果 PAT 泄露：

1. 访问 GitHub 设置
2. 进入 Personal access tokens
3. 找到对应的 PAT
4. 点击 **Delete**

---

## 📚 参考资源

- [GitHub 文档：创建个人访问令牌](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [GitHub 文档：使用 HTTPS 克隆仓库](https://docs.github.com/en/get-started/getting-started-with-git/about-remote-repositories#cloning-with-https-urls)
- [Git Credential Manager](https://github.com/git-ecosystem/git-credential-manager)

---

## ✅ 完成清单

- [ ] 访问 GitHub 设置
- [ ] 进入开发者设置
- [ ] 创建个人访问令牌
- [ ] 配置令牌权限（repo）
- [ ] 复制并保存 PAT
- [ ] 使用 PAT 推送代码
- [ ] 验证推送成功
- [ ] 查看 GitHub Actions
- [ ] 验证 GitHub Pages

---

## 🎉 总结

完成以上步骤后，您将能够：

✅ **创建 GitHub 个人访问令牌**  
✅ **使用 PAT 推送代码到 GitHub**  
✅ **GitHub Actions 自动测试和部署**  
✅ **验证 GitHub Pages 部署**

**下一步**：使用 PAT 推送代码到 GitHub

---

**最后更新：** 2026-08-15  
**作者：** MiMo (AI Assistant)  
**版本：** 1.0.0
