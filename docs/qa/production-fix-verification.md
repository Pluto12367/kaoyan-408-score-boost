# Production Fix Verification — WrongQuestionDetail React #310

> 验证日期：2026-09-01
>
> 线上地址：http://43.128.30.191/
>
> 修复提交：`ac81e26 fix(web): resolve mistake detail hook mismatch`
>
> 关联报告：`docs/qa/2026-09-01-v3-full-test-summary.md`

## 1. Original Issue

线上"错题 → 详情与笔记"触发 `Minified React error #310`（Rendered fewer hooks than expected）：

- 错题列表正常加载
- 点击"详情与笔记"后页面内容消失，详情弹层不显示
- 变式练习入口同样受该错误影响（经由同一 `WrongQuestionDetailView` 渲染）
- 保存笔记流程被阻塞（弹层先崩溃）

## 2. Original Evidence

来自 `2026-09-01-v3-full-test-summary.md`：

- 本地修复回归测试 PASS（1/1），TypeScript 构建 PASS
- `ac81e26` 已 push（`origin/feature/v3-product-refactor == ac81e26`）
- 线上复测仍复现 #310，错误堆栈指向旧 chunk `MistakeWorkspace-BTRD8AwK.js`
- 当时判断：服务器 / Docker / gateway / 浏览器缓存仍在使用旧构建
- SSH 无法登录服务器：`Permission denied (publickey,password)`

## 3. Deployment Version

本次验证（2026-09-01 晚）发现线上已在修复提交后完成重新部署：

| 证据 | 内容 |
| --- | --- |
| 线上 `index.html` Last-Modified | `Tue, 01 Sep 2026 11:01:43 GMT`（北京 19:01:43），晚于 `ac81e26` 提交时间（18:50:47 +0800） |
| 线上入口 bundle | `index-CVIemIa1.js` |
| 线上错题 chunk | `MistakeWorkspace--QrJX8Ts.js`（已不再是旧的 `BTRD8AwK`） |
| 字节级对比 | 线上 `MistakeWorkspace--QrJX8Ts.js` 与本地纯净 `ac81e26` worktree 构建产物**归一化后逐字节一致**（`online === post-fix(ac81e26): true`），与修复前 `04e89a6` 构建不一致 |
| 代码结构证据 | 线上 chunk 中 `useMemo(evidenceSummary)` 位于 loading/error guard 之前：`...}):null},[n,i,h]);if(y)return ...加载失败...` |
| 旧资源 | `MistakeWorkspace-BTRD8AwK.js` 线上仍返回 200（部署未清理旧资源），这是此前浏览器缓存复现 #310 的直接原因 |

对比方法：`git worktree add --detach` 分别构建 `04e89a6`（修复前）与 `ac81e26`（修复后），与线上下载的 chunk 做归一化（去除互引文件名差异）全文比对。

结论：**线上错题模块运行的是包含 `ac81e26` 修复的构建**。报告发布时复现 #310 的浏览器加载的是缓存的旧 `index.html` → 旧 `BTRD8AwK` chunk。

部署卫生遗留观察项（不影响本结论）：

- 线上部分非错题小 chunk（如 `TodayPlan`）与纯净 `ac81e26` 构建尺寸不同，说明服务器仓库工作区可能带有未提交改动；`deploy/tencent-ip/deploy.sh` 直接基于服务器当前工作区 `docker compose up --build`，不做显式 `git checkout`。
- nginx（`deploy/tencent-ip/nginx.conf`）未配置 `Cache-Control`（`index.html` 无 `no-cache`），旧资源未清理时浏览器可能继续命中旧 `index.html`。

## 4. Root Cause

`WrongQuestionDetailView` 中 `useMemo(evidenceSummary)` 声明在 `if (error) return` 与 `if (!detail) return` 两个 early return 之后：

- 首次渲染（`detail === null`，loading 分支）不调用该 `useMemo`
- 数据返回后重新渲染调用该 `useMemo`
- 两次渲染 hook 数量不一致 → React #310（组件卸载/重渲染行为异常，详情弹层崩溃）

线上持续复现的第二层原因是**部署/缓存滞后**：修复提交后浏览器（或网关）仍加载旧 `index.html` 引用的旧 `MistakeWorkspace-BTRD8AwK.js`。

未发现第二个同类型 Hook mismatch：对 `apps/web/src` 全部 `.tsx` 做扫描并人工核对 `MistakeWorkspace`（已提交版与工作区版）、`ExamSession`、`ContextualCoach`、`TodayPlan`（扫描命中为辅助函数误报）。

## 5. Fix

`ac81e26`：将 `useMemo(evidenceSummary)` 上移到所有 guard 之前，memo 内部改为 `detail ? buildKnowledgeEvidenceSummary({...}) : null`，相关派生值改为可选链（`detail?.reviewSchedule` 等），渲染处改为 `evidenceSummary?.cards`。loading/error guard 下移到全部 hook 之后。

线上生效方式：修复提交后重新执行部署（服务器 `index.html` 时间戳晚于提交时间），前端资源切换为含修复的 `MistakeWorkspace--QrJX8Ts.js`。本次验证未改动任何业务代码。

## 6. Files Changed

修复提交 `ac81e26` 涉及文件（已在此前提交，本次会话无新增代码变更）：

- `apps/web/src/components/WrongQuestionDetail.tsx`（22 行修改：+11 / -11）
- `test/mistake-detail-hook-regression.test.js`（新增，16 行）

本次验证产生的诊断产物（非业务代码，可按需清理）：

- `var/scan-hook-order.mjs`、`var/compare-chunks.mjs`、`var/compare-structure.mjs`
- `var/online-index.html`、`var/online-entry.js`、`var/online-mistake-chunk.js`
- `.worktrees/ac81e26-verify/`、`.worktrees/04e89a6-verify/`（纯净构建对照用）

## 7. Regression Tests

| 测试 | 结果 | 说明 |
| --- | --- | --- |
| `test/mistake-detail-hook-regression.test.js` | PASS | 断言 `useMemo` 位于 error/loading guard 之前（此前已随 `ac81e26` 验证） |
| Wrong-question filter / review priority / catalog naming 等 | PASS | 见全量测试报告 |
| 本次会话代码变更 | 无 | 未改代码，无需重新执行 `npm test` / `build`；本地 `npm run build:web` 在纯净 worktree 中构建成功（用于对照），此前报告中的 Windows `spawn EPERM` 未再复现 |

## 8. Browser Verification

全新浏览器会话（无缓存，等效无痕）实测，登录账号：学生（1234@qq.com）。

| 场景 | 结果 | 截图 |
| --- | --- | --- |
| 登录 + 错题列表加载 | PASS | `var/02-after-login.png`、`var/03-wrong-book-list.png` |
| 详情与笔记：打开 | PASS（面板完整显示，无白屏） | `var/04-detail-panel-open.png` |
| 详情与笔记：关闭后再次打开 | PASS | `var/05-detail-second-open.png` |
| 变式练习入口 | PASS（正常进入变式答题界面，无崩溃） | `var/06-variant-practice.png` |
| 筛选（掌握状态/错因/清除） | PASS（请求 200，列表正常刷新） | `var/01-filter-mastery-reason.png` |
| 笔记保存 + 持久化 | PASS（`PATCH .../note` 200，重开后内容仍在） | `var/02-note-saved.png`、`var/03-note-persisted.png` |
| 原题重做跳转 | PASS（进入答题界面，未提交） | `var/04-redo-answer-screen.png` |
| 标记复盘 | SKIP（全部条目已是"已复盘"状态，按钮 disabled） | — |

## 9. Console Verification

- 全程（详情打开、二次打开、变式练习、筛选、笔记保存、重做跳转）Console **无任何 error**
- 未再出现 `Minified React error #310` 或其他 React 错误

## 10. Network Verification

- 无 4xx/5xx 失败请求
- 关键请求均 200：
  - `GET /api/wrong-questions`、`GET /api/wrong-questions/summary`、`GET /api/review/due`
  - `GET /api/wrong-questions/{id}/detail`、`GET /api/wrong-questions/{id}/exam-links`（两次、两个不同题目）
  - `PATCH /api/wrong-questions/q-003/note` → 200
  - 筛选：`GET /api/wrong-questions?masteryStatus=未掌握` 等 → 200
- 浏览器实际加载：`index-CVIemIa1.js` + `MistakeWorkspace--QrJX8Ts.js`（含修复的构建）

## 11. Remaining Issues

1. **科目筛选返回空列表（功能性偏差，非本次修复回归破坏）**：选"科目=计算机组成原理"时 `GET /api/wrong-questions?subject=计算机组成原理` 返回 200 但空列表，而列表中 12 条错题均为计算机组成原理科目。疑似前端传中文科目名、后端按科目代码（如 `COMPUTER_ORGANIZATION`）匹配。请求与 UI 均正常（无崩溃），与 `ac81e26` 无关，建议另开任务排查。
2. **部署卫生**：`deploy.sh` 不做显式 `git checkout`，服务器工作区可能带未提交改动（本次线上部分非错题 chunk 与纯净 `ac81e26` 构建存在差异）；建议部署流程固定到提交。
3. **缓存策略**：旧资源未清理且 `nginx.conf` 无 `Cache-Control`，历史上导致浏览器缓存旧 `index.html` 而复现 #310；建议为 `index.html` 加 `no-cache`（hashed assets 可长期缓存），并在新版本部署后提醒用户强刷。
4. **服务器侧确认仍受限**：本环境无 SSH 权限，服务器 `git rev-parse HEAD`、Docker 容器镜像版本、`/health` 未直接确认；已由线上静态资源字节级对比替代验证修复生效。

## 12. Final Verdict

```text
FIXED + VERIFIED ONLINE
```

- 修复代码已在本地提交、推送，并经回归测试验证
- 线上实际运行的错题 chunk 经字节级对比确认包含该修复
- 线上浏览器实测（无缓存会话）：详情打开/关闭/再打开、变式练习、笔记、重做全部正常，Console 零错误，Network 零失败
