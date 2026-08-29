# ⚡ GitHub PAT 快速参考卡

## 🔑 创建 PAT（3 分钟）

### 快速步骤

1. **访问**：https://github.com/settings/tokens
2. **点击**：Generate new token → Generate new token (classic)
3. **配置**：
   - Note: `kaoyan-408-deployment`
   - Expiration: `90 days`
   - Scopes: ✅ `repo`（全部勾选）
4. **点击**：Generate token
5. **复制**：立即复制并保存

---

## 🚀 使用 PAT 推送

### 方法 1：直接推送（推荐）

```bash
# 推送代码
git push origin codex/deployment-ready

# 当提示输入凭据时：
# Username: Pluto12367
# Password: <粘贴您的 PAT>
```

### 方法 2：配置凭证存储

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

---

## ✅ 验证推送

```bash
# 查看提交历史
git log --oneline -5

# 查看本地与远程的差异
git log --oneline origin/codex/deployment-ready..HEAD

# 预期结果：
# - 本地与远程同步
# - 提交已推送到 GitHub
```

---

## 📊 查看 GitHub Actions

**访问**：https://github.com/Pluto12367/kaoyan408-score-boost/actions

**检查点**：
- ✅ 测试阶段：所有测试通过
- ✅ 构建阶段：API 和 Web 构建成功
- ✅ 部署阶段：GitHub Pages 部署成功

**预计时间**：5-10 分钟

---

## 🎨 验证 GitHub Pages

**访问**：https://pluto12367.github.io/kaoyan408-score-boost/

**验证内容**：
- ✅ 网站正常加载
- ✅ 三种主题切换正常
- ✅ 深色主题文字清晰
- ✅ 极简主题侧边栏区分明显

---

## 🚨 常见问题

### PAT 无效

**错误**：
```
remote: Support for password authentication was removed on August 13, 2021.
```

**解决**：
1. 确保 PAT 未过期
2. 确保 PAT 有 `repo` 权限
3. 重新生成 PAT

### 权限不足

**错误**：
```
remote: Permission to Pluto12367/kaoyan408-score-boost.git denied to user.
```

**解决**：
1. 确保 PAT 有 `repo` 权限
2. 确保您是仓库的协作者或所有者
3. 检查仓库权限设置

---

## 🔐 安全建议

1. **定期轮换**：每 90 天更换一次 PAT
2. **最小权限**：只授予必要的权限
3. **安全存储**：不要将 PAT 提交到代码仓库
4. **使用环境变量**：在 CI/CD 中使用环境变量存储 PAT

---

## 📚 参考资源

- [GitHub 文档：创建个人访问令牌](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [GitHub 文档：使用 HTTPS 克隆仓库](https://docs.github.com/en/get-started/getting-started-with-git/about-remote-repositories#cloning-with-https-urls)

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

## 🎉 下一步

1. **创建 PAT**：按照上述步骤创建
2. **推送代码**：使用 PAT 推送代码
3. **验证部署**：查看 GitHub Actions 和 GitHub Pages

---

**最后更新：** 2026-08-15  
**作者：** MiMo (AI Assistant)  
**版本：** 1.0.0
