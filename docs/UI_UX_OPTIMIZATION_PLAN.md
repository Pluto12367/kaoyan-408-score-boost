# UI/UX 优化计划（2026-08-07）

> 状态：已获用户认可，按阶段实施。当前进度：Phase 2 核心完成（2026-08-07）。
> 约束：零 API/数据结构变更；不新增运行时依赖；不做 3D / 复杂可视化 / 过度动画；
> 每次只处理一个明确任务，验证通过后再进入下一项。

## 1. 背景与目标

系统功能已基本完善，但存在两类体验问题：

1. **页面不好看**：分区页面过长、标题层级混乱、86 个硬编码颜色、无统一设计 token、
   单 JS 包 660KB（gzip 202KB）无代码分割。
2. **点击逻辑不好**：无 URL/浏览器历史（后退失效、无法深链）、学生端全部分区被
   `studentOverviewReady` 单一门禁阻塞、弹层无 Esc/返回键关闭、DEV 演示登录后工作区
   内嵌登录表单、操作反馈依赖零散文字。

目标：在不改后端与数据结构的前提下，用 4 个阶段完成交互修复、导航增强、视觉统一与
性能优化，每阶段可独立验证、可回滚。

## 2. 现状诊断（证据）

### 2.1 页面结构（DOM 审计，静态演示模式，1440x900）

| 页面 | 页面总高 | 说明 |
|---|---|---|
| 学生-提分报告 | 6091px（约 6.8 屏） | 8 个面板纵向堆叠，12 个 H3 + 10 个 H4 |
| 学生-首页（移动端 390px） | 4766px（5.6 屏） | 底部导航固定，内容极长 |
| 学生-首页（桌面） | 2231px（2.5 屏） | 8 个面板 |
| 管理端-数据看板 | 2753px | |
| 管理端-文档导入 | 2542px | |
| 教师端-题库与班级 | 1644px | |

### 2.2 样式与信息层级

- `apps/web/src/styles.css`：4492 行、86 个唯一 hex 颜色、仅 46 个 CSS 变量、11 个媒体查询，全局限定。
- 主强调色并存：蓝 #2563eb、青 #0f766e、琥珀 #f59e0b、绿 #16a34a。
- H1 与 H2 同为 24px；首页存在 42px 的 H3；H4 在 14/16/18px 间混用。
- 无横向溢出、无未命名按钮、无重复 id（基线良好）。

### 2.3 交互（代码验证）

- 导航为纯 React state（`features/navigation/useRoleSectionNavigation.ts`），无 URL、无 history。
- 学生端 plan/question/wrong-book/report/ai 全部被 `studentOverviewReady` 门禁
  （`App.tsx`），总览失败时全部显示同一张"学习总览"错误卡，与文案"其他模块仍可正常使用"矛盾。
- ExamSession / ExamReport / ErrorReasonSelector 无 Esc/返回键处理。
- AccountPanel 在 `!hasRefreshToken && !staticDemoMode` 时渲染登录表单
  （`features/auth/AccountPanel.tsx`），本地 DEV 演示登录后正文出现登录表单。

## 3. 阶段计划

### Phase 0：交互硬伤 + 高优视觉（约 2 人日）

| 任务 | 方案 | 涉及文件 | 验收 |
|---|---|---|---|
| 0.1 演示登录表单乱入 | 表单仅"未登录/需改密"时渲染 | `features/auth/AccountPanel.tsx`、`hooks/useAuth.ts` | DEV 演示登录后无内嵌表单 |
| 0.2 学生分区解耦总览门禁 | 分区级 ModuleUnavailable，按分区命名与重试；AI 区移除不必要阻塞 | `App.tsx` | 总览失败时各分区显示自身状态卡；AI 区不再被误伤 |
| 0.3 弹层键盘可达 | Esc 关闭 + 焦点收拢 | `components/ExamSession.tsx`、`ExamReport.tsx`、`ErrorReasonSelector.tsx` | Esc 可关闭 |
| 0.4 标题层级修正 | H1/H2/H3 字号归一 | `styles.css`、`features/onboarding/StudentLaunchpad.tsx` | 无 42px H3 |
| 0.5 首页瘦身 | 8 面板压至 4-5 个核心卡 | `StudentLaunchpad.tsx` | 首页 ≤ 2 屏 |

### Phase 1：导航与信息架构（约 2-3 人日）

- 轻量 URL hash 同步（扩展 `useRoleSectionNavigation`），三端分区有唯一地址，支持后退/深链/刷新保持。
- 顶部栏"生成阶段测评"收敛进首页卡片；跨区跳转保留并加来源面包屑。
- 不引入 react-router（保持零新依赖），后续拆分时再评估。

实施记录（2026-08-07）：
- 1.1/1.3 已完成：`useRoleSectionNavigation.ts` 以 `#/section` 为唯一地址（hash 优先、
  sessionStorage 兜底），`hashchange` 支持后退/前进，`replaceState` 避免首屏多历史条目；
  三端共用同一 hook，角色越权 hash 自动归一化。运行时验证：深链 `#/report` 直达、
  点击导航改 hash、history.back() 返回、非法 hash 归一回默认。
- 1.2 已完成（入口收敛）：顶栏"生成阶段测评"移除，改放阶段测评面板（其天然归属地，
  与原计划"首页卡片"略有差异）；跨区跳转来源面包屑暂缓，待 Phase 3 拆分时一并设计。
- 新增 `test/navigation-hash-sync.test.js` 覆盖 hash 解析、监听、归一化与入口收敛。

### Phase 2：设计系统与视觉统一（约 3-4 人日）

- `:root` 建立语义 token（色板/间距/圆角/阴影/字号 scale），先新增后替换 86 个硬编码色。
- 统一按钮/卡片/表单/徽章类；空态/加载态/错误态视觉规范化（复用 ModuleResourceState，补骨架屏）。
- 移动端固定底栏遮挡、卡片间距、字号适配。

实施记录（2026-08-07）：
- 2.1 已完成：`:root` 建立语义 token（surface/line/text/primary/teal/amber/green/red/slate、
  圆角、阴影、字号），并迁移公共外壳（sidebar/topbar/panel/metric/auth-brand/role-pill/
  tag-list/task-status/api-pill）；修复了此前引用但未定义的 `--line`/`--muted`。
- 2.2 已完成（关键修复）：发现 `primary-action` 被 17 处组件使用但样式从未定义（主按钮
  长期无背景裸样式），已补齐并统一 primary/secondary/icon 三类动作按钮（token 驱动、
  36px 基准、hover/disabled 态）；新增全局 `:focus-visible` 键盘焦点环（WCAG 2.4.7）；
  表单焦点环统一为 primary 色。
- 2.3 骨架屏：暂缓（现有 ModuleResourceState 加载态可接受，后续迭代补 skeleton）。
- 2.4 移动端：底栏遮挡 padding 已存在，首页移动端 2 列已在 0.5 完成；全量精修暂缓。
- 新增 `test/ui-design-tokens.test.js` 锁定 token 与按钮定义，防止主按钮样式再次缺失。

### Phase 3：页面密度与性能（约 3-5 人日）

- 报告页 6091px 重构为 Tab（总览/四科掌握度/测评历史/今日行动/资源与反馈）。
- 管理端看板、导入流程按步骤折叠。
- 按分区 `React.lazy` 代码分割，首屏 JS 目标下降 40%+。
- （需单独确认，对应 ROADMAP P2-3）拆分 1543 行 `App.tsx`。

## 4. 开源参考检查记录（Phase 0.2）

模式：分区级加载/错误隔离（不让单一数据源拖垮整站）。

- TanStack Query：query 必须 throw/reject 才进入 error 态，错误挂在 query 自身状态上（per-query isolation）。
- React Suspense + ErrorBoundary 配对（fusengine/agents、pproenca/dot-skills）：每个独立数据分区配
  自己的边界，单分区失败不影响其他分区；边界过高会拖慢/隐藏整个页面。
- Vite React 路由级代码分割（carbon starter、vite-react-best-practices）：`React.lazy` + Suspense 按页面拆包。

采用：沿用项目现有 `ModuleResource` 状态机做分区级状态卡，不引入新依赖。
不采用：为本次改动引入 react-query / error-boundary 库（超出范围，留待 Phase 3 评估）。

## 5. 验证链

- `npm run build:web`（类型检查 + 构建）
- `npm test`（先构建 shared，再跑 node:test）
- `npm run check:local`（本地全量）
- 人工走查：学生/教师/管理员三端全分区 + 移动端底部导航

## 6. 实施状态

- [x] 计划文档
- [x] Phase 0.1 演示登录表单乱入（AccountPanel：表单仅未登录时渲染；已登录用户恒有退出入口）
- [x] Phase 0.2 学生分区解耦总览门禁（App.tsx 分区级 ModuleUnavailable；移除整站统一错误卡；
  结构断言测试 p2-info-architecture.test.js 正则同步兼容新结构）
- [x] Phase 0.3 弹层键盘可达（新增 useOverlayDialog + OverlayDialog：Esc 关闭、焦点圈定、还原焦点；
  ExamSession 先关提交确认再保存退出；新增 ui-overlay-and-auth-panel.test.js 覆盖）
- [x] Phase 0.4 标题层级修正（styles.css 建立 --text-h1..h4 类型刻度；首页 hero H3 由
  clamp(28-42px) 归一为 clamp(22-28px)；stage/report/conclusion 等 H4 归一为 16px）
- [x] Phase 0.5 首页瘦身（压缩 workspace/panel 间距、KPI/动作/科目/周节奏卡片高度与内边距、
  趋势图高度；移动端 KPI/科目/focus 区改 2 列；实测桌面首页 2231px→1797px ≤2 屏，
  移动端 4766px→3142px）
- [x] Phase 1 导航与信息架构（hash 同步 + 入口收敛完成；来源面包屑暂缓）
- [x] Phase 2 设计系统与视觉统一（token 化 + 动作按钮补齐/统一 + focus-visible；
  骨架屏与移动端全量精修暂缓）
- [x] Phase 3.1 报告页 Tab 化（新增 ReportWorkspace + report-tabs；StudentProgressOverview
  支持 sections 切片复用；总览 699px / 四科掌握度 792px / 测评历史 878px /
  今日行动 1538px / 资源与反馈 1392px，报告页由堆叠 5827px 降为单 Tab ≤2 屏；
  在计划 4 个 Tab 基础上新增“今日行动”、将“错题与资源”更名为“资源与反馈”以匹配内容）
- [x] Phase 3.3 按分区 React.lazy 代码分割（学生/教师/管理端分区与考试弹层按需加载；
  首包 665.49KB→254.81KB、gzip 203.62KB→83.14KB，降幅约 60%；Suspense fallback
  复用 ModuleUnavailable 加载态；TeacherWorkspace/ExamSession/TodayPlan 等
  App.tsx 结构约束保持兼容；无头 Edge 冒烟：学生 6 区 + 教师 + 管理员全部通过）
- [x] Phase 3.3 附带修复：角色切换 hash 竞态（onRoleSwitch 改为 handleRoleSwitch
  完成后、新角色导航监听器挂载后再 resetSectionForRole，避免旧监听器把新 hash
  弹回上一分区，管理员切换曾停留“教研管理”而非“数据看板”）
- [x] Phase 3.2 管理端与导入流程折叠（管理端“可靠内测指标”折叠进原生 details，
  看板 1077px→708px；导入“导入队列”折叠为 details，有处理中批次时自动展开；
  折叠样式 token 化、键盘可达，question-import 与 admin 结构断言保持兼容）
- [x] Phase 3.4 拆分 App.tsx（新增 features/student/StudentSections.tsx 组合学生
  5 个分区与 lazy 代码分割；App.tsx 1592→1526 行，保留全部状态与练习/考试/
  教师/管理端接线；接线回调仍内联在 App 以保住 wiring 契约测试，仅 TutorPanel
  接线断言随迁 StudentSections；共享 sectionFallback 抽到 components/；账号面板
  保持全局可见（角色切换按钮对教师/管理员仍可用）；构建 + 328 测试 + 无头 Edge
  学生 6 区/教师/管理员冒烟全部通过）
