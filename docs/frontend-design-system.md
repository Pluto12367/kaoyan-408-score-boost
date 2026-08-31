# 408 OS Design System

版本：v1.0（Phase 1）

## Brand

定位：AI-powered Computer Science Learning OS

关键词：

- Intelligent：让学习状态和下一步行动清晰可见
- Personal：围绕当前学生状态组织内容
- Focus：每个页面只突出一个主要学习目标
- Growth：用可验证的进步反馈替代装饰性数据

设计原则：界面表达产品判断，但不在展示层重新计算学习事实。Student State、已有 API 和推荐结果仍然是页面数据的事实来源。

## Color Token

优先使用 `apps/web/src/styles.css` 中已有的语义变量。主题由 `html[data-theme]` 和现有主题文件覆盖，组件不得直接依赖某个主题的十六进制颜色。

| 语义角色 | 现有 token | 使用场景 |
|---|---|---|
| Primary | `--primary` / `--primary-hover` | 主按钮、当前导航、关键行动 |
| Secondary | `--teal` / `--teal-soft` | 辅助状态、学习反馈、次要强调 |
| AI Accent | `--primary` / `--primary-soft` | AI Coach、洞察、上下文提示；不新增独立品牌色 |
| Background | `--bg` / `--surface-soft` | 页面背景、弱层级背景 |
| Surface | `--surface` / `--surface-soft-2` | 卡片、抽屉、内容容器 |
| Text | `--text` / `--text-strong` / `--text-body` | 主标题、正文、强调文字 |
| Border | `--line` / `--line-faint` / `--line-strong` | 分隔线、输入框、焦点附近的结构边界 |
| Success | `--green` / `--green-soft` | 完成、已掌握、成功反馈 |
| Warning | `--amber` / `--amber-soft` | 待复习、注意、低置信度 |
| Danger | `--red` / `--red-soft` | 错误、失败、需要处理 |

规则：新页面优先使用语义 token；只有在已有主题 token 无法表达时，才新增语义变量，并先说明兼容性。禁止在组件中硬编码主题色。

## Typography

字体沿用全局 `Inter, "Microsoft YaHei", "PingFang SC", sans-serif`。

| 层级 | 建议字号/权重 | 使用场景 |
|---|---|---|
| Display | 30px 及以上，700 | 页面级 Hero、首次进入体验 |
| Heading | `--text-h2` 至 `--text-h4`，600-700 | 页面标题、区块标题、卡片标题 |
| Body | 14-16px，400-500 | 解释、任务、表单内容 |
| Caption | 12-13px，400-600 | 辅助说明、来源、时间、状态 |

正文行高保持 1.5-1.7；紧凑控件不使用 Hero 级字号。字距保持默认，不使用负 letter-spacing。

## Spacing

基础间距采用 4px 网格：

| Token 级别 | 值 | 使用场景 |
|---|---:|---|
| XS | 4px | 图标与文字、标签内部 |
| SM | 8px | 控件内部、紧凑列表 |
| MD | 12px | 表单字段、列表行 |
| LG | 16px | 卡片内边距、区块间距 |
| XL | 24px | 主要卡片、页面区块 |
| 2XL | 32px | 页面留白、Hero 内容 |

组件内部优先使用上述阶梯，不为单个页面创造新的间距尺度。

## Radius

复用现有变量：

- Small：`--radius-sm`，6px
- Medium：`--radius` 或 `--radius-lg`，8-12px
- Large：`--radius-xl`，14px
- XL：`--radius-2xl`，18px

基础控件使用 Small/Medium；卡片使用 Large；重点玻璃容器最多使用 XL。避免嵌套卡片造成视觉层级过深。

## Shadow

- Card：`--shadow-card`，普通内容卡片和 SurfaceCard
- Floating：`--shadow-strong`，抽屉、弹层、需要脱离页面流的容器
- AI Glow：以 `--primary` 和 `--primary-soft` 为语义来源，限定在 AI Coach 或重点洞察区域；不得在每个组件中单独写一套颜色阴影

阴影用于表达层级，不用于替代边界或制造装饰性噪声。

## Components

Phase 1 只实现高复用、无业务状态的基础原语，位置为 `apps/web/src/components/ui/`。

### GlassCard

- 用途：需要轻量玻璃质感的重点内容容器
- Props：标准 `HTMLDivElement` 属性、`tone?: 'default' | 'accent'`
- 使用场景：AI 洞察、首页 Hero、上下文提示
- 约束：只负责容器视觉，不读取数据、不发请求

### SurfaceCard

- 用途：稳定的普通内容容器
- Props：标准 `HTMLDivElement` 属性、`tone?: 'default' | 'subtle'`
- 使用场景：知识节点、复习项目、任务组
- 约束：作为页面内容边界，不承载业务判断

### ProgressRing

- 用途：表达已有数据中的进度或掌握度
- Props：`value: number | null`、`label?`、`size?`、`strokeWidth?`、`tone?`
- 使用场景：Student State、学习进度、完成度
- 约束：`null` 显示未知状态；组件不计算掌握度，只展示传入事实；使用 `progressbar` 语义

### EmptyState

- 用途：表达空数据、未初始化或等待用户行动
- Props：`title`、`description?`、`icon?`、`action?` 及标准 div 属性
- 使用场景：无今日任务、无错题、知识数据尚未同步
- 约束：不填充演示业务数据；通过 `role="status"` 让状态可被辅助技术感知

后续规划中的 `GradientButton`、`IconButton`、`Badge` 暂不实现，等出现两个以上真实页面复用需求后再加入。

## Page Patterns

### Learning Cockpit

页面顺序：状态摘要 → 今日主要行动 → 解释性洞察 → 次级入口。Dashboard 使用现有 view model 组装数据，展示组件不重新请求接口。

### Knowledge Exploration

页面顺序：知识地图 → 节点状态 → 学习证据 → 下一步行动。掌握度来自既有 `masteryMap`，不由组件推导事实。

### Recovery Workspace

页面顺序：薄弱点/遗忘风险 → 复习任务 → 错因证据 → 重做或变式练习。复习动作继续复用现有业务接口。

### Contextual Coaching

AI Coach 是解释层：读取上下文并给出解释、提醒和建议；不创建任务、不修改掌握度、不替代 Recommendation Engine。

## Animation

基于现有 Framer Motion：

- Page Enter：`opacity` + 轻微 `translateY/X`，短时长
- Card Stagger：同组卡片按顺序淡入，避免所有元素同时跳动
- Hover Lift：最多轻微上移，不能改变布局尺寸
- Loading：使用明确的加载状态，减少装饰性循环动画
- Reduced Motion：尊重 `prefers-reduced-motion`，关闭位移和不必要过渡

基础原语只包含必要的状态过渡；页面级动画由页面组件负责。

## Architecture Rules

- UI 原语不调用 API、不修改 Student State、不创建 StudyPlan 或 StudyTask。
- 数据请求继续位于 `api/endpoints` 和 hooks；页面通过 props 传入展示数据。
- 主题继续由现有主题系统负责；本阶段不修改主题在途文件。
- 新原语先在新页面使用，旧页面采用增量迁移，避免大规模 CSS 重写。
