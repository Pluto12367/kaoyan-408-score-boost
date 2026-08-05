# 内置题库（starter-320）入库手册

> 目的：把 `kaoyan-408-content-starter` 的 320 道自编题正式导入某个环境（本地 / 预发 / 生产），并验证提分闭环可用。本手册是 P1-4（内容正式入库）的流程固化，自动化验证见第 9 节。

## 1. 内容与前置条件

- 内容文件：`kaoyan-408-content-starter/imports/starter-320-questions.csv`（320 行，16 个知识点）
- 导入脚本：`scripts/import-questions.mjs`（校验 + 幂等导入 + 知识点种子）
- 前置条件：
  1. 依赖已安装（`npm ci` 或已有 `node_modules`）；
  2. 已构建共享包：`npm run build:shared`（脚本依赖 `@kaoyan408/shared` 的指纹函数）；
  3. 目标环境 PostgreSQL 可达，`DATABASE_URL` 指向目标库；
  4. **生产环境先备份**：`npm run db:backup` 并 `npm run db:backup:verify`。

## 2. 干跑（不连数据库）

```bash
npm run questions:import:dry-run
```

- 校验 CSV 全部 320 行（必填字段、选项数量、知识点、难度/题型、年份、用时）；
- 输出知识点分布统计；
- 不写数据库。

## 3. 正式导入（幂等）

Linux / macOS：

```bash
DATABASE_URL="postgresql://..." npm run questions:import
```

Windows PowerShell：

```powershell
$env:DATABASE_URL="postgresql://..."; npm run questions:import
```

期望输出：

```text
Validated 320 questions.
Import complete. created=320 updated=0 skipped=0
```

- **重复执行幂等**：第二次输出 `created=0 updated=0 skipped=320`（按 stem + source + year 去重，不产生重复题）。
- 改题后重导：加 `--replace` 会为已存在题目创建新版本（`isCurrent` 切换、保留旧版本），不会删除历史记录。

## 4. 导入后必须重启 API

题目与知识点目录在 API 启动时加载（P0-1 / P1-2 设计），**运行中导入后需重启 API 才生效**。

## 5. 验证提分闭环

1. `GET /questions`：返回 320 道，学生视图答案已脱敏；
2. `GET /knowledge-points`（登录后）：返回 16 个知识点（含 ds-list 等）；
3. `GET /practice-sets/recommended`：`questionCount > 0`；
4. `GET /assessments/stage`：`questions` 非空；
5. 学生答错一道导入题：错题本、掌握度地图、薄弱报告按该知识点正确命名展示。

## 6. 腾讯云部署场景

- 服务器已 clone 仓库并执行过 `npm ci`；在项目根目录用 `.env.production` 中的 `DATABASE_URL` 按第 3 节导入；
- 导入后重启 app 容器：

```bash
docker compose --env-file .env.production -f compose.production.yml restart app
```

- **注意**：生产镜像未内置导入脚本（`Dockerfile` 只拷贝了验证脚本），请在服务器主机目录执行导入，不要在 app 容器内执行。

## 7. 内容质量门禁

- starter-320 为脚本生成的自编题，正式体验前建议按 `kaoyan-408-content-starter/docs/review-checklist.md` 抽样复核；
- 来源与版权约束见 `kaoyan-408-content-starter/docs/copyright-policy.md`；
- 新题入库优先走管理端文档导入（CSV/XLSX 模板 + 审核），见 `docs/admin/question-document-import.md`。

## 8. 回滚

- 题目表支持版本化（familyId + versionNumber + isCurrent），误导可用 `--replace` 覆盖，或由管理员将旧版本 `isCurrent` 置回；
- 生产回滚优先使用数据库备份恢复（`npm run db:restore`），不要手工删行。

## 9. 自动化验证

```bash
npm run db:test:up
npm run test:integration:content-import
npm run db:test:down
```

`test:integration:content-import` 在独立测试库 `kaoyan408_test_content` 中真实执行两次导入（验证幂等），随后启动 API 断言：题目目录 320 道、知识点 16 个、推荐题组与阶段测验非空。
