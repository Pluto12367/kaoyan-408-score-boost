# 部署前检查清单

## 目标

发布一个小规模封闭体验版本，邀请 10-20 名正在备考 408 的学生完成一次真实试用，并收集问卷反馈。

## 发布前必须完成

- [ ] 运行 `npm test`，确认核心提分逻辑通过。
- [ ] 本地启动 `npm start`。
- [ ] 运行 `npm run check:local`，确认页面能渲染并生成桌面/移动截图。
- [ ] 检查首页能访问，地址栏显示 HTTPS。
- [ ] 检查移动端可正常浏览，无明显横向滚动。
- [ ] 确认 `robots.txt` 暂时禁止搜索引擎收录。
- [ ] 将问卷链接填入邀请文案或反馈群公告。
- [ ] 发送 `docs/privacy-notice.md` 中的隐私说明。
- [ ] 建立反馈收集表格，字段至少包含姓名/昵称、备考阶段、联系方式、问题截图、建议。

## 推荐部署方式

### GitHub Pages

1. 确认代码已推送到 GitHub 的 `codex/deployment-ready` 分支。
2. 打开 GitHub 仓库页面。
3. 进入 `Settings` → `Pages`。
4. 将 Source 设置为 `GitHub Actions`。
5. 打开 `Actions` 页面，查看 `Deploy GitHub Pages` 是否运行成功。
6. 发布成功后访问 `https://pluto12367.github.io/kaoyan-408-score-boost/`。
7. 如果页面正常，将该链接填入 `docs/invitation-message.md`。

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
