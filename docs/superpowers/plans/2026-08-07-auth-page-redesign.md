# 登录注册页视觉优化（auth-page-redesign）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development（推荐）或
> superpowers:executing-plans 按任务执行本计划。步骤使用 `- [ ]` 复选框跟踪。

**Goal:** 按已批准设计文档，将登录/注册页（auth gate）升级为更专业、简洁、强注册引导的深色科技风，
并通过现有发布链路部署到云端 `http://43.128.30.191/`。

**Architecture:** 纯前端展示层改动：`App.tsx` 品牌区 JSX + `AccountPanel.tsx` 表单卡 + `styles.css`
样式，复用现有 authMode/onToggleMode 数据流与设计 token，不触碰后端与字段逻辑。

**Tech Stack:** React 18 + TypeScript、Vite、lucide-react（已安装）、node:test（源码断言测试）、
无头 Edge + CDP 验证。

## Global Constraints

- 保留测试契约：`auth-shell-redesign`、`auth-orb`、`auth-feature-grid`、`auth-role-copy`、
  `学生 / 教师 / 管理员` 文案、`name="inviteCode"`、邀请码相关文案，均不得删除。
- `auth-gate-ui.test.js` 依赖 `.auth-shell { grid-template-columns: 1fr; }` 与
  `.auth-gate { grid-column: 1 / -1; }` 样式规则，保留。
- 不修改登录/注册/改密逻辑、字段 `name`、后端接口、数据模型；不新增 npm 依赖。
- 图标仅使用仓库已用过的 lucide 图标：`BookOpenCheck`、`ShieldCheck`、`Target`、`Brain`。
- 验证门禁：`npm run build:web` 通过、`npm test` 全绿（328 通过 / 0 失败 / 1 跳过既有项）。
- Git 写操作（commit/push）属于用户已授权的发布流程。

---

### Task 1: 品牌区质感升级（App.tsx + styles.css + 测试）

**Files:**
- Modify: `apps/web/src/App.tsx`（auth gate 品牌区 JSX，位于 `shouldShowAuthGate` 返回块）
- Modify: `apps/web/src/styles.css`（`.auth-shell-redesign`、`.auth-orb`、`.auth-feature-grid` 区域）
- Create: `test/auth-page-redesign.test.js`

**Interfaces:**
- Consumes: 无（独立展示层）
- Produces: 品牌区新类名 `auth-brand-row`、能力标签内 lucide 图标；后续任务不依赖这些类名

- [ ] **Step 1: 写失败测试**

```js
// test/auth-page-redesign.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('auth brand row wraps the 408 orb with the product name', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /auth-brand-row/);
});

test('auth feature tags carry lucide icons and keep the feature grid class', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /auth-feature-grid/);
  assert.match(app, /<BookOpenCheck size=\{16\} \/>题库训练/);
  assert.match(app, /<ShieldCheck size=\{16\} \/>错题复盘/);
  assert.match(app, /<Target size=\{16\} \/>学情分析/);
  assert.match(app, /<Brain size=\{16\} \/>AI 辅助/);
});

test('styles upgrade the orb and feature tags', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /\.auth-orb \{[\s\S]*?box-shadow:[\s\S]*?rgb\(37 99 235/);
  assert.match(styles, /\.auth-feature-grid span \{[\s\S]*?border-radius:\s*999px/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/auth-page-redesign.test.js`
Expected: FAIL（`auth-brand-row` 与图标结构尚不存在）

- [ ] **Step 3: 实现品牌区 JSX**

在 `apps/web/src/App.tsx` 顶部 lucide 导入区（`RoleNavigation` 同源）新增：

```tsx
import { BookOpenCheck, Brain, ShieldCheck, Target } from 'lucide-react';
```

将 `shouldShowAuthGate` 返回块中的 `.auth-brand` 内容替换为：

```tsx
<div className="auth-brand">
  <div className="auth-brand-row">
    <span className="auth-orb" aria-hidden="true">408</span>
    <div>
      <p className="eyebrow">408 SCORE BOOST</p>
      <p className="auth-orb-caption">计算机考研 408 提分系统</p>
    </div>
  </div>
  <h1>计算机考研 408 提分系统</h1>
  <p>登录后同步学习计划、题库训练、错题复盘、学情分析和 AI 辅助，让备考路径更清楚。</p>
  <div className="auth-feature-grid" aria-label="系统能力">
    <span><BookOpenCheck size={16} />题库训练</span>
    <span><ShieldCheck size={16} />错题复盘</span>
    <span><Target size={16} />学情分析</span>
    <span><Brain size={16} />AI 辅助</span>
  </div>
  <p className="auth-role-copy">学生 / 教师 / 管理员均可进入对应工作台。</p>
</div>
```

注意：`学生 / 教师 / 管理员` 字符串保留（测试用正则 `/学生 \/ 教师 \/ 管理员/`，与原文案一致）。

- [ ] **Step 4: 实现样式**

在 `styles.css` 中 `auth-orb` 规则附近追加/替换：

```css
.auth-brand-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.auth-brand-row > div {
  display: grid;
  gap: 2px;
}

.auth-brand-row .eyebrow {
  margin: 0;
}

.auth-orb-caption {
  margin: 0;
  color: #bfdbfe;
  font-size: 13px;
  font-weight: 700;
}
```

升级 `.auth-orb`（保持类名）：

```css
.auth-orb {
  display: grid;
  width: 120px;
  height: 120px;
  place-items: center;
  border: 1px solid rgb(125 211 252 / 45%);
  border-radius: 32px;
  background:
    radial-gradient(circle at 32% 28%, rgb(255 255 255 / 26%), transparent 42%),
    linear-gradient(145deg, rgb(37 99 235 / 72%), rgb(13 148 136 / 46%));
  box-shadow: 0 0 0 1px rgb(56 189 248 / 18%), 0 24px 80px rgb(37 99 235 / 42%);
  color: #eff6ff;
  font-size: 38px;
  font-weight: 900;
}
```

能力标签改为胶囊（`.auth-feature-grid span` 替换现有规则）：

```css
.auth-feature-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}

.auth-feature-grid span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgb(191 219 254 / 20%);
  border-radius: 999px;
  padding: 8px 14px;
  background: rgb(255 255 255 / 9%);
  color: #eff6ff;
  font-size: 14px;
  font-weight: 700;
}

.auth-feature-grid span svg {
  color: #7dd3fc;
}
```

在 `.auth-shell-redesign` 背景上叠加细网格（追加规则，不删除渐变）：

```css
.auth-shell-redesign {
  background:
    linear-gradient(rgb(255 255 255 / 4%) 1px, transparent 1px),
    linear-gradient(90deg, rgb(255 255 255 / 4%) 1px, transparent 1px),
    radial-gradient(circle at 18% 20%, rgb(37 99 235 / 28%), transparent 30%),
    radial-gradient(circle at 76% 72%, rgb(20 184 166 / 20%), transparent 34%),
    linear-gradient(135deg, #061122 0%, #0f1f37 52%, #142845 100%);
  background-size: 44px 44px, 44px 44px, auto, auto, auto;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test test/auth-page-redesign.test.js`
Expected: PASS（3 个用例）

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css test/auth-page-redesign.test.js
git commit -m "feat(ui): auth gate brand area upgrade (orb glow, grid texture, icon tags)"
```

---

### Task 2: 表单卡登录/注册分段切换与注册引导（AccountPanel + styles + 测试）

**Files:**
- Modify: `apps/web/src/features/auth/AccountPanel.tsx`（表单卡结构）
- Modify: `apps/web/src/styles.css`（`.auth-mode-switch`、`.auth-invite-hint`、`.account-actions` 微调）
- Create: `test/auth-page-redesign.test.js`（追加用例）

**Interfaces:**
- Consumes: `props.authMode`、`props.onToggleMode`、`props.status`（现有 AccountPanel props，不变）
- Produces: 分段切换类名 `auth-mode-switch`、次级入口「注册新账号」、邀请码提示 `auth-invite-hint`

- [ ] **Step 1: 追加失败测试**

在 `test/auth-page-redesign.test.js` 追加：

```js
test('account panel exposes login/register segmented switch and invite hint', async () => {
  const panel = await source('apps/web/src/features/auth/AccountPanel.tsx');
  assert.match(panel, /auth-mode-switch/);
  assert.match(panel, /注册新账号/);
  assert.match(panel, /联系管理员获取邀请码/);
  assert.match(panel, /name="inviteCode"/);
});

test('styles define the segmented switch and invite hint', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /\.auth-mode-switch \{/);
  assert.match(styles, /\.auth-invite-hint \{/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/auth-page-redesign.test.js`
Expected: 新增 2 个用例 FAIL（结构尚不存在）

- [ ] **Step 3: 实现 AccountPanel 分段切换**

在 `AccountPanel.tsx` 的 `<section className="panel role-panel">` 内、`panel-heading` 之后追加：

```tsx
<div className="auth-mode-switch" role="tablist" aria-label="登录或注册">
  <button
    type="button"
    role="tab"
    aria-selected={props.authMode === 'login'}
    className={props.authMode === 'login' ? 'active' : ''}
    onClick={() => { if (props.authMode !== 'login') props.onToggleMode(); }}
  >登录</button>
  <button
    type="button"
    role="tab"
    aria-selected={props.authMode === 'register'}
    className={props.authMode === 'register' ? 'active' : ''}
    onClick={() => { if (props.authMode !== 'register') props.onToggleMode(); }}
  >注册</button>
</div>
```

移除原「注册账号 / 已有账号」切换按钮（`panel-actions` 中调用 `onToggleMode` 的那个
`secondary-action` 按钮），保留表单内提交按钮。登录模式下在表单 `</form>` 之后追加注册入口：

```tsx
{props.authMode === 'login' ? (
  <button type="button" className="secondary-action auth-register-link" onClick={props.onToggleMode}>
    注册新账号
  </button>
) : null}
```

注册模式邀请码字段（`name="inviteCode"` 的 `label` 之后）追加提示：

```tsx
<p className="auth-invite-hint">联系管理员获取邀请码</p>
```

约束：`name="inviteCode"`、`name="email"`、`name="password"`、`name="confirmPassword"`、
`name="name"` 字段与提交按钮文案（「创建学生账号」「登录」）保持不变。

- [ ] **Step 4: 实现样式**

在 `styles.css` 追加：

```css
.auth-mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  margin: 4px 0 16px;
  border-radius: var(--radius);
  background: var(--surface-soft-2);
}

.auth-mode-switch button {
  padding: 9px 12px;
  border-radius: calc(var(--radius) - 2px);
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 700;
}

.auth-mode-switch button.active,
.auth-mode-switch button[aria-selected="true"] {
  background: var(--surface);
  color: var(--primary-strong);
  box-shadow: 0 1px 2px rgb(15 23 42 / 10%);
}

.auth-invite-hint {
  margin: -6px 0 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.auth-register-link {
  width: 100%;
  margin-top: 10px;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test test/auth-page-redesign.test.js`
Expected: PASS（5 个用例）

- [ ] **Step 6: 回归既有测试**

Run: `node --test test/account-management-ui.test.js test/auth-gate-ui.test.js test/ux-redesign-ui.test.js`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/features/auth/AccountPanel.tsx apps/web/src/styles.css test/auth-page-redesign.test.js
git commit -m "feat(ui): login/register segmented switch and invite hint"
```

---

### Task 3: 移动端适配（styles.css + 测试）

**Files:**
- Modify: `apps/web/src/styles.css`（`@media (max-width: 720px)` 内追加）
- Create: `test/auth-page-redesign.test.js`（追加用例）

**Interfaces:**
- Consumes: Task 1/2 的类名 `auth-brand-row`、`auth-feature-grid`、`auth-mode-switch`
- Produces: 无新接口

- [ ] **Step 1: 追加失败测试**

```js
test('mobile styles stack the auth gate and keep the segmented switch usable', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.auth-brand-row \{[\s\S]*?flex-direction:\s*column/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.auth-feature-grid span \{[\s\S]*?flex:\s*1 1 calc\(50% - 10px\)/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/auth-page-redesign.test.js`
Expected: 新用例 FAIL

- [ ] **Step 3: 实现移动端样式**

在 `styles.css` 的 `@media (max-width: 720px)` 块（`.auth-shell`、`.auth-gate` 规则附近）追加：

```css
.auth-brand-row {
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.auth-orb {
  width: 88px;
  height: 88px;
  border-radius: 24px;
  font-size: 28px;
}

.auth-feature-grid span {
  flex: 1 1 calc(50% - 10px);
  justify-content: center;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/auth-page-redesign.test.js`
Expected: PASS（6 个用例）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/styles.css test/auth-page-redesign.test.js
git commit -m "feat(ui): responsive auth gate for mobile"
```

---

### Task 4: 全量验证、推送与云端验证

**Files:** 无新增（验证与发布）

**Interfaces:**
- Consumes: Task 1-3 全部改动
- Produces: 云端 `http://43.128.30.191/` 上线新登录页

- [ ] **Step 1: 本地全量构建与测试**

Run: `npm run build:web`
Expected: 类型检查 + 构建通过

Run: `npm test`
Expected: 329 个测试，328 通过 / 0 失败 / 1 跳过（既有项）

- [ ] **Step 2: 无头浏览器验证（本地 dev）**

Run: `npm run dev:web` + 无头 Edge 脚本
Expected: 登录页渲染（品牌行、图标标签、分段切换）、登录/注册切换可用、移动端视口（390px）
单栏正常

- [ ] **Step 3: 提交并推送**

```bash
git add -A
git commit -m "feat(ui): auth page redesign (professional dark theme, segmented auth switch)"
git push origin codex/deployment-ready
```

Expected: 远程 `origin/codex/deployment-ready` 更新

- [ ] **Step 4: 云端部署与验证**

服务器执行：`git pull origin codex/deployment-ready && ./deploy/tencent-ip/deploy.sh`

Expected: 部署成功；无头浏览器打开 `http://43.128.30.191/`，登录页出现新品牌行/图标标签/
分段切换；学生与管理账号登录正常；截图确认。
