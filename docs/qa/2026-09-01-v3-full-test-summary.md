# 408 OS V3 全量测试报告汇总

> 测试日期：2026-09-01
>
> 线上地址：http://43.128.30.191/
>
> 测试账号：项目提供的测试账号

## 1. 测试范围

本报告汇总以下测试记录：

- Sprint 4 / Phase 5 本地构建与定向测试
- `ac81e26` WrongQuestionDetail React Hook #310 P1 修复验证
- 腾讯云线上页面导航与滚动巡检
- 已批准的高风险交互测试
- Contextual AI Coach 线上请求测试

测试重点是页面可用性、导航、数据加载、答题反馈、测评入口、训练入口、错题详情和控制台错误。

## 2. 本地 Git 与修复状态

P1 修复提交：

```text
ac81e26 fix(web): resolve mistake detail hook mismatch
```

提交仅包含：

- `apps/web/src/components/WrongQuestionDetail.tsx`
- `test/mistake-detail-hook-regression.test.js`

远端分支已推送到 `ac81e26`。主工作区其他 Theme、Knowledge Galaxy、Review Center、PracticePanel、ExamSession、文档和测试修改均未纳入该提交。

## 3. 本地验证结果

| 检查项 | 结果 | 备注 |
| --- | --- | --- |
| WrongQuestionDetail Hook 回归 | PASS 1/1 | 验证 Hook 位于 loading/error 分支之前 |
| Wrong-question filter | PASS 10/10 | 过滤与相关契约通过 |
| Wrong-review priority | PASS 3/3 | 复习优先级辅助逻辑通过 |
| Catalog naming wiring | PASS 4/4 | 知识点名称映射通过 |
| Student Action UI | PASS 35/35 | clean archive 中通过 |
| Training Room UI | PASS 6/6 | clean archive 中通过 |
| TypeScript | PASS | `build:web` 的 `tsc` 阶段通过 |
| `git show --check` | PASS | P1 提交无 whitespace 错误 |
| Vite/esbuild bundle | BLOCKED | Windows `spawn EPERM`，属于环境限制 |

## 4. 线上基础页面巡检

使用浏览器访问线上站点并检查首屏、滚动区域和主导航。

| 页面 | 加载 | 滚动内容 | 控制台 |
| --- | --- | --- | --- |
| Dashboard 首页 | PASS | PASS | 无错误 |
| 题库 | PASS | PASS | 无错误 |
| 知识 | PASS | PASS | 无错误 |
| 错题 | PASS | PASS | 详情操作触发 P1 |
| 测试/报告 | PASS | PASS | 无错误 |
| AI Coach | PASS | PASS | 无错误 |

已验证的只读交互包括：

- 顶部导航和学习路径导航
- 首页主题切换
- 知识科目切换、搜索、展开和收起
- 知识节点详情入口
- 测评报告 Tab：总览、四科掌握度、测评历史、今日行动、资源与反馈
- 错题筛选控件
- 各页面向下滚动后的内容和按钮
- AI Coach 页面加载

## 5. 已批准高风险交互

用户已明确批准执行可能产生测试数据的操作。

| 操作 | 结果 | 备注 |
| --- | --- | --- |
| 提交答案 | PASS | 自动判题、正确反馈、解析正常 |
| 下一题 | PASS | 题目推进正常 |
| 生成阶段测评 | PASS | 测评入口正常生成 |
| 开始阶段测评 | PASS | 显示作答进度并提示自动保存 |
| 生成并开始考试 | PASS | 40 题考试界面正常打开 |
| 保存并退出考试 | PASS | 对话框正常关闭 |
| 原题重做入口 | PASS | 正常跳转题库并显示重做提示 |
| 变式练习入口 | FAIL | 错题工作区触发 React #310 |
| 错题详情与笔记 | FAIL | 详情弹层无法打开 |
| 保存笔记 | BLOCKED | 详情弹层先崩溃，无法进入保存流程 |
| AI Coach 请求 | PASS | 返回 template fallback，无控制台错误 |

## 6. Contextual AI Coach

题目上下文 Coach 请求成功返回，前端正确显示后端状态：

```text
来源：contextual-coach-template
原因：provider_http_error
```

说明：AI provider 不可用时，fallback 展示正常，未发现错误静默或前端伪造状态。

## 7. 当前线上 P1

复现路径：

```text
错题
→ 详情与笔记
```

实际表现：

- 错题列表正常加载
- 点击详情后页面内容消失
- 详情弹层未显示
- 浏览器控制台出现 `Minified React error #310`
- 错误堆栈指向线上 `MistakeWorkspace-BTRD8AwK.js`

修复已在本地提交 `ac81e26`，但线上复测仍能复现，说明服务器实际运行的 Web 静态资源尚未确认切换到该修复构建。可能原因包括：

- deploy script 未完整执行
- Docker app 镜像未重新构建
- gateway 仍服务旧的静态资源
- 浏览器或网关缓存旧 bundle

## 8. 线上部署检查缺口

本地已成功推送 `ac81e26`，但当前执行环境无法 SSH 登录腾讯云：

```text
Permission denied (publickey,password)
```

因此以下项目尚未由本次测试确认：

- 服务器实际 HEAD
- Docker 容器实际镜像版本
- `deploy/tencent-ip/deploy.sh` 执行结果
- 生产数据库备份与 migration 状态
- `/health` 响应
- 服务器资源使用情况

## 9. 建议的服务器复核命令

```bash
cd ~/kaoyan-408-score-boost

git fetch origin feature/v3-product-refactor
git switch --detach ac81e26
git rev-parse HEAD
git status --short

docker compose --env-file .env.production \
  -f compose.production.yml ps

./deploy/tencent-ip/deploy.sh

docker compose --env-file .env.production \
  -f compose.production.yml logs --tail=200 app gateway

curl -fsS http://127.0.0.1/health
```

部署后应使用无痕窗口或 `Ctrl+F5` 重新验证：

```text
错题
→ 详情与笔记
→ 详情加载
→ 关闭
→ 再次打开
```

## 10. 测试结论

### 已通过

- 主页面和主导航可用
- 页面滚动区域可用
- 题库答题、反馈和下一题可用
- 阶段测评入口可用
- 模拟考试创建、进入和退出可用
- AI Coach fallback 展示可用
- 本地 P1 修复代码和回归测试通过

### 当前阻塞

- 线上错题详情仍触发 React #310
- 变式练习入口受同一错误影响
- 线上部署版本和静态资源版本尚未确认

### 未纳入本次修复

- 其他 V2 → V3 migration debt
- Windows Vite/esbuild `spawn EPERM`
- Theme、Knowledge Galaxy、Review Center 等未提交工作线

## 11. 最终状态

```text
Local P1 fix: PASS
Remote push: PASS
Online mistake detail: FAIL
Online React #310: PRESENT
Deployment verification: BLOCKED by SSH access
Overall release status: NOT VERIFIED
```

