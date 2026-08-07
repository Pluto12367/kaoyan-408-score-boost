# 登录页文案与抽象科技背景实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development（推荐）或
> superpowers:executing-plans 按任务执行本计划。步骤使用 `- [ ]` 复选框跟踪。

**Goal:** 在已上线的登录页基础上追加 4 处文案与纯 CSS 抽象科技背景，并部署到云端。

**Architecture:** 纯展示层：`App.tsx`（品牌区文案与标签结构）、`AccountPanel.tsx`（注册引导文案）、
`styles.css`（文案样式与背景增强），同步更新 `test/auth-page-redesign.test.js`。

**Tech Stack:** React 18 + TypeScript、Vite、lucide-react、node:test、无头 Edge + CDP。

## Global Constraints

- 保留既有契约：`auth-shell-redesign`、`auth-orb`、`auth-feature-grid`、`auth-role-copy`、
  `学生 / 教师 / 管理员`、`name="inviteCode"` 等全部保留；后端与字段逻辑不动。
- 不新增 npm 依赖、不引入图片文件（背景纯 CSS）。
- 验证门禁：`npm run build:web` 通过、`npm test` 全绿（336 个测试基线，允许新增用例）。
- Git 写操作属于用户已授权的发布流程。

---

### Task 1: 品牌区文案与两行能力标签（App.tsx + styles.css + 测试）

**Files:**
- Modify: `apps/web/src/App.tsx`（`.auth-brand` 内）
- Modify: `apps/web/src/styles.css`（`.auth-tagline`、`.auth-feature-grid`、`.auth-trust`）
- Modify: `test/auth-page-redesign.test.js`

**Interfaces:**
- Consumes: 无
- Produces: `.auth-tagline`、`.auth-trust`、两行标签结构（`<b>` + `<small>`）

- [ ] **Step 1: 更新/追加测试**

将 `test/auth-page-redesign.test.js` 中图标断言改为两行结构，并追加文案断言：

```js
test('auth feature tags carry lucide icons and keep the feature grid class', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /auth-feature-grid/);
  assert.match(app, /<BookOpenCheck size=\{16\} \/><b>题库训练<\/b><small>按薄弱点精准组题<\/small>/);
  assert.match(app, /<ShieldCheck size=\{16\} \/><b>错题复盘<\/b><small>错因分类，变式重练<\/small>/);
  assert.match(app, /<Target size=\{16\} \/><b>学情分析<\/b><small>四科掌握度实时可视化<\/small>/);
  assert.match(app, /<Brain size=\{16\} \/><b>AI 辅助<\/b><small>四层提示拆解解题思路<\/small>/);
});

test('auth brand adds tagline and trust copy', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /auth-tagline/);
  assert.match(app, /从入学诊断到模拟考试，四科薄弱点一清二楚/);
  assert.match(app, /auth-trust/);
  assert.match(app, /面向计算机考研 408 考生的个性化提分系统/);
});

test('styles define tagline and trust copy', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /\.auth-tagline \{/);
  assert.match(styles, /\.auth-trust \{/);
  assert.match(styles, /\.auth-feature-grid span small \{/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/auth-page-redesign.test.js`
Expected: 3 个相关用例 FAIL

- [ ] **Step 3: 实现 App.tsx 品牌区**

在 `.auth-brand` 内：

```tsx
<h1>计算机考研 408 提分系统</h1>
<p className="auth-tagline">从入学诊断到模拟考试，四科薄弱点一清二楚</p>
<p>登录后同步学习计划、题库训练、错题复盘、学情分析和 AI 辅助，让备考路径更清楚。</p>
<div className="auth-feature-grid" aria-label="系统能力">
  <span><BookOpenCheck size={16} /><b>题库训练</b><small>按薄弱点精准组题</small></span>
  <span><ShieldCheck size={16} /><b>错题复盘</b><small>错因分类，变式重练</small></span>
  <span><Target size={16} /><b>学情分析</b><small>四科掌握度实时可视化</small></span>
  <span><Brain size={16} /><b>AI 辅助</b><small>四层提示拆解解题思路</small></span>
</div>
<p className="auth-role-copy">学生 / 教师 / 管理员均可进入对应工作台。</p>
<p className="auth-trust">面向计算机考研 408 考生的个性化提分系统</p>
```

- [ ] **Step 4: 实现样式**

在 `styles.css` 追加（`.auth-feature-grid` 相关规则替换为两行卡）：

```css
.auth-tagline {
  margin: 0;
  color: #e0f2fe;
  font-size: 17px;
  font-weight: 800;
  line-height: 1.5;
}

.auth-trust {
  margin: 0;
  padding-top: 14px;
  border-top: 1px solid rgb(191 219 254 / 18%);
  color: #93c5fd;
  font-size: 13px;
}

.auth-feature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.auth-feature-grid span {
  display: grid;
  gap: 3px;
  border: 1px solid rgb(191 219 254 / 20%);
  border-radius: 14px;
  padding: 10px 12px;
  background: rgb(255 255 255 / 9%);
  color: #eff6ff;
}

.auth-feature-grid span b {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 700;
}

.auth-feature-grid span svg {
  color: #7dd3fc;
}

.auth-feature-grid span small {
  color: #bfdbfe;
  font-size: 12px;
  line-height: 1.45;
}
```

同步更新移动端（`@media (max-width: 720px)` 内）能力标签规则：

```css
.auth-feature-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
```

并将移动端原 `.auth-feature-grid span { flex: 1 1 calc(50% - 10px); justify-content: center; }`
替换为 `.auth-feature-grid span { justify-content: center; }`（span 已改为 grid 布局）。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test test/auth-page-redesign.test.js`
Expected: PASS（含更新后的移动端断言）

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css test/auth-page-redesign.test.js
git commit -m "feat(ui): auth brand copy (tagline, two-line feature cards, trust line)"
```

---

### Task 2: 注册引导文案（AccountPanel + styles + 测试）

**Files:**
- Modify: `apps/web/src/features/auth/AccountPanel.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `test/auth-page-redesign.test.js`

**Interfaces:**
- Consumes: Task 1 无依赖
- Produces: `.auth-register-guide`

- [ ] **Step 1: 追加失败测试**

```js
test('account panel shows the registration guide copy in register mode', async () => {
  const panel = await source('apps/web/src/features/auth/AccountPanel.tsx');
  assert.match(panel, /auth-register-guide/);
  assert.match(panel, /三步开始提分：填写邀请码 → 创建账号 → 完成入学诊断/);
});

test('styles define the registration guide', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /\.auth-register-guide \{/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/auth-page-redesign.test.js`
Expected: 2 个新用例 FAIL

- [ ] **Step 3: 实现 AccountPanel**

在注册模式表单分支（`{props.authMode === 'register' ? ( <> ... </> ) : null}`）最前面加入：

```tsx
<p className="auth-register-guide">三步开始提分：填写邀请码 → 创建账号 → 完成入学诊断</p>
```

- [ ] **Step 4: 实现样式**

```css
.auth-register-guide {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-left: 4px solid #0f766e;
  border-radius: 8px;
  background: #f0fdfa;
  color: #115e59;
  font-size: 13px;
  line-height: 1.5;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test test/auth-page-redesign.test.js`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/features/auth/AccountPanel.tsx apps/web/src/styles.css test/auth-page-redesign.test.js
git commit -m "feat(ui): registration guide copy in register mode"
```

---

### Task 3: 抽象科技背景（styles.css + 测试）

**Files:**
- Modify: `apps/web/src/styles.css`
- Modify: `test/auth-page-redesign.test.js`

**Interfaces:**
- Consumes: 无
- Produces: 增强后的 `.auth-shell-redesign` 背景

- [ ] **Step 1: 追加失败测试**

```js
test('styles add tech grid and dot texture to the auth shell background', async () => {
  const styles = await source('apps/web/src/styles.css');
  const rule = styles.match(/\.auth-shell-redesign \{[\s\S]*?\}/)?.[0] ?? '';
  assert.match(rule, /background-size:/);
  assert.match(rule, /26px 26px/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/auth-page-redesign.test.js`
Expected: 新用例 FAIL（当前 background-size 为 44px 44px, 44px 44px, auto...）

- [ ] **Step 3: 实现背景**

替换 `.auth-shell-redesign` 规则为：

```css
.auth-shell-redesign {
  background:
    radial-gradient(rgb(125 211 252 / 22%) 1px, transparent 1.5px),
    linear-gradient(rgb(255 255 255 / 4%) 1px, transparent 1px),
    linear-gradient(90deg, rgb(255 255 255 / 4%) 1px, transparent 1px),
    radial-gradient(circle at 82% 18%, rgb(20 184 166 / 26%), transparent 26%),
    radial-gradient(circle at 18% 20%, rgb(37 99 235 / 28%), transparent 30%),
    radial-gradient(circle at 76% 72%, rgb(20 184 166 / 20%), transparent 34%),
    linear-gradient(135deg, #061122 0%, #0f1f37 52%, #142845 100%);
  background-size: 26px 26px, 44px 44px, 44px 44px, auto, auto, auto, auto;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/auth-page-redesign.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/styles.css test/auth-page-redesign.test.js
git commit -m "feat(ui): tech grid and dot texture auth background"
```

---

### Task 4: 全量验证、推送与云端验证

- [ ] **Step 1: 本地全量构建与测试**

Run: `npm run build:web`、`npm test`
Expected: 构建通过；测试全绿（0 失败）

- [ ] **Step 2: 无头浏览器验证（本地 dev）**

Run: `npm run dev:web` + 无头 Edge 脚本
Expected: 桌面登录页显示 tagline/两行标签/trust；注册模式显示引导文案；移动端 2 列标签正常

- [ ] **Step 3: 提交设计与计划文档并推送**

```bash
git add docs/superpowers/specs/2026-08-07-auth-page-redesign-design.md docs/superpowers/plans/2026-08-07-auth-copy-background.md
git commit -m "docs(ui): auth copy and background spec/plan"
git push origin codex/deployment-ready
```

- [ ] **Step 4: 云端部署与验证**

服务器执行：`git pull origin codex/deployment-ready && ./deploy/tencent-ip/deploy.sh`
Expected: 部署成功；无头浏览器打开 `http://43.128.30.191/` 验证新文案与背景，截图确认
