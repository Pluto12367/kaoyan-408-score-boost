# 前端重构项目结构审计

审计日期：2026-08-31  
审计分支：`feature/v3-product-refactor`  
实际 HEAD：`a0de9ee`

## 1. 本次修改总结

本次前端优化由以下已提交变更组成：

| 提交 | 内容 | 主要范围 |
| --- | --- | --- |
| `853bacd` | 登录体验重构 | AuthExperience、LoginHero、LoginCard、认证样式 |
| `7f3e6f0` | 注册与首次启动流程 | RegisterWizard、InitializationCore、WelcomeHero、OnboardingFlow |
| `b36e557` | Dashboard 重构 | StudentHome、Dashboard 组件、Dashboard view model |
| `aa89a2a` | 学生工作区视觉层接入 | StudentSections、学生工作区 CSS |
| `a0de9ee` | 页面视觉统一 | 错题、测试页面语义类与学生工作区 CSS |

当前工作区未提交内容仅包含已有冻结工作线文件：`AGENTS.md`、`ExamSession.tsx`、`PracticePanel.tsx`、主题文件以及两个主题测试文件。本次审计不将其视为本轮前端重构，也不建议暂存或提交。

## 2. Git 变更分析

### A. 合理修改

- `apps/web/src/features/auth/`：登录、注册和初始化体验按功能组织，认证 handler 仍由 `App.tsx` 提供。
- `apps/web/src/features/onboarding/`：首次用户体验使用前端临时 profile 和既有认证流程，没有新增后端字段。
- `apps/web/src/features/student/home/`：Dashboard 拆为 Hero、掌握度、今日任务、趋势、快捷入口等展示组件，并由 `useDashboardViewModel.ts` 整合已有 props。
- `apps/web/src/features/student/` 与 `features/mistakes/`、`features/test/`：页面视觉层通过局部类名和 CSS 接入，未改变学习动作回调。
- `apps/web/src/api/endpoints/`、hooks 和已有类型继续作为数据访问边界。

### B. 需要关注

- `apps/web/src/App.tsx` 仍是约千行级的单页编排入口，负责认证、资源加载、导航和大量 action callback。它是后续维护的主要复杂度来源。
- `features/student/home/useDashboardViewModel.ts` 的文件名像 React hook，但函数本身是纯 view model 组装器；未来可统一命名为 `buildDashboardViewModel` 或明确 hook 约定。
- Dashboard 趋势值由 `completedTaskCount * 24 + practiceCount * 8` 转为视觉柱高，当前文案是“练习活动”，不能解释为真实学习时长或后端趋势指标。
- 掌握度缺失时 view model 使用 `value: 0` 并配合 `unknown` 状态；若组件只显示环形数字，用户可能把“暂无数据”误解为 0%。
- `StudentLearningConsole.tsx` 已不再被生产组件引用，但仍被多个结构测试直接读取；暂不应删除，需要先完成测试和依赖迁移。

### C. 不应该纳入本次提交

- 后端、Prisma、migration、`packages/shared`：本轮没有修改。
- `PracticePanel.tsx`、`ExamSession.tsx`、主题文件和主题测试：当前有其他工作线修改，必须继续保持未提交。

## 3. 当前前端结构评价

### 目录结构

当前前端采用：

```text
apps/web/src
├── api/                 API client、按领域拆分的 endpoint、mock
├── components/          跨 feature 复用组件与旧兼容组件
├── features/            按认证、学生、测试、错题、知识、报告等领域组织
├── hooks/               认证、模块资源、学生数据和练习会话 hooks
├── layouts/             角色布局和导航
├── theme/               主题偏好实现
└── App.tsx              单页编排和状态协调入口
```

没有发现重复的 `services/`、`types/` 目录或临时目录。类型主要位于 `api/types.ts`、各 endpoint 文件和 `packages/shared`，符合当前项目的单页应用结构。

### 结构健康度

- **健康**：`features/` 已经承载大部分页面边界；Dashboard 新组件放在 `features/student/home/`，没有再创建平行的顶级 Dashboard 领域。
- **可维护性风险**：`App.tsx` 仍承担过多编排职责；`components/` 中同时存在新组件、旧兼容组件和页面级组件，边界需要长期收敛。
- **低风险重复**：`features/dashboard/` 与 `features/student/home/` 都包含学生概览相关组件，但前者主要是报告/画像组件，后者是首页组合，目前没有功能冲突。
- **样式风险**：全局 `styles.css`、主题文件、feature CSS 和本轮 `student-learning-experience.css` 并存；本轮新增样式使用学生工作区选择器，降低了污染范围，但 CSS 优先级和主题覆盖仍需持续监控。

## 4. UI 重构影响评估

| 领域 | 结论 |
| --- | --- |
| 登录 | 认证提交仍由 `App.tsx` 的 handler 负责，UI 组件只接收 props；未改变认证接口。 |
| 注册 | RegisterWizard 只收集并保存前端临时 profile，最终仍通过既有 onboarding/auth 流程。 |
| 导航 | 仍使用 `useRoleSectionNavigation`、hash 和 sessionStorage；没有引入路由库。 |
| 权限 | 继续由现有 `RoleNavigation`、`RoleGate` 和 App 分支控制；UI 重构未扩大权限。 |
| 数据获取 | 页面继续消费已有 hooks、ModuleResource 和 `api/endpoints`。 |
| Student State | 前端只读取 dashboard、mastery、today plan、wrong-question 和 learning calendar 数据，没有增加写链路。 |
| AI Coach | ContextualCoach 继续使用已有 API；Dashboard 的 `AIInsightCard` 是基于已有事实的前端 insight，不应被理解为新增 AI 请求。 |

总体判断：UI 层和数据/业务层基本分离，重构没有改变核心学习闭环。但 `App.tsx` 仍是主要耦合点，后续新增功能应优先通过现有 feature props 和 query hooks 接入。

## 5. 数据流检查

### 当前数据路径

```text
API client / endpoint
        ↓
hooks / ModuleResource
        ↓
App.tsx 资源编排
        ↓
StudentSections / KnowledgeCatalog
        ↓
StudentHome / 页面组件 / view model
```

关键事实来源保持不变：

- `mastery`：已有 mastery-map / Student State 查询结果。
- `todayPlan`：已有 today plan 查询结果，任务完成仍走原有 action。
- `report`：已有 dashboard/report 数据。
- `wrongQuestion`：已有 wrong-question summary/list endpoint。
- `learningProgress`：已有学习日历、任务完成和练习数据。

审计未发现本轮新增业务 mock、绕过 endpoint 的业务表查询或新增 Student State 写入。发现的默认文案和空值显示属于 UI fallback；需要确保生产失败仍由既有 ModuleResource 错误状态显式展示。

## 6. 依赖检查

`apps/web/package.json` 当前依赖：

- React 18 + React DOM
- TypeScript
- Vite
- `framer-motion`
- `lucide-react`
- KaTeX
- `@kaoyan408/shared`

本次前端重构没有新增大型 UI 框架、Tailwind、shadcn、Radix 或 Recharts。`framer-motion` 用于登录、Onboarding 和 Dashboard 动画；`lucide-react` 用于图标。趋势图目前是轻量 CSS 柱状图，而不是 Recharts，优点是依赖少，缺点是后续若需要真实多指标趋势，应先定义指标契约再选图表库。

依赖结论：没有发现重复或明显不必要的新增依赖；当前构建依赖规模可控。

## 7. 后续开发兼容性

| 能力 | 兼容性 | 说明 |
| --- | --- | --- |
| AI Coach 集成 | 良好 | `ContextualCoach` 已是独立组件，调用新 endpoint，不写学习状态。 |
| Recommendation 展示 | 良好 | Dashboard 和今日计划通过现有 props 展示结果，决策仍在后端。 |
| Knowledge Graph | 良好 | `KnowledgeCatalog`、`KnowledgeTree`、详情抽屉已有独立 feature 边界。 |
| 学习状态实时更新 | 中等 | action 后由 App 刷新多个资源；资源协调集中在 App，规模扩大后维护成本高。 |
| 个性化 Dashboard | 良好 | `useDashboardViewModel` 已提供展示层适配点，但指标命名和空值语义需要继续收紧。 |

## 8. 风险和技术债务

| 等级 | 风险 | 影响 | 建议 |
| --- | --- | --- | --- |
| P1 | `App.tsx` 仍是大型状态/编排中心 | 新页面容易继续增加耦合和回归 | 后续以 query/action hook 或 feature controller 做增量拆分，不做大规模重写。 |
| P1 | 当前全量 node:test 在 Windows worker 环境触发 `spawn EPERM` | 无法用一次全量命令完成稳定回归 | 在具备正常子进程权限的 CI/Linux 环境执行全量测试。 |
| P2 | `StudentLearningConsole.tsx` 生产未引用但测试仍依赖 | 贸然清理会破坏测试契约 | 先迁移测试和引用，再删除。 |
| P2 | Dashboard 活动柱高是展示映射，不是真实时长 | 可能造成指标误读 | 保持“练习活动”文案，未来接入真实时间字段后再改指标。 |
| P2 | 暂无掌握度显示为 0 的视觉歧义 | 用户可能误认为完全不会 | 未来让 unknown 状态显示 `--` 或“暂无记录”，不使用 0 环形进度。 |
| P2 | `docs/current-sprint.md` 的 HEAD 仍记录 `0613efe` | 接手 Agent 可能误判代码状态 | 下一次文档收口时同步为实际 HEAD，并记录本轮 UI 提交。 |
| P3 | CSS 来源较多，主题覆盖顺序复杂 | 后续主题调整可能改变页面外观 | 新样式继续限制在 feature scope，避免新增全局选择器。 |

## 9. 测试和质量检查

### 已执行命令

| 命令 | 结果 |
| --- | --- |
| `npm run build` | 失败：根 `package.json` 没有 `build` script。正确命令是 `npm run build:web`。 |
| `npm run build:web` | 通过；shared TypeScript、web TypeScript 和 Vite 构建均通过。仅有既有动态 import 和 chunk 大小警告。 |
| `npm test` | 本次执行被 Node `node:test` worker 的 Windows `spawn EPERM` 阻断，结果为 222 个测试文件启动失败，0 个业务断言完成；不是业务断言失败。此前提升权限回归得到 1096 通过、4 个既有基线断言不一致、1 个跳过。 |
| `node test/onboarding-flow.test.js` | 4/4 通过。 |
| `node test/contextual-coach-ui.test.js` | 4/4 通过。 |
| `git diff --check` | 通过；仅报告 Windows LF/CRLF 提示。 |

当前没有配置 lint script 或 lint 配置；本审计未引入 lint。

## 10. 后续开发建议

1. 先同步 `docs/current-sprint.md` 的实际 HEAD 和前端重构提交记录，避免状态文档继续落后。
2. 新页面继续遵循 `features/<domain>` 组织，展示组件只接收 view model/props，不在组件内新增数据请求。
3. 后续增加 Dashboard 指标时，先定义事实来源、空值语义和单位，再实现 view model，避免视觉指标与业务指标混淆。
4. 将 App 中按领域聚合的资源刷新逐步抽到 hooks 或 feature actions；每次只迁移一个资源域并增加回归测试。
5. 解决 CI/服务器上的 Node worker 权限问题后，再将完整 `npm test` 作为发布门禁。
6. 不要删除 `StudentLearningConsole.tsx` 或修改冻结工作线文件，除非另立任务并完成影响审查。

## 结论

当前前端结构总体健康，核心 UI 重构没有改变认证、导航、权限、API 数据流或 Student State 写链路。可继续进行后续前端迭代，但不建议在全量测试的 `spawn EPERM` 尚未解决、状态文档未同步、`App.tsx` 耦合仍较高的情况下宣称项目已经完全收口。

本次审计只新增本文件，未修改业务代码、主题文件、后端、数据库或共享包。
