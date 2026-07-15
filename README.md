# 计算机考研 408 提分系统

面向计算机考研学生的 408 专业课提分平台。项目采用 React + TypeScript + NestJS + Prisma + PostgreSQL，覆盖智能诊断、学习计划、题库训练、错题复习、模拟考试、提分报告、教研后台和管理看板。

## 本地运行

```bash
npm start
```

静态预览打开 `http://localhost:4173`。使用本地 API 和 PostgreSQL 进行全栈开发时运行：

```bash
npm run dev:migration
```

## 验证

```bash
npm test
npm run verify:ui
npm run check:local
```

`verify:ui` 会调用本机 Chrome 生成桌面和移动端截图：

- `assets/render-desktop.png`
- `assets/render-mobile.png`

## 部署

前端构建产物位于 `apps/web/dist`：

- Build command: `npm run build:web`
- 本地完整检查：`npm run check:local`
- Output directory: `apps/web/dist`
- 独立域名设置：`VITE_PUBLIC_BASE_PATH=/`
- 公网 API 设置：`VITE_API_BASE_URL=https://<api-domain>`

可靠内测需要同时部署 NestJS API 和 PostgreSQL。GitHub Pages 未配置公网 API 时仅作为明确标识的静态演示站。

### GitHub Pages

仓库包含 `.github/workflows/deploy-pages.yml`。推送 `codex/deployment-ready` 分支后，GitHub Actions 会运行单元测试、PostgreSQL 集成测试、备份校验和前后端构建，再发布静态站点。

首次使用时，在 GitHub 仓库页面进入 `Settings` → `Pages`，将 Source 设置为 `GitHub Actions`。发布完成后，页面地址通常是：

`https://pluto12367.github.io/kaoyan-408-score-boost/`

当前体验地址：

`https://pluto12367.github.io/kaoyan-408-score-boost/`

## 体验材料

- 部署清单：`docs/deployment-checklist.md`
- 学生体验任务：`docs/student-trial-guide.md`
- 问卷模板：`docs/survey-template.md`
- 隐私说明：`docs/privacy-notice.md`

## 封闭体验链接

- 系统体验地址：`https://pluto12367.github.io/kaoyan-408-score-boost/`
- 反馈问卷地址：`https://wj.qq.com/s2/27160624/40fe/`
