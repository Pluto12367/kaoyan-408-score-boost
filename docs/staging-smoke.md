# Staging 冒烟检查

该检查用于在邀请学生内测前，验证前端域名、API、PostgreSQL、邀请注册和学习数据持久化链路仍然正常。

## 覆盖范围

1. `/health` 返回 PostgreSQL 已连接，并包含 `x-request-id`。
2. 配置的前端来源通过 CORS 预检，未知来源不被放行。
3. staging 环境的演示登录保持关闭。
4. 专用学生账号可以登录；账号不存在时，无邀请码注册必须被拒绝，带 `STAGING_SMOKE_INVITATION` 的注册才能成功。
5. 入学诊断可以生成七天计划和三个今日任务。
6. 修改 `userId` 不能读取其他学生数据。
7. 今日任务可以提交完整的质量指标并完成。
8. 退出并重新登录后，目标分和任务完成状态仍保存在 PostgreSQL。

## GitHub 配置

在仓库 `Settings -> Secrets and variables -> Actions` 中配置：

- Variables：`STAGING_API_URL`、`STAGING_WEB_ORIGIN`
- Secrets：`STAGING_SMOKE_EMAIL`、`STAGING_SMOKE_PASSWORD`、`STAGING_SMOKE_INVITATION`

专用账号仅用于自动检查，不邀请真实学生使用。密码至少 12 位；邀请码、密码和令牌不能提交到仓库或写入日志。

## 执行方式

打开仓库 `Actions -> Verify staging -> Run workflow` 手动运行。工作流不会随普通代码提交自动执行，避免反复改写 staging 学习数据。

本地也可以在已设置上述环境变量的终端执行：

```bash
npm run smoke:staging
```

成功时会输出十个 `PASS` 检查项和一份不含账号、密码、邀请码、令牌的结果摘要。
