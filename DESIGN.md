# DESIGN.md — 408 OS 设计规范

版本:v2.0(2026-09-07)。基线:`docs/frontend-design-system.md` v1.0,按 [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) 的 Stitch 九章节结构升级;全部 token 值提取自 `apps/web/src/styles.css` 与 `apps/web/src/theme-optimizations.css` 的当前代码。本文件是 AI 代理构建/修改页面的唯一视觉契约;AGENTS.md 定义"项目怎么构建",本文件定义"项目长什么样"。

## 1. 视觉主题与氛围

定位:AI-powered Computer Science Learning OS。关键词:Intelligent(状态与下一步清晰可见)、Personal(围绕当前学生状态组织)、Focus(每页只突出一个主要学习目标)、Growth(可验证的进步反馈,不展示装饰性数据)。

界面表达产品判断,但不在展示层重新计算学习事实;Student State、既有 API 与推荐结果是页面数据的唯一事实来源。

主题由 `html[data-theme]` 纯 token 级联实现(localStorage 持久化,`apps/web/src/theme/themePreference.ts` 注册),组件永远不依赖某一主题的具体色值:

| 主题 | 值 | 氛围 |
|---|---|---|
| A 深色(默认) | `a` | 深蓝黑科技感,学生端主视觉,高对比专注模式 |
| B 极简 | `b` | 近白扁平,无卡片阴影,最小圆角,内容优先 |
| C 标准 | `c`(`:root` 基线) | 浅灰蓝底 + 白卡 + 柔和投影,均衡的工作台 |
| D Notion | `d` | 白底 + 签名紫 CTA + 暖炭黑文字,平面细边卡片,阅读友好 |

## 2. 色板与角色

所有颜色只用下表语义 token(定义于 `styles.css` `:root` = C 基线,`html[data-theme="a"|"b"|"d"]` 逐主题覆盖)。组件与 TSX 中禁止出现硬编码 hex。

| 语义角色 | Token | C 标准 | A 深色(含优化补丁生效值) | B 极简 |
|---|---|---|---|---|
| 页面底色 | `--bg` | `#f6f7fb` | `#0b111c` | `#fbfcfd` |
| 卡片表面 | `--surface` | `#ffffff` | `#141d2e` | `#ffffff` |
| 柔和表面 | `--surface-soft` | `#f8fafc` | `#1c2a42` | `#f7f8fa` |
| 次柔和表面 | `--surface-soft-2` | `#f1f5f9` | `#1e2e48` | `#eef1f6` |
| 侧边栏深色面 | `--surface-sidebar` | `#111827` | `#0f1a2c` | `#0f172a` |
| 边框 | `--line` | `#e5e7eb` | `#2a3a55` | `#e7eaef` |
| 弱边框 | `--line-faint` | `#e2e8f0` | `#1c2940` | `#eef1f5` |
| 强边框/输入框 | `--line-strong` | `#d8dee8` | `#3d5178` | `#d9dee6` |
| 主文字 | `--text` | `#172033` | `#e8eefb` | `#0f172a` |
| 强调文字 | `--text-strong` | `#0f172a` | `#f4f7ff` | `#0b1220` |
| 正文文字 | `--text-body` | `#334155` | `#c3cfe2` | `#334155` |
| 次要文字 | `--text-secondary` | `#526176` | `#b8c6dc` | `#4b5563` |
| 弱化文字 | `--text-muted` | `#64748b` | `#9aa8c4` | `#6b7280` |
| 主色 | `--primary` | `#2563eb` | `#4f7dff` | `#1d4ed8` |
| 主色悬停 | `--primary-hover` | `#1d4ed8` | `#6b92ff` | `#1e40af` |
| 主色深(文字级) | `--primary-strong` | `#1e3a8a` | `#9db4ff` | `#1e40af` |
| 主色柔底 | `--primary-soft` | `#eef2ff` | `rgba(79,125,255,.14)` | `#eef2ff` |
| 主色极淡底 | `--primary-faint` | `#eff6ff` | `rgba(79,125,255,.10)` | `#f4f7ff` |
| 主色边框 | `--primary-line` | `#dbeafe` | `#2c3f6b` | `#dbe2f7` |
| 辅助色 | `--teal` / `--teal-soft` | `#0f766e` / `#f0fdfa` | `#2bbf9e` / `rgba(43,191,158,.13)` | `#0d9488` / `#e9f7f5` |
| 警告 | `--amber` / `--amber-strong` / `--amber-soft` | `#f59e0b` / `#d97706` / `#fffbeb` | `#e3a04c` / `#f3c987` / `rgba(227,160,76,.13)` | `#b45309` / `#92400e` / `#fdf1e3` |
| 成功 | `--green` / `--green-soft` / `--green-pill` / `--green-strong` | `#16a34a` / `#f0fdf4` / `#dcfce7` / `#166534` | `#3dd68c` / `rgba(61,214,140,.13)` / `rgba(61,214,140,.16)` / `#7ce0c8` | `#15803d` / `#eaf7ef` / `#dcfce7` / `#166534` |
| 危险 | `--red` / `--red-soft` | `#dc2626` / `#fef2f2` | `#ff6b6b` / `rgba(255,107,107,.12)` | `#dc2626` / `#fdeeee` |
| 信息 | `--info-soft` / `--info-strong` | `#e0f2fe` / `#075985` | `rgba(56,189,248,.14)` / `#7dd3fc` | `#e0f2fe` / `#075985` |

主题 D(Notion 风格)的色板见第 10 节。规则:新页面优先消费上表;只有语义 token 无法表达时才新增语义变量,且必须先说明兼容性。AI Coach/洞察的强调色复用 `--primary`,不引入第二品牌色。

## 3. 排版规则

字体栈(全局 `:root`,不引入外部字体):`Inter, "Microsoft YaHei", "PingFang SC", sans-serif`;代码/等宽用 `ui-monospace, Consolas, monospace`。

| 层级 | Token/值 | 字重 | 使用场景 |
|---|---|---|---|
| H1 | `--text-h1` 30px | 700 | 页面主标题(移动端经媒体查询缩小) |
| H2 | `--text-h2` 24px | 600-700 | 区块标题 |
| H3 | `--text-h3` 18px | 600 | 卡片标题、面板标题 |
| H4 | `--text-h4` 16px | 600 | 子标题、列表组头 |
| Body | 14-16px | 400-500 | 任务、表单、解释文字 |
| Caption | 12-13px | 400-600 | 来源、时间、状态、辅助说明 |

正文行高 1.5-1.7;字距保持默认,不用负 letter-spacing;紧凑控件不用 Hero 级字号。

## 4. 组件样式

### UI 原语(`apps/web/src/components/ui/`,纯展示、零业务状态、只消费语义 token)

| 原语 | 用途 | 关键 Props | 约束 |
|---|---|---|---|
| `GlassCard` | 轻玻璃质感重点容器(AI 洞察、Hero) | `tone?: 'default'\|'accent'` | 只负责容器视觉,不读数据、不发请求 |
| `SurfaceCard` | 稳定普通内容容器 | `tone?: 'default'\|'subtle'` | 作为内容边界,不承载业务判断 |
| `ProgressRing` | 进度/掌握度展示 | `value: number\|null`、`label?`、`size?`、`strokeWidth?`、`tone?` | `null` 显示未知态;不计算掌握度;`progressbar` 语义 |
| `EmptyState` | 空数据/未初始化 | `title`、`description?`、`icon?`、`action?` | 不填充演示数据;`role="status"` |

新原语(Button、Badge、Tabs 等)等出现两个以上真实页面复用需求再加入 `components/ui/`,并同步更新本文件。

### 全局元素状态(类名约定,样式在 `styles.css`)

- **按钮**:全局 `button` 基类 `border:0; border-radius: var(--radius-sm); font: inherit`,过渡 `background-color .15s / box-shadow .15s / transform .08s / color .15s`。主行动用 `--primary` 底 + 白字,悬停 `--primary-hover`;次级用 `--surface` 底 + `--line-strong` 边框。键盘焦点(WCAG 2.4.7):`button/input/select/textarea/[tabindex]:focus-visible` 统一 2px 焦点环。
- **输入框**:`background: var(--surface)` 或 `--surface-soft`,边框 `--line-strong`,聚焦切换为 `--primary` 边框 + 焦点环。
- **侧边栏导航**(`.sidebar`):深色面 `--surface-sidebar` + 浅色文字(三主题都保持深色侧边栏);当前项用 `--primary` 系表达。
- **主题切换器**(`.theme-switch`):药丸分段控件,`--surface-soft-2` 底、激活片 `--surface` + `--primary-strong` 文字 + 微阴影;按压 `scale(0.95)`。
- **弹层**(`OverlayDialog` 等):`--shadow-strong` 抬升,遮罩用半透明黑。
- **状态卡/降级**(`ModuleResourceState`/`ModuleUnavailable`/`EmptyState`):显式错误与空态,禁止静默回退演示数据(联动 AGENTS.md 第 4 条)。
- **真题对标组件**(`apps/web/src/features/practice/exam-aligned/`,LE-V10 F1):理由卡/覆盖报告只读消费 `examAlignment` 投影;星级与估算文案必须携带"估算"标记与依据;样式独立 `exam-aligned.css`,只用语义 token,零 hex。

### 精灵组件(`apps/web/src/features/sprite/`,V10 AI Learning Sprite)

- 悬浮球(`.sprite-fab`)固定右下,`z-index: 60`(高于底部导航 40、低于全屏层 1000+);≤720px 抬升至底部导航上方 `calc(84px + env(safe-area-inset-bottom))`。
- 视觉:参数化 SVG 面孔表达 9 态 mood;核心只复用 `--primary` 家族,状态点借用既有状态 token(`--green`/`--amber`),不引入第二品牌色;动效仅 breath/pulse 两档,`prefers-reduced-motion` 全局关停。
- 台词"依据"展开是"透明→信任"契约的一部分:每条台词必须可展开 evidenceRefs,禁止无依据鼓励。
- 静音偏好存 localStorage(`kaoyan408:sprite.muted`),不入库;精灵是 ambient surface,拉取失败静默隐藏自身(V9 `ProactiveCoachCard` 先例),API 级降级由后端台词诚实表达。
- 样式独立于 `sprite.css`,只消费语义 token;主题适配靠 token 级联,禁止主题特判类名。

## 5. 布局原则

- 间距基础 4px 网格,token:`--space-1` 4px / `--space-2` 8px / `--space-3` 12px / `--space-4` 16px / `--space-5` 24px / `--space-6` 32px(XS→2XL)。组件内部只用该阶梯,不为单页创造新间距。历史代码中的字面间距在触碰时渐进替换。
- 应用壳:`.app-shell` = 260px 固定侧边栏 + `minmax(0,1fr)` 主区;主区内 `header.topbar` + 内容容器。
- 页面模式(Learning Cockpit 顺序):状态摘要 → 今日主要行动 → 解释性洞察 → 次级入口;知识探索:地图 → 节点状态 → 学习证据 → 下一步;复盘工作台:薄弱点/遗忘风险 → 复习任务 → 错因证据 → 重做/变式。
- 双栏 `.two-column` 用于"主内容 + 上下文侧栏";AI Coach(`ContextualCoach`)是解释层,不创建任务、不修改掌握度。
- 卡片网格桌面 3 列 → 900px 以下 2 列 → 720px 以下 1 列;内容区留白用 `--space-5/6`。

## 6. 深度与立体

| Token | 用途 | 主题差异 |
|---|---|---|
| `--shadow-card` | 普通内容卡、SurfaceCard | C:`0 18px 46px rgb(15 23 42/6%)`;A:微高光 + 深投影;B:`none`(纯边框);D:近零(平面细边卡) |
| `--shadow-strong` | 弹层、抽屉、脱离页面流的容器 | C:`0 18px 48px 18%`;A/B/D 各按主题定义 |
| AI Glow | 以 `--primary`/`--primary-soft` 为来源的辉光 | 仅限 AI Coach / 重点洞察区域,不得每个组件自写彩色阴影 |

阴影表达层级,不替代边界、不制造装饰噪声;B/D 主题靠边框与表面色差分层,阴影仅留给浮层。

## 7. Do's and Don'ts

**Do**

- TSX/组件只用语义 token;新页面先查第 2 节色表再动手。
- 主题适配 = 在对应 `html[data-theme]` 块内覆盖 token(目标模式);`theme-optimizations.css` 的逐类名覆盖是历史债务,只许减少、不许新增。
- 间距/圆角/阴影/文字全部走 token 阶梯;动画基于 Framer Motion,短时长、轻微位移,尊重 `prefers-reduced-motion`(5761 行已有全局关停规则)。
- 数据请求留在 `api/endpoints` 与 hooks;页面通过 props 接收展示数据;API 失败显式展示错误。

**Don't**

- 禁止 TSX 硬编码 hex/rgb(当前基线为 0,保持)。
- 禁止在组件内依赖某个主题的具体色值或写死 `html[data-theme="a"] .某类名` 式覆盖。
- 禁止破坏 API 路由、响应结构、Prisma 模型兼容性(AGENTS.md 第 5 条)。
- 禁止静默回退 Mock/演示数据(AGENTS.md 第 4 条)。
- 禁止创建与核心提分闭环无关的新功能页面(AGENTS.md 第 3 条)。

## 8. 响应式行为

断点(来自现有 19 处媒体查询):**720px 为主移动断点**(出现最多),辅以 640px(紧凑卡/弹层)、780px(壳层微调)、900px(双栏→单栏、网格降列)、`721-900px` 区间特例;另有 `prefers-reduced-motion`。

- ≤900px:双栏布局折叠为单栏,卡片网格 3→2 列。
- ≤720px:侧边栏收起,学生端切换为底部导航(`StudentBottomNav`);H1 缩小;表单与操作面板转纵向堆叠;触控目标 ≥40px。
- ≤640px:弹层近全屏,紧凑列表单列。
- 全局:`overflow-y: auto` 的侧边栏与内容区;表格/代码块窄屏横向滚动而非截断。

## 9. 代理提示词指南

构建新页面时的即用提示词(可组合):

- 「按 DESIGN.md 用 A 主题 token 构建学习总览卡片区:SurfaceCard 容器、`--text-h3` 标题、`--space-4` 内边距、数据通过 props 传入,不新增 API 调用。」
- 「为错题复盘页新增筛选条:按钮用全局 button 基类 + `--primary`/`--line-strong` 两档,间距只用 `--space-*` 阶梯,≤720px 纵向堆叠。」
- 「这个卡片在 B/D 主题下阴影消失,确认边框 `--line` 与表面色差足以分层;若不足,调 token,不要写主题特判类名。」

快速校验清单:色值零硬编码 → 间距走阶梯 → 焦点环可见 → 三/四主题切换无破版 → 空态与错误显式 → `npm run build:web` + `npm test` 通过。

## 10. 主题 D · Notion 风格(`html[data-theme="d"]`)

参考 [awesome-design-md / notion DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/notion/DESIGN.md)(MIT),2026-09-07 经 `design/brand-previews/notion.html` 静态预览对比后由用户选定。要点:白底画布、签名紫只做 CTA、暖炭黑文字、平面细边卡片(`--shadow-card` 近零)、粉彩色仅用于状态容器底色。

| 语义角色 | Token 值(D) | 来源 |
|---|---|---|
| 页面底色 | `--bg: #ffffff` | Notion canvas |
| 表面 | `--surface: #ffffff` / `--surface-soft: #fafaf9` / `--surface-soft-2: #f6f5f4` | surface-soft / surface |
| 侧边栏 | `--surface-sidebar: #1a1a1a`(白字) | ink-deep 深色面 |
| 边框 | `--line: #e5e3df` / `--line-faint: #ede9e4` / `--line-strong: #c8c4be` | hairline 系 |
| 文字 | `--text: #1a1a1a` / `--text-strong: #000000` / `--text-body: #37352f` / `--text-secondary: #5d5b54` / `--text-muted: #787671` | ink/charcoal/slate/steel |
| 主色 | `--primary: #5645d4` / `--primary-hover: #6654de` / `--primary-strong: #3a2a99` / `--primary-soft: #f0edfd` / `--primary-faint: #f4f2fd` / `--primary-line: #ddd6f6` | 签名紫(#5645d4,按下 #4534b3 家族;hover 为同族推导) |
| 辅助 | `--teal: #2a9d99` / `--teal-soft: #e3f3f2` | Notion 青 |
| 警告 | `--amber: #dd5b00` / `--amber-strong: #793400` / `--amber-soft: #fdf1e3` | Notion 橙 |
| 成功 | `--green: #1aae39` / `--green-soft: #eaf6ec` / `--green-pill: #d9f3e1` / `--green-strong: #157a2c` | Notion 绿 / 薄荷粉彩 |
| 危险 | `--red: #e03131` / `--red-soft: #fdecec` | Notion 危险红 |
| 信息 | `--info-soft: #dcecfa` / `--info-strong: #0075de` | Notion 天蓝粉彩 / 链接蓝 |
| 圆角 | 6 / 8 / 10 / 12 / 14px(按钮 8px、卡片 12px,禁药丸按钮) | Notion 几何语言 |
| 阴影 | `--shadow-card: 0 1px 2px rgb(15 15 15 / 4%)` / `--shadow-strong: 0 16px 40px rgb(15 15 15 / 16%)` | 平面卡 + 浮层深阴影 |

已标注偏差:主色悬停 `#6654de` 与语义柔底/强色为 Notion 家族推导值(原规范只定义按下态 `#4534b3`);粉彩卡(`#ffe8d4`/`#fde0ec` 等)暂不进入全局 token,待出现真实复用场景再按第 4 节原语流程加入。
