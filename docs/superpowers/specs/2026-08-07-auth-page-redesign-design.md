# 登录注册页视觉优化设计（auth-page-redesign）

> 日期：2026-08-07
> 范围：前端登录/注册页（auth gate）视觉与信息架构优化，纯展示层改动
> 发布目标：优化后经现有发布链路（commit → push → 服务器 `git pull` + `deploy.sh`）上线到
> `http://43.128.30.191/`，外部访客打开网址即可看到新登录页

## 1. 背景与目标

当前登录注册页（`auth-shell-redesign`）已有基础暗色设计：深蓝渐变背景、左侧深色玻璃品牌区
（408 徽章、标题、说明、4 个能力标签）、右侧白色表单卡。用户希望进一步优化，目标按重要度排序：

1. 更专业 / 更有质感
2. 更简洁清晰
3. 更强的注册引导

经确认采用**方案 A：深色科技风·精致化**——在现有暗色主题上做打磨升级，不推翻重来。

## 2. 现状（依据代码）

- `apps/web/src/App.tsx`：auth gate 返回 `<main className="app-shell auth-shell auth-shell-redesign">`，
  内含 `.auth-gate`（双栏）：`.auth-brand`（品牌区）+ `<AccountPanel>`（表单卡）。
- `AccountPanel.tsx`：登录/注册表单、演示身份按钮、退出登录；字段 `name` 与提交逻辑保持不变。
- `styles.css`：`.auth-shell` / `.auth-gate` / `.auth-brand` / `.auth-orb` / `.auth-feature-grid` /
  `.auth-role-copy` / `.auth-shell-redesign` 等样式；已建立设计 token（`--primary`、`--teal`、`--slate-900` 等）。
- 测试契约（不可破坏）：
  - `auth-gate-ui.test.js`：App.tsx 须含 `const shouldShowAuthGate`、`if (shouldShowAuthGate)`、
    `<RoleNavigation ... />` 行；styles 中 `.auth-shell { grid-template-columns: 1fr; }` 与
    `.auth-gate { grid-column: 1 / -1; }`。
  - `ux-redesign-ui.test.js`：App.tsx 须含 `auth-feature-grid`、`学生 / 教师 / 管理员`；
    styles 须含 `auth-shell-redesign`、`auth-orb`。
  - `account-management-ui.test.js`：AccountPanel 须含 `name="inviteCode"`、邀请码/注册相关文案。

## 3. 设计

### 3.1 页面结构（桌面 1120px 双栏，保持现有布局骨架）

左栏·品牌区（`.auth-brand`，深色玻璃质感升级）：

- 顶部品牌行：升级版 408 徽章（`.auth-orb`，渐变 + 外发光 + 细边框）+ 品牌名「408 SCORE BOOST」
- 主标题「计算机考研 408 提分系统」（字号保持现有 `clamp`）
- 一句话说明（保留现文案，收紧间距）
- 4 个能力标签改为带小图标的紧凑胶囊行：题库训练 / 错题复盘 / 学情分析 / AI 辅助
  （保留 `.auth-feature-grid` 类名，内部样式改为胶囊 + 图标；图标复用 lucide-react，如
  `BookOpenCheck`、`ShieldCheck`、`LineChart`、`Brain`）
- 底部角色文案「学生 / 教师 / 管理员 均可进入对应工作台」（保留 `.auth-role-copy`）
- 背景：深蓝渐变 + 细网格纹理 + 顶部光晕（纯 CSS，不新增图片资源）

右栏·表单卡（`.auth-gate .role-panel`，结构微调）：

- 顶部新增**「登录 / 注册」分段切换**：替换现有「注册账号」次按钮为分段控件
  （登录模式高亮「登录」，注册模式高亮「注册」）；分段切换复用 `authMode` 状态，
  调用现有 `onToggleMode`，不改数据流
- 登录模式：邮箱 + 密码 + 主按钮「登录」+ 下方「注册新账号」次级按钮
- 注册模式：邀请码（带内联提示“联系管理员获取邀请码”）+ 姓名 + 邮箱 + 密码 + 确认密码 +
  主按钮「创建学生账号」
- 底部保留状态反馈区（`authStatus` 文本）

### 3.2 配色与质感

- 沿用现有 token：`--primary`（蓝）、`--teal`（青）、`--slate-900`（深蓝），不引入新色系
- 质感实现全部用 CSS：线性/径向渐变、`box-shadow` 光晕、`border` 细边框、背景网格线
- 徽章：渐变加强 + 外发光 + 细边框，保持 132px 方块圆角风格（尺寸可微调至更精致）

### 3.3 简洁原则

- 品牌区间距收紧（`gap` 16px → 12-14px），能力标签高度降低
- 表单卡字段间距统一，主/次按钮层级分明（沿用 Phase 2 的 `primary-action` / `secondary-action`）
- 删除无信息量的装饰，保持一屏内完整呈现

### 3.4 注册引导

- 分段切换默认「登录」；登录模式下「注册新账号」入口为次级按钮，位置显眼但不喧宾夺主
- 注册模式邀请码字段下方给出内联提示
- 登录成功/失败的状态文本位置固定，避免布局跳动

### 3.5 移动端（≤720px）

- 单栏：品牌区压缩为顶部徽章 + 标题 + 一句说明（能力标签可横向滚动或隐藏次要装饰）
- 表单卡紧随其后；分段切换保持可用
- 底部导航/表单不被遮挡

## 4. 不改动的部分（约束）

- 登录/注册/改密/登出逻辑、字段 `name`、后端接口、数据模型：全部不动
- 演示身份按钮（`showDemoRoles`）逻辑不变（DEV/静态演示模式才显示）
- 不新增依赖（图标用已安装的 lucide-react）
- 保留测试契约类名与文案（见第 2 节）

## 5. 验收

1. `npm run build:web` 通过（类型检查 + 构建）
2. `npm test` 全绿（328 通过 / 0 失败 / 1 跳过既有项）
3. 无头浏览器验证（本地 dev）：
   - 登录页渲染、登录/注册分段切换可用、字段与提交正常
   - 移动端视口（≤720px）单栏布局正常
4. 云端部署后（commit → push → 服务器 `git pull` + `deploy.sh`）：
   - `http://43.128.30.191/` 显示新登录页并截图确认
   - 学生/管理员账号登录正常

## 6. 范围外（不做）

- 不改注册/登录业务规则（邀请码校验、密码策略等）
- 不新增首页/工作台视觉改动（仅登录注册页）
- 不引入深色/浅色主题切换

## 7. 增量：登录页文案与抽象科技背景（2026-08-07 追加，用户确认方案 A）

在已上线的方案 A 基础上追加文案与背景图（纯 CSS，不引入图片文件）：

### 7.1 文案（优先级 1 > 2 > 4 > 3）

1. 主标题下新增 `.auth-tagline`：「从入学诊断到模拟考试，四科薄弱点一清二楚」
2. 能力标签改为两行卡（图标+名称+说明小字）：
   - 题库训练 → 按薄弱点精准组题
   - 错题复盘 → 错因分类，变式重练
   - 学情分析 → 四科掌握度实时可视化
   - AI 辅助 → 四层提示拆解解题思路
3. 注册模式表单上方新增 `.auth-register-guide`：
   「三步开始提分：填写邀请码 → 创建账号 → 完成入学诊断」
4. 角色文案下方新增 `.auth-trust`：「面向计算机考研 408 考生的个性化提分系统」

### 7.2 背景（A 抽象科技风）

- `.auth-shell-redesign` 背景在现有深蓝渐变上叠加：细点阵 + 网格线 + 大光斑 + 右上角青色光晕
- 能力标签卡片圆角由胶囊（999px）改为 14px 两行卡
- 移动端能力标签保持 2 列

### 7.3 测试同步

- 更新 `test/auth-page-redesign.test.js`：能力标签结构断言改为两行卡；新增
  `.auth-tagline`、`.auth-trust`、`.auth-register-guide`、标签说明小字断言
