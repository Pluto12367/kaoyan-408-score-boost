# V10-2 Sprite UI — Final Report

> 状态：COMPLETE（含真实浏览器目检 + 真实后端端到端冒烟；未提交，等待所有者审查；V10-3 未启动，按惯例等待确认）
> 日期：2026-09-07
> 上游：`docs/v10-2-sprite-ui-design.md`（Phase A' 设计补编）、`docs/v10-sprite-product-constitution.md` §5.3/§6.1

---

## 1. 交付摘要

V10-2 交付精灵的前端呈现层：**悬浮球（9 态参数化 SVG 面孔）+ 展开面板（台词 + "依据"展开 + 一键行动 + 免打扰）**，学生角色常驻、考试/训练会话自动卸载、静态演示与拉取失败诚实隐藏。零新依赖（手绘 SVG + 既有 token），`sprite.css` 独立文件，零触碰受保护主题文件；App.tsx 挂载仅 4 行。

TDD：8 项 UI 契约测试先 RED（ENOENT/断言全红）后 GREEN。

## 2. 修改文件（精确清单）

| 文件 | 变更 | 内容 |
|---|---|---|
| `apps/web/src/features/sprite/spriteMood.ts` | 新增 | mood→视觉纯映射（face 9 型 / dot success·warning / motion breath·pulse 两档 / 中文标签；未知输入回退 idle），零依赖可沙箱测试 |
| `apps/web/src/features/sprite/useSpriteState.ts` | 新增 | `GET /sprite/state` 拉取 hook：isStaticDemoMode 门、`cancelled` 卸载守卫 + requestId 序号防过期、账号切换（accountKey）清态重拉、`daily-brief:refresh`/focus/visibilitychange 重算；免打扰偏好 localStorage `kaoyan408:sprite.muted` |
| `apps/web/src/features/sprite/SpriteWidget.tsx` | 新增 | 悬浮球（aria-expanded/aria-label、quiet 态）+ `role="dialog"` 面板（标题=名字+mood 标签、事实 detail、台词列表、每条"依据"展开 evidenceRefs 中文来源+detail、deep-link `location.hash` 行动、免打扰 `aria-pressed`）；Escape/点击外部/关闭钮关闭；参数化 SVG 面孔（currentColor） |
| `apps/web/src/features/sprite/sprite.css` | 新增 | 仅语义 token（零 hex/rgb）；`z-index: 60`；桌面右下 18px；`≤720px` 抬升 `calc(84px + env(safe-area-inset-bottom) + 8px)`；`prefers-reduced-motion` 关停动效；间距走 `--space-*` |
| `apps/web/src/App.tsx` | +4 行 | import + 学生角色 `&& !learningSessionType` 条件挂载 `<SpriteWidget accountKey={sessionUser?.id ?? null} />`（workspace 结束后、全屏考试层之前） |
| `DESIGN.md` | +8 行 | §4 新增"精灵组件"小节（挂载层级/z-index/token 纪律/透明→信任/静音持久化/ambient 失败先例） |
| `test/sprite-ui.test.js` | 新增 | 8 项测试：spriteMood 行为（沙箱）+ hook/widget/App/css 源码契约（hex=0、z 阶梯、移动端偏移、reduced-motion、a11y、诚实降级） |
| `docs/v10-2-sprite-ui-design.md` | 新增 | Phase A' 设计补编 |
| `docs/current-sprint.md` | 账本 | V10-2 完成条目 |

未触碰：styles.css、theme-optimizations.css、themePreference.ts、ExamSession.tsx、PracticePanel.tsx（受保护清单全部规避）；后端零改动。

## 3. 验证结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 定向 | `node --test test/sprite-ui.test.js` | **8/8 PASS**（先 RED 后 GREEN） |
| 全量 | `npm test` | **1951 / 1949 pass / 0 fail / 2 skipped**（V10-1 基线 1943/1941/0 + 本轮 8 项，零新增失败） |
| 构建 | `npm run build:web` | PASS（chunk 体积警告为应用级既有提示） |

## 4. 真实目检（dev 栈 + 浏览器，超出源码断言的验收）

本地 dev 栈（Vite 5174 + Nest 3000 + 本地 PostgreSQL）真实浏览器走查：

1. **诚实降级实证**：API 不可达时（IAB 网络沙箱无法访问宿主 loopback）精灵**完全不渲染**——ambient surface 规则真实生效，未出现错误横幅或假数据。
2. **面板渲染**（注入符合 V10-1 契约的 payload 后）：标题"星野 · 平和推进"、事实 detail、台词、`依据` 展开显示来源 pill（今日计划）+ 事实行（2/3 待完成）、`看今日任务` 主行动 chip、`免打扰` footer——全部符合宪法 §3/§5。
3. **四主题**：A 深色（面板=深色 `--surface` 证明 token 级联）/ B 极简 / C 标准 / D Notion 逐一截图，零破版、零主题特判。
4. **交互**：坐标点击 orb 开面板（aria-expanded=true）、点击面板外自动关闭（主题切换时实证）、Escape 关闭（expanded=false）、免打扰切换 → localStorage `kaoyan408:sprite.muted='1'`。
5. **375px 移动端**：orb 悬于底部导航上方（bottom 628 < 导航顶 ~660，含 safe-area 计算偏移）、面板宽 320 无横向溢出（docScrollW 360 ≤ 375）、触控目标 40px。
6. **端到端真实数据冒烟**：`ALLOW_DEMO_AUTH=true` 起 API，demo-login 换 token 后 `GET /sprite/state` 200——真实 dev 库上 mood ladder 命中 `concern/high_risk`（V4 风险层 study_inactivity），台词逐字复用干预 headline"学习中断（连续 0 天、近 7 天活跃 0 天），建议恢复节奏"，`unavailableSources:["today_plan"]` 真实记录了 demo 账号无今日计划的拉取失败——**诚实降级链路在生产语义下成立**。

## 5. 遗留风险与备注

1. IAB 截图对 fixed 合成层偶发 3s 超时/短暂不渲染——已用元素命中测试（elementFromPoint）+ 坐标点击双重实证非产品问题，属截图工具合成时序。
2. `免打扰` 在 V10-2 仅持久化偏好；消费它的主动弹泡频次闸在 V10-3（Companion Loop）实现。
3. 教师端等非学生角色不渲染精灵仅由挂载条件保证（源码断言），未逐一登录走查。
4. dev 栈已全部停止（3000/5174 无监听、孤儿进程已清、临时日志已删）；复现目检：`ALLOW_DEMO_AUTH=true npm run dev:api` + `npm run dev:web`。
5. 预存问题沿用 V10-1 报告 §5（集成脚本 review-scheduler 断言、V8/V9 债务），本轮无新增。

## 6. 开源参考方向

延续 V10-1（XState 守卫转移/游戏 FSM State 模式）；前端形态参考 Duolingo Duo 的"表情映射用户状态"（faces per mood）与仓库内 `ProactiveCoachCard`/`DailyBriefCard` 的 ambient 诚实先例（静默隐藏、事件驱动重算、listener 清理）。

## 7. 下一步（待所有者确认）

- **V10-3 Companion Loop**（MVP 收尾）：每日问候（brief/recovery 驱动的主动弹泡，自然日 ≤1 次 + 静音闸消费）、学习反馈（练习提交后 `daily-brief:refresh` 联动 mood 变化已有基础）、成就反馈（`bond.milestones` 填充：quest/ProgressStory 证据）、`sprite.*` 埋点进 events allowlist。
- MVP 全线（V10-0~V10-3）完成后可选：生产部署 + 冒烟（对齐 V9 部署 runbook）。
