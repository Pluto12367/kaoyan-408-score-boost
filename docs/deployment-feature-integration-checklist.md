# 发布功能整合核查清单

> 目的：在部署前确认“之前加过的功能”是否已经真正整合到正式发布分支，并能在服务器与浏览器中被验证。不要只看 `deploy.sh` 成功；必须同时核查 Git、源码、容器、浏览器四层证据。

## 1. 当前建议发布目标

服务器长期应固定部署：

```text
codex/deployment-ready
```

临时预览分支只用于短期验收，不应作为长期服务器基线：

```text
codex/preview-student-console
codex/returning-student-today-route
```

## 2. 功能与系统位置

| 功能 | 用户看到的位置 | 核查关键词 / 文件 | 当前整合状态 |
|---|---|---|---|
| 408 知识图谱 | 学生导航栏 → `408知识图谱` | `KnowledgeCatalog`、`408知识图谱` | 已在 `origin/codex/deployment-ready` |
| 今日提分中心 | 学生导航栏 → `今日提分` | `TodaysScoreCenter`、`今日提分` | 已在 `origin/codex/deployment-ready` |
| 今日学习路线 | 学生首页 / 学习总览 | `TodayLearningRoute`、`今日学习路线` | 已在 `origin/codex/deployment-ready` |
| 导航栏优化：滚动保持可见 | 学生端侧边/底部导航 | `524c962 feat(web): keep navigation visible while scrolling` | 本地 `codex/deployment-ready` 已整合，待 push 到 `origin/codex/deployment-ready` |
| 导航栏优化：平板不溢出 | 平板宽度下导航布局 | `5dbf894 fix(web): prevent tablet navigation overflow` | 本地 `codex/deployment-ready` 已整合，待 push 到 `origin/codex/deployment-ready` |
| 学习中控台 | 学生首页 / 学习总览顶部 | `StudentLearningConsole`、`学习中控台`、`今日学习路径`、`自主学习` | 本地 `codex/deployment-ready` 已整合，待 push 到 `origin/codex/deployment-ready` |

## 3. 当前 Git 证据

本地核查命令：

```powershell
git branch -r --contains 524c962
git branch -r --contains 5dbf894
git branch -r --contains 9e78ecf
git branch -r --contains fa5b1ba
git branch -r --contains d225f78
```

当前证据：

```text
524c962 / 5dbf894:
  origin/codex/returning-student-today-route

9e78ecf / fa5b1ba / d225f78:
  origin/codex/preview-student-console
```

整合前，如果服务器只部署其中一个分支，就会出现：

```text
部署 returning-student-today-route:
  有导航栏优化
  无学习中控台

部署 preview-student-console:
  有学习中控台
  缺少后续导航栏优化
```

当前本地已把两组功能整合进：

```text
codex/deployment-ready
```

下一步需要在本地验证通过后，将本地 `codex/deployment-ready` 推送到：

```text
origin/codex/deployment-ready
```

## 4. 分支差异核查

导航栏优化相对正式发布分支的差异：

```powershell
git diff --stat origin/codex/deployment-ready..origin/codex/returning-student-today-route
```

当前差异摘要：

```text
apps/web/src/App.tsx
apps/web/src/layouts/RoleNavigation.tsx
apps/web/src/styles.css
docs/superpowers/plans/2026-08-09-responsive-sticky-navigation.md
docs/superpowers/specs/2026-08-09-responsive-sticky-navigation-design.md
test/responsive-sticky-navigation.test.js
```

学习中控台相对正式发布分支的差异：

```powershell
git diff --stat origin/codex/deployment-ready..origin/codex/preview-student-console
```

当前差异摘要：

```text
apps/web/src/features/student/StudentLearningConsole.tsx
apps/web/src/features/student/StudentSections.tsx
apps/web/src/styles.css
test/student-learning-console-ui.test.js
```

## 5. 本地整合推荐步骤

只在本地做整合、冲突解决和测试；服务器只拉取干净发布分支。

```powershell
cd "C:\Users\Lenovo\Documents\计算机考研提分系统"

git fetch origin
git switch codex/deployment-ready
git pull --ff-only
```

先整合导航栏优化：

```powershell
git cherry-pick 524c962
git cherry-pick 5dbf894
```

再整合学习中控台：

```powershell
git cherry-pick 9e78ecf
git cherry-pick fa5b1ba
git cherry-pick d225f78
```

如果 cherry-pick 冲突：

```powershell
git status --short
```

解决冲突后只显式 stage 相关文件，不使用 `git add .`：

```powershell
git add <冲突文件1> <冲突文件2>
git cherry-pick --continue
```

## 6. 发布前本地验证

整合完成后必须运行：

```powershell
npm run build:web
npm test
```

并用源码关键词确认：

```powershell
rg "学习中控台|今日学习路径|自主学习" apps/web/src test
rg "今日学习路线|TodayLearningRoute" apps/web/src test
rg "408知识图谱|KnowledgeCatalog" apps/web/src test
rg "今日提分|TodaysScoreCenter" apps/web/src test
rg "responsive-sticky|tablet navigation overflow|keep navigation visible" docs test apps/web/src
```

## 7. 推送正式发布分支

只有本地验证通过后，才推送：

```powershell
git push origin codex/deployment-ready
```

## 8. 服务器部署标准流程

服务器应保持干净发布分支：

```sh
cd ~/kaoyan-408-score-boost

git fetch origin refs/heads/codex/deployment-ready:refs/remotes/origin/codex/deployment-ready
git switch -C codex/deployment-ready origin/codex/deployment-ready
git status --short
```

`git status --short` 应没有输出。

然后部署：

```sh
./deploy/tencent-ip/deploy.sh
```

## 9. 服务器源码核查

部署前后都可以检查：

```sh
grep -R "学习中控台\|今日学习路径\|自主学习" -n apps/web/src test || true
grep -R "今日学习路线\|TodayLearningRoute" -n apps/web/src test || true
grep -R "408知识图谱\|KnowledgeCatalog" -n apps/web/src test || true
grep -R "今日提分\|TodaysScoreCenter" -n apps/web/src test || true
grep -R "responsive-sticky\|tablet navigation overflow\|keep navigation visible" -n docs test apps/web/src || true
```

## 10. 容器与浏览器核查

确认 gateway 容器当前加载的构建资源：

```sh
docker compose --env-file .env.production -f compose.production.yml exec -T gateway sh -lc 'cat /usr/share/nginx/html/index.html'
docker compose --env-file .env.production -f compose.production.yml exec -T gateway sh -lc 'ls -lah /usr/share/nginx/html/assets | grep index'
```

浏览器用带 cache-busting 的地址验收：

```text
http://43.128.30.191/?v=deployment-ready-check#/dashboard
```

学生账号登录后，应能同时看到：

```text
学习中控台
今日学习路径
自主学习
今日学习路线
408知识图谱
今日提分
错题复盘
AI 答疑
```

## 11. 发布记录模板

每次发布记录：

```text
发布日期：
发布分支：
发布 commit：

本地验证：
- npm run build:web:
- npm test:

服务器：
- git branch --show-current:
- git rev-parse HEAD:
- git status --short:

gateway:
- index.html JS:
- index.html CSS:

浏览器验收：
- 学习中控台:
- 今日学习路线:
- 导航栏滚动/平板:
- 408知识图谱:
- 今日提分:
```
