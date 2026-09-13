> **HISTORICAL SNAPSHOT — NOT A CURRENT AGENT ENTRYPOINT**
>
> Archived 2026-09-12 by Agent Governance Hardening.
> This file describes the repository as of 2026-08-17 (branch
> `codex/deployment-ready`, HEAD `83182ad`, 577 tests). Every one of those facts
> is obsolete.
>
> Current project state is defined by:
> - `AGENTS.md` (repository root) — agent rules (HOW)
> - `docs/current-sprint.md` — project status (WHERE)
>
> Do not treat the "next session prompt" section of this file as a startup
> instruction. Use the **Agent Startup Contract** in `AGENTS.md` instead.
# Codex 项目交接摘要

项目：计算机考研提分系统 / 408 提分系统

本地路径：

D:\计算机考研提分系统

当前分支：

codex/deployment-ready

最新已提交并推送：

83182ad feat(web): add A/B/C theme switching with localStorage persistence（A/B/C 三档界面主题切换）

远端状态：

origin/codex/deployment-ready 已包含 83182ad

服务器：

43.128.30.191 已部署；线上 bundle（index-CUi0Kb3N.js）已确认包含 `theme-switch`、`kaoyan408:theme`，主题切换已上线。

## 最近完成（本交接周期）

- 功能：登录后工作区支持「深色 / 极简 / 标准」三档主题切换；顶栏按钮直接切换，选择写入 localStorage（`kaoyan408:theme`），刷新保持；`main.tsx` 在首帧渲染前应用主题，避免闪烁；全部通过 CSS 变量 + `html[data-theme]` 实现，不触碰业务逻辑。
- 文件：`apps/web/src/App.tsx`、`apps/web/src/main.tsx`、`apps/web/src/styles.css`、`apps/web/src/components/ThemeToggle.tsx`（新增）、`apps/web/src/hooks/useTheme.ts`（新增）、`apps/web/src/theme/themePreference.ts`（新增）、`test/theme-preference.test.js`（新增）。
- 验证：`npm test` 577 通过 / 0 失败 / 1 跳过；`npm run build:web`、`npm run build:api` 通过；浏览器实测三主题即时切换、持久化、刷新保持、无横向溢出；线上 bundle 检查通过。
- 设计：四方向高保真 Mockup 套件在 `design/option-c-mockups/`（A/B/C/D 一键切换版，含 7 个页面效果图），**未入库**，是否存档由用户决定。

## 已完成的学生端闭环功能（此前已上线，仍有效）

- 学生端首页 / 学习中控台、今日任务完成闭环、任务完成后下一步推荐
- 错题本复盘闭环、学习报告行动化、学习计划行动化、训练即时反馈、阶段测评/专项训练结果行动化
- 学生端学习闭环导航条、数据可信度与推荐理由强化、学习目标感强化、学习路径“下一步入口”统一
- 408 知识图谱（掌握度着色、题库/真题接入、闯关小测）与知识目录驱动的计划/推荐（P0 系列）

## 工作区注意（非本次改动，交接前已存在的未提交内容）

- 已修改：`docs/deployment-feature-integration-checklist.md`、`package.json`（以及本交接文档本身）
- 未跟踪：`408-codex-handoff/`、`CODEX-KNOWLEDGE-CATALOG-FIRST-PROMPT.md`、`MANIFEST.json`、`assets/*-check/`、`scripts/probe-*.mjs`、`scripts/verify-deep-interactions.mjs`、`scripts/verify-full-student.mjs`、`var/`
- 规则：禁止 `git add .`；提交/推送必须先经用户批准；不要把这些与本任务无关的改动混入新提交。

## 遗留与风险

- 深色主题（A）已覆盖主要表面（面板、输入框、表格、按钮、状态条）；个别老组件若仍显示硬编码浅色，需截图后逐条补 CSS 覆盖。
- 极简主题（B）是 token 级收敛（去阴影、圆角收紧、侧栏浅色化），布局骨架未改，密度比 Mockup 更克制。
- 登录/注册页保持原有深色设计，不参与三档切换。
- 主题切换只在登录后的工作区顶栏出现；未登录页面无切换入口（设计如此）。

## 下一步建议

- 运行 `npm run verify:deployed` 对线上做全量核对（重点：主题切换按钮在登录后可见、三档可切换、刷新保持）。
- 后续新任务按 `docs/ROADMAP.md` / `docs/DEVELOPMENT_LOG.md` 的“当前状态”继续。
- 如需扩展主题能力（跟随系统偏好、教师/管理端配色），基于现有 `themePreference.ts` + CSS 变量继续。

## 下次接入后继续提示词

请先读取 CODEX_HANDOFF_NEXT.md、docs/PROJECT_CONTEXT.md、docs/ARCHITECTURE.md、docs/DEVELOPMENT_LOG.md（当前状态），以仓库实际代码为准核对，不依赖历史聊天记录；涉及代码修改前执行开源参考检查。禁止 git add .，提交/推送必须等用户批准。
