# 计算机考研 408 提分系统

面向计算机考研学生的 408 专业课提分 Web 原型。当前版本聚焦一条完整体验链路：智能诊断、学习计划、408 知识图谱、题库训练、错题本、提分报告、教研后台和管理看板。

## 本地运行

```bash
npm start
```

打开 `http://localhost:4173`。

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

当前项目是静态页面 + 原生 ES Modules，可直接部署根目录。

- Build command: 留空或使用 `npm run predeploy` 作为发布前检查
- 本地完整检查：`npm run check:local`
- Output directory: `.`
- Entry: `index.html`

推荐先使用封闭测试链接，不开放搜索引擎收录。

### GitHub Pages

仓库包含 `.github/workflows/deploy-pages.yml`。推送 `codex/deployment-ready` 分支后，GitHub Actions 会先运行 `npm run predeploy`，通过后发布静态站点。

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
