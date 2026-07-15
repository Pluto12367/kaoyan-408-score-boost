# 部署前检查清单

## 目标

发布一个小规模封闭体验版本，邀请 10-20 名正在备考 408 的学生完成一次真实试用，并收集问卷反馈。

## 发布前必须完成

- [ ] 使用 `.env.staging.example` 创建未提交的 `.env.staging`，替换所有占位值。
- [ ] 运行 `npm run validate:env -- --file .env.staging`，确认环境门禁通过。
- [ ] 运行 `npm run check:release`，确认单元测试、前后端构建和迁移冒烟测试通过。
- [ ] 运行 `npm run test:integration:postgres`，确认注册、诊断、练习、错题、退出重登和会话恢复通过。
- [ ] 运行 `npm run db:backup` 和 `npm run db:backup:verify`，并在独立演练数据库完成一次恢复。
- [ ] 本地启动前端与 API，并确认 `/health` 返回 `dataSource: postgresql`。
- [ ] 运行 `npm run check:local`，确认页面能渲染并生成桌面/移动截图。
- [ ] 在浏览器用全新账号走通“注册 → 诊断 → 今日任务 → 答错并选择错因 → 退出重登”，确认任务和错题恢复且不出现其他学生资料。
- [ ] 检查首页能访问，地址栏显示 HTTPS。
- [ ] 检查移动端可正常浏览，无明显横向滚动。
- [ ] 确认 `robots.txt` 暂时禁止搜索引擎收录。
- [x] 将问卷链接填入邀请文案或反馈群公告：`https://wj.qq.com/s2/27160624/40fe/`。
- [ ] 发送 `docs/privacy-notice.md` 中的隐私说明。
- [ ] 建立反馈收集表格，字段至少包含姓名/昵称、备考阶段、联系方式、问题截图、建议。
- [ ] 管理端确认十项核心内测指标显示真实分子/分母；无样本指标应显示“待积累”。

## 推荐部署方式

### 可靠内测环境（推荐）

1. 前端部署至 Vercel 或 Cloudflare Pages，设置 `VITE_API_BASE_URL=https://<api-domain>`。
2. NestJS API 部署至 Railway，配置 `DATABASE_URL`、`JWT_SECRET`、`WEB_ORIGIN`、`ALLOW_DEMO_AUTH=false`。
3. Railway PostgreSQL 启用每日自动备份，并在首次邀请前执行一次恢复演练。
4. 前端域名、API 域名只使用 HTTPS；`WEB_ORIGIN` 精确填写前端域名，不使用 `*`。
5. 用真实学生账号完成“注册 → 诊断 → 今日任务 → 做题 → 错题笔记 → 退出重登 → 恢复记录”。
6. 将 API `/health` 和前端首页加入可用性监控，请求失败时记录响应中的 `x-request-id`。

GitHub Pages 保留为无真实数据的公开演示站，不作为可靠内测环境。

### GitHub Pages

1. 确认代码已推送到 GitHub 的 `codex/deployment-ready` 分支。
2. 打开 GitHub 仓库页面。
3. 进入 `Settings` → `Pages`。
4. 将 Source 设置为 `GitHub Actions`。
5. 打开 `Actions` 页面，查看 `Deploy GitHub Pages` 是否运行成功。
6. 发布成功后访问 `https://pluto12367.github.io/kaoyan-408-score-boost/`。
7. 如果页面正常，将该链接填入 `docs/invitation-message.md`。当前体验地址为 `https://pluto12367.github.io/kaoyan-408-score-boost/`。

> GitHub Pages 只托管静态前端。未配置公网 API 时会进入明确标注的静态演示模式，不能用于验证 PostgreSQL 持久化。

### Netlify

1. 将项目推送到 GitHub。
2. 在 Netlify 导入仓库。
3. Build command 使用 `npm run predeploy`。
4. Publish directory 使用 `.`。
5. 发布后打开首页检查。

### Vercel

1. 将项目推送到 GitHub。
2. 在 Vercel 导入仓库。
3. Framework 选择 Other。
4. Build command 使用 `npm run predeploy`。
5. Output directory 使用 `.`。
6. 发布后打开首页检查。

### Cloudflare Pages

1. 将项目推送到 GitHub。
2. 在 Cloudflare Pages 导入仓库。
3. Build command 使用 `npm run predeploy`。
4. Build output directory 使用 `/` 或留空后按平台提示配置根目录。
5. 发布后打开首页检查。

## 体验周期

- 第 1 天：发布体验链接，邀请学生。
- 第 2-4 天：学生完成体验任务并提交问卷。
- 第 5 天：整理问卷，标记高频问题。
- 第 6-7 天：确定下一版优先级。

## 不建议第一轮做的事

- 不开放大规模公开访问。
- 不承诺 AI 答疑一定准确。
- 不收集身份证号、准考证号、详细学校账号等敏感信息。
- 不把学生的分数、错题和个人信息公开展示。
