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

test('styles upgrade the orb and feature tags', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /\.auth-orb \{[\s\S]*?box-shadow:[\s\S]*?rgb\(37 99 235/);
  assert.match(styles, /\.auth-feature-grid span \{[\s\S]*?border-radius:\s*999px/);
});

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

test('mobile styles stack the auth brand row and keep feature tags usable', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.auth-brand-row \{[\s\S]*?flex-direction:\s*column/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.auth-feature-grid \{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});
